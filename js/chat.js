/* DAYFLOW — AI 비서 대화
 * 사용자의 말을 의도(추가·조회·이동·삭제·완료·통계·검색…)로 분류하고, 실제 일정 저장소를 조회·수정한다.
 * 수정·삭제·완료 처리는 반드시 확인 카드를 거친다. 저녁 마감은 단계별 대화로 진행한다. */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store, N = DF.nlp, U = DF.ui, B = DF.brief;
  const { esc, icon } = U;
  const josa = N.josa;
  const qj = (t, pair) => `‘${esc(t)}’` + josa(t, pair).slice(t.length);

  let messages = [];            // {role, html, at}
  const actions = new Map();    // 카드 id → 핸들러
  let root = null;
  let evening = null;           // 저녁 마감 진행 상태
  let cardSeq = 0;

  // ───────── 저장 ─────────
  async function load() { messages = await S.getKV('chat', []); }
  function persist() { S.setKV('chat', messages.slice(-120)).catch(() => {}); }

  // ───────── 출력 ─────────
  function push(role, html) {
    messages.push({ role, html, at: Date.now() });
    persist();
    render(true);
  }
  const say = html => push('ai', html);
  function card(html, handlers) {
    const id = 'c' + Date.now().toString(36) + (cardSeq++);
    actions.set(id, handlers);
    return `<div class="card-inline" data-card="${id}">${html}</div>`;
  }
  /** 카드 처리가 끝나면 버튼을 결과 문구로 바꿔 저장한다. */
  function resolveCard(id, label) {
    actions.delete(id);
    messages.forEach(m => {
      if (!m.html.includes(`data-card="${id}"`)) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = m.html;
      const c = tmp.querySelector(`[data-card="${id}"]`);
      if (!c) return;
      c.querySelectorAll('input,select,textarea,button').forEach(el => {
        if (el.matches('[data-act]')) return;
        if (el.type === 'checkbox') { if (el.checked) el.setAttribute('checked', ''); else el.removeAttribute('checked'); }
        else if (el.tagName === 'SELECT') [...el.options].forEach(o => o.toggleAttribute('selected', o.selected));
        else if (el.tagName !== 'BUTTON') el.setAttribute('value', el.value);
        el.setAttribute('disabled', '');
      });
      const live = root && root.querySelector(`[data-card="${id}"]`);
      if (live) live.querySelectorAll('input,select,textarea').forEach((el, i) => {
        const t = c.querySelectorAll('input,select,textarea')[i];
        if (!t) return;
        if (el.type === 'checkbox') t.toggleAttribute('checked', el.checked);
        else if (el.tagName === 'SELECT') [...t.options].forEach((o, j) => o.toggleAttribute('selected', el.options[j] && el.options[j].selected));
        else t.setAttribute('value', el.value);
      });
      c.querySelectorAll('[data-act]').forEach(b => b.remove());
      const foot = c.querySelector('.card-actions') || c;
      foot.insertAdjacentHTML('beforeend', `<span class="card-result">${esc(label)}</span>`);
      c.classList.add('resolved');
      m.html = tmp.innerHTML;
    });
    persist();
    render(false);
  }

  const listHtml = (occs, showDate) => occs.length ? `<div class="ev-list compact">${occs.map(o => U.occRow(o, { showDate })).join('')}</div>` : '';
  const bullet = items => `<ul class="plain">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

  // ───────── 렌더링 ─────────
  const SUGGEST = ['30분 뒤에 씻으라고 알려줘', '내일 일정 알려줘', '이번 주에 가장 바쁜 날은?', '오늘 가장 먼저 준비할 건?', '이번 달에 운동 몇 번 했어?', '다음 주 월요일 오후 3시 병원 예약 추가해 줘', '오늘 빈 시간 알려줘'];
  function mount(el) {
    root = el;
    root.innerHTML = `
      <div class="chat">
        <div class="chat-log" id="chat-log" aria-live="polite"></div>
        <div class="chat-suggest">${['아침 브리핑', '하루 마감 시작'].map(s => `<button class="chip" data-say="${s}">${s === '아침 브리핑' ? icon('sunrise', 14) : icon('moonset', 14)}${s}</button>`).join('')}${SUGGEST.map(s => `<button class="chip" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <form class="chat-input" id="chat-form" autocomplete="off">
          <input id="chat-text" placeholder="예: 금요일 일정을 토요일로 옮겨줘" aria-label="AI 비서에게 말하기">
          <button class="btn primary icon-only" aria-label="보내기">${icon('send', 16)}</button>
        </form>
      </div>`;
    root.querySelector('#chat-form').addEventListener('submit', e => {
      e.preventDefault();
      const inp = root.querySelector('#chat-text');
      const v = inp.value.trim();
      if (!v) return;
      inp.value = '';
      handle(v);
    });
    root.querySelectorAll('[data-say]').forEach(b => b.addEventListener('click', () => handle(b.dataset.say)));
    root.querySelector('#chat-log').addEventListener('click', onLogClick);
    if (!messages.length) say(`안녕하세요${S.settings.name ? ', ' + esc(S.settings.name) + '님' : ''}. 일정을 말로 추가하거나, 일정을 물어보거나, 옮기거나 지울 수 있어요. 바꾸거나 지우기 전에는 꼭 먼저 확인할게요.`);
    else render(true);
  }
  function render(scroll) {
    if (!root || !root.isConnected) return;
    const log = root.querySelector('#chat-log');
    if (!log) return;
    log.innerHTML = messages.map(m => `<div class="msg ${m.role}">${m.role === 'ai' ? `<div class="avatar ai">${icon('spark', 14)}</div>` : ''}<div class="bubble">${m.html}</div></div>`).join('');
    log.querySelectorAll('[data-card]').forEach(c => { if (!actions.has(c.dataset.card) && !c.classList.contains('resolved')) c.classList.add('expired'); });
    if (scroll) log.scrollTop = log.scrollHeight;
  }
  async function onLogClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      const row = e.target.closest('.ev [data-act="open"]');
      return row ? null : null;
    }
    const c = btn.closest('[data-card]');
    if (!c) return;
    const h = actions.get(c.dataset.card);
    if (!h) { U.toast('이 요청은 만료되었어요. 다시 말씀해 주세요.'); return; }
    const fn = h[btn.dataset.act];
    if (fn) await fn(c, btn);
  }

  // ───────── 진입점 ─────────
  async function handle(text) {
    push('me', esc(text));
    try {
      if (evening && evening.waiting && !/^(아침\s*브리핑|하루\s*마감\s*시작)$/.test(text)) return await eveningReply(text);
      const it = intent(text);
      if (it !== 'briefing' && it !== 'evening' && await aiFlow(text)) return;
      await route(text);
    } catch (e) {
      console.error(e);
      say('처리하는 중에 문제가 생겼어요. 다시 한 번 말씀해 주세요.');
    }
  }

  function intent(t) {
    t = t.trim();
    if (/^(안녕|ㅎㅇ|하이|hi|hello|반가워|좋은\s*(아침|저녁))/i.test(t)) return 'hello';
    if (/^(고마워|고맙|감사|땡큐|ㄱㅅ|thx|thanks|굿|좋아|오케이|ok|알겠어|ㅇㅋ)/i.test(t)) return 'thanks';
    if (/(뭐\s*할\s*수\s*있|무엇을\s*할\s*수|사용법|도움말|기능\s*(알려|뭐))/.test(t)) return 'help';
    if (/날씨|비\s*(와|올까|오나)|우산|기온|춥|더워|덥/.test(t) && !/추가|알려\s*줘라고/.test(t)) return 'weather';
    if (/브리핑/.test(t)) return 'briefing';
    if (/하루\s*마감|마감\s*시작|하루\s*정리|오늘\s*정리|회고/.test(t)) return 'evening';
    const changeVerb = /(옮겨|옮기|이동|미뤄|미루|연기|당겨|변경|바꿔|바꾸|늦춰)/;
    // "장소 메가박스로 바꿔줘", "중요 일정으로 표시해 줘"
    if ((/장소|제목|이름/.test(t) && changeVerb.test(t)) || (/중요/.test(t) && /(표시|바꿔|변경|설정|해\s*줘|해줘|으로)/.test(t) && !/추가/.test(t))) return 'edit';
    // "1분 뒤에 씻으라고 알려줘", "7시에 깨워줘", "알람 맞춰줘"
    const relTime = /\d+\s*(분|시간)\s*(반\s*)?(뒤|후|있다가|이따)(?!로)/.test(t);
    if (/라고\s*(좀\s*)?(알려|말해|해\s*줘|해줘|해\s*주세요)|깨워|(알림|알람)\s*(맞춰|설정|해\s*줘|해줘|켜)|알람(?!\s*(취소|꺼|삭제|지워|없애))|리마인드/.test(t) || (relTime && /알려|알림/.test(t))) return 'remind';
    // "피부과 30분 전에 알려줘" → 일정 추가 + 알림
    if (/(\d+\s*(분|시간)|하루)\s*전에?\s*(알려|알림)/.test(t)) return 'add';
    if (changeVerb.test(t) && !/추가/.test(t)) return 'move';
    if (/(삭제|지워|지우|없애|빼\s*줘|취소|안\s*할래|안\s*해도|안\s*갈래|안\s*가도|못\s*가|빠질래|빠져|째|건너뛸래|패스할래)/.test(t) && !/추가/.test(t)) return 'delete';
    if (/(완료|끝냈|끝났|끝냄|다\s*했|마쳤|마침|다녀왔|갔다\s*왔|하고\s*왔|끝!)/.test(t) && !/몇|얼마|언제|기로/.test(t) && !/추가/.test(t)) return 'complete';
    if (/(몇\s*시에?\s*(끝나|마쳐|마치|끝)|언제\s*(끝나|마쳐))/.test(t)) return 'dayend';
    if (/몇\s*(번|개|회|시간)|횟수|얼마나/.test(t)) return 'count';
    if (/(가장|제일)\s*(바쁜|바빴|한가|여유)/.test(t)) return 'busiest';
    if (/(먼저|우선)\s*(준비|해야|챙겨|할)|준비할\s*(것|거)|챙길\s*(것|거)/.test(t)) return 'prepare';
    if (/(빈\s*시간|여유\s*시간|시간\s*(비|있|되)|한가한\s*시간|언제\s*시간)/.test(t)) return 'free';
    if (/통계|완료율|분석/.test(t)) return 'stats';
    if (/(찾아|검색)/.test(t)) return 'search';
    if (/(다음|이번)\s*일정|지금\s*(뭐|무슨)|뭐\s*해야\s*(돼|되|해|하)|다음에\s*뭐/.test(t)) return 'next';
    // "치과 언제야?", "학원 몇 시야?", "민수랑 약속 언제였지?"
    if (/(언제|몇\s*시)/.test(t) && keywords(t.replace(/언제\S*|몇\s*시\S*/g, ' ')).length) return 'when';
    if (/(앞으로|다가오|예정된|바쁜\s*날)/.test(t) && !/추가/.test(t)) return 'forecast';
    if (/(추가|등록|잡아|넣어|기록해|저장해|생겼|해야\s*해|가야\s*해|있어$|있음$|약속)/.test(t)) return 'add';
    if (/(일정|스케줄|뭐\s*(있|해|했)|알려|보여|어때|남은)/.test(t)) return 'query';
    const p = N.parse(t);
    if ((p.date || p.repeat.freq !== 'none') && p.title) return 'add';
    return 'help';
  }

  async function route(t) {
    switch (intent(t)) {
      case 'briefing': return briefing();
      case 'evening': return startEvening();
      case 'remind': return remindFlow(t);
      case 'add': return addFlow(t);
      case 'query': return query(t);
      case 'move': return moveFlow(t);
      case 'delete': return deleteFlow(t);
      case 'complete': return completeFlow(t);
      case 'count': return count(t);
      case 'busiest': return busiest(t);
      case 'prepare': return prepare(t);
      case 'free': return free(t);
      case 'stats': return statsReply();
      case 'search': return search(t);
      case 'forecast': return forecastReply();
      case 'hello': return hello();
      case 'thanks': return say(['천만에요. 또 필요하면 불러 주세요.', '별말씀을요. 오늘도 잘 챙겨 볼게요.', '언제든지요!'][Math.floor(Math.random() * 3)]);
      case 'weather': return weatherReply(t);
      case 'edit': return editFlow(t);
      case 'next': return nextReply();
      case 'when': return whenReply(t);
      case 'dayend': return dayEndReply(t);
      case 'help': return help(true);
      default: return help();
    }
  }

  function hello() {
    const n = T.now();
    const g = n.h < 5 ? '늦은 밤이에요' : n.h < 11 ? '좋은 아침이에요' : n.h < 17 ? '안녕하세요' : '좋은 저녁이에요';
    const left = S.on(n.date).filter(o => !o.done && (!o.start || S.span(o)[1] > n.minutes));
    say(`${g}${S.settings.name ? ', ' + esc(S.settings.name) + '님' : ''}! 안녕하세요. ${left.length ? `오늘 남은 일정은 ${left.length}개예요.` : '오늘 남은 일정은 없어요.'} 무엇을 도와드릴까요?`);
  }

  async function weatherReply(t) {
    const w = await DF.weather.get().catch(() => null);
    if (!w || !w.ok) return say('지금은 날씨 정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    const d = N.findDates(t, T.now().date).found[0];
    const date = d ? d.date : T.now().date;
    const day = DF.weather.forDate(w, date);
    if (!day) return say('그날 날씨는 아직 알 수 없어요. 3일 안의 날씨만 볼 수 있어요.');
    const [desc] = DF.weather.describe(day.code);
    let h = `${esc(w.city)} ${esc(T.relLabel(date).split(' · ')[0])} 날씨는 ${esc(desc)}, 최고 ${day.max}° / 최저 ${day.min}°예요.`;
    if (date === T.now().date) h += ` 지금은 ${w.temp}° (체감 ${w.feels}°)예요.`;
    if (day.rain != null) h += day.rain >= 50 ? ` 비 올 확률이 ${day.rain}%라 우산을 챙기세요.` : ` 비 올 확률은 ${day.rain}%예요.`;
    say(h);
  }

  /** 다음 일정 (지금 진행 중이면 그것부터) */
  function nextReply() {
    const n = T.now();
    const occs = S.occurrences(n.date, T.addDays(n.date, 14)).filter(o => !o.done && o.start && T.epoch(o.occDate, o.start) + (S.span(o)[1] - S.span(o)[0]) * 6e4 > Date.now());
    const untimed = S.on(n.date).filter(o => !o.done && !o.start);
    const o = occs[0];
    const todo = untimed.length ? `<br><span class="muted">시간이 정해지지 않은 오늘 할 일: ${untimed.map(u => esc(u.title)).join(', ')}</span>` : '';
    if (!o) return say((untimed.length ? '시간이 정해진 남은 일정은 없어요.' : '앞으로 2주 동안 남은 일정이 없어요.') + todo);
    const left = Math.round((T.epoch(o.occDate, o.start) - Date.now()) / 6e4);
    const when = left <= 0 ? '지금 진행 중' : `${T.relLabel(o.occDate).split(' · ')[0]} ${T.timeK(o.start)}${left < 180 ? ` (${T.durK(left)} 뒤)` : ''}`;
    const prep = B.prepFor(o);
    say(`다음 일정은 <b>‘${esc(o.title)}’</b> — ${esc(when)}.${o.location ? ` 장소는 ${esc(o.location)}.` : ''}${prep ? ` 챙길 것: ${esc(prep)}.` : ''}${todo}`);
  }

  /** "치과 언제야?" — 키워드에 맞는 가장 가까운 다음 일정 (없으면 가장 최근 지난 일정) */
  function whenReply(t) {
    const kws = keywords(t.replace(/언제\S*|몇\s*시\S*/g, ' '));
    const today = T.now().date;
    const match = o => kws.some(k => (o.title + ' ' + o.location + ' ' + (o.people || []).join(' ')).includes(k));
    const nowTs = Date.now();
    const future = S.occurrences(today, T.addDays(today, 180)).filter(o => match(o) && (!o.start || T.epoch(o.occDate, o.start) + 60 * 6e4 > nowTs || o.occDate > today));
    const pastAsk = /였|었|했|갔|봤|만났/.test(t);
    const past = S.occurrences(T.addDays(today, -180), today).filter(match).reverse();
    const o = pastAsk ? (past[0] || future[0]) : (future[0] || past[0]);
    if (!o) return say(`‘${esc(kws.join(' '))}’ 일정을 찾지 못했어요.`);
    const span = o.endDate ? ` ~ ${T.fmtDate(o.endDate)}` : '';
    const time = o.start ? ` ${T.timeK(o.start)}${o.end ? `~${T.timeK(o.end)}` : ''} (${o.start}${o.end ? '–' + o.end : ''})` : '';
    let h = `${qj(o.title, '은/는')} ${esc(T.relLabel(o.endDate ? o.date : o.occDate))}${esc(span)}${esc(time)}${o.occDate < today ? '이었어요' : '이에요'}.`;
    if (o.isRepeat && !o.isMulti) h += ` (${esc(S.repeatLabel(o.repeat))} 반복)`;
    if (o.location) h += ` 장소: ${esc(o.location)}.`;
    say(h);
  }

  /** "오늘 몇 시에 끝나?", "학교 몇 시에 끝나?" */
  function dayEndReply(t) {
    const today = T.now().date;
    const d = N.findDates(t, today).found[0];
    const date = d ? d.date : today;
    const kws = keywords(t.replace(/(몇\s*시에?|언제)\s*(끝나|마쳐|마치|끝)\S*/g, ' '));
    let occs = S.on(date).filter(o => o.start);
    if (kws.length) occs = occs.filter(o => kws.some(k => o.title.includes(k)));
    if (!occs.length) return say(`${esc(T.relLabel(date).split(' · ')[0])}에는 ${kws.length ? `‘${esc(kws.join(' '))}’ ` : ''}시간이 정해진 일정이 없어요.`);
    const last = occs.reduce((a, o) => (S.span(o)[1] > S.span(a)[1] ? o : a));
    const endMin = S.span(last)[1];
    say(kws.length ? `${qj(last.title, '은/는')} ${esc(T.fromMin(endMin))}(${esc(T.timeK(T.fromMin(endMin)))})에 끝나요.${last.end ? '' : ' 끝나는 시간이 없어서 1시간으로 계산했어요.'}`
      : `${esc(T.relLabel(date).split(' · ')[0])} 마지막 일정은 ${qj(last.title, '이고/고')} ${esc(T.fromMin(endMin))}에 끝나요.${last.end ? '' : ' (끝나는 시간이 없어서 1시간으로 계산했어요)'}`);
  }

  /** 장소·제목·중요도 바꾸기 */
  function editFlow(t) {
    const today = T.now().date;
    let patch = {}, label;
    let m;
    if (/중요/.test(t)) {
      const off = /(안\s*중요|중요하지\s*않|중요\s*(해제|취소|빼)|보통)/.test(t);
      patch.priority = off ? 'normal' : 'high';
      label = off ? '중요도 → 보통' : '중요 일정으로 표시';
    } else if ((m = /장소\S*\s*(?:를|을)?\s*(.+?)(?:으로|로)\s*(?:바꿔|변경|바꾸)/.exec(t))) {
      patch.location = m[1].trim();
      label = `장소 → ${patch.location}`;
    } else if ((m = /(?:제목|이름)\S*\s*(?:를|을)?\s*(.+?)(?:으로|로)\s*(?:바꿔|변경|바꾸)/.exec(t))) {
      patch.title = m[1].trim();
      label = `제목 → ${patch.title}`;
    } else return say('무엇을 바꿀지 알려 주세요. 예: “영화 장소 메가박스로 바꿔줘”');
    const stripped = t.replace(/(장소|제목|이름)\S*.*$/, ' ').replace(/중요\S*.*$/, ' ');
    const { occs } = matchOccs(stripped, today);
    const seen = new Set();
    const list = occs.filter(o => (seen.has(o.id) ? false : seen.add(o.id)));
    if (!list.length) return say('바꿀 일정을 찾지 못했어요. 일정 이름을 함께 말씀해 주세요.');
    say(`다음 일정을 이렇게 바꿀까요? <b>${esc(label)}</b>` + card(`${pickList(list)}<div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn primary" data-act="ok">바꾸기</button></div>`, {
      ok: async c => {
        const sel = picked(c, list);
        for (const o of sel) await S.update(o.id, patch);
        resolveCard(c.dataset.card, `${sel.length}개 변경 완료`);
        say(`${sel.length}개 일정을 바꿨어요. (${esc(label)})`);
      },
      cancel: c => resolveCard(c.dataset.card, '취소했어요')
    }));
  }

  function help(asked) {
    say(`${asked ? '이런 걸 할 수 있어요.' : '이해하지 못했어요. 이렇게 말해 보세요.'}${bullet([
      '“내일 오후 5시에 친구랑 축구” — 일정 추가',
      '“이번 주 일정 알려줘” — 일정 조회',
      '“금요일 일정을 토요일로 옮겨줘” — 일정 이동',
      '“치과 일정 취소해 줘” — 일정 삭제',
      '“이번 달에 운동 몇 번 했어?” — 기록 조회',
      '“하루 마감 시작” — 오늘 정리'
    ])}`);
  }

  // ───────── 공통: 일정 찾기 ─────────
  const STOP = /^(일정|스케줄|약속|거|것|좀|전부|모두|다|해줘|해\s*줘|줘|을|를|은|는|이|가|에|에서|있는|오늘|내일|해|하나|그거)$/;
  function keywords(text) {
    let work = N.findDates(text, T.now().date, { future: false }).rest;
    const tm = N.findTime(work);
    if (tm) work = work.slice(0, tm.index) + ' ' + work.slice(tm.index + tm.len);
    return work
      .replace(/[?!.,~ㅠㅜ]+/g, ' ')
      .replace(/(으로|로)\s*(옮|이동|미뤄|미루|연기|당겨|변경|바꿔)\S*/g, ' ')
      .replace(/(삭제|지워|지우|없애|취소|완료|끝냈|끝났|끝냄|다\s*했|마쳤|마침|다녀왔|갔다\s*왔|하고\s*왔|했어|했음|처리|해\s*줘|해줘|줘|주세요|할래|하자|좀|일정|스케줄|전부|모두|다음\s*주|이번\s*주|오늘|내일|안\s*할래|안\s*갈래|빠질래|빠져|못\s*가|됐어|되었어|언제|몇\s*시|몇\s*번|몇\s*개|뭐야|있어|있지|였지|이었지|야|요)/g, ' ')
      // 조사 떼기 — 떼고 나서 두 글자 이상 남을 때만 ("치과"의 '과'는 조사가 아니다)
      .split(/\s+/).map(w => { const s = w.replace(/(을|를|은|는|이|가|도|에서|에|의|랑|이랑|하고|과|와)$/, ''); return s.length >= 2 ? s : w; })
      // 한 글자 조각("어", "다")은 일정 이름으로 보기 어려워 뺀다
      .filter(w => w && w.length >= 2 && !STOP.test(w));
  }
  function matchOccs(text, fallbackDate, wide) {
    const today = T.now().date;
    const d = N.findDates(text, today, { future: false }).found;
    const kws = keywords(text);
    let pool;
    if (d.length) pool = S.on(d[0].date);
    else if (kws.length) pool = S.occurrences(wide ? T.addDays(today, -7) : today, T.addDays(today, 60));
    else pool = S.on(fallbackDate || today);
    if (kws.length) {
      const filtered = pool.filter(o => kws.some(k => (o.title + ' ' + o.location + ' ' + o.category).includes(k)));
      if (filtered.length || !d.length) pool = filtered;
    }
    if (!d.length && kws.length) {
      // 반복 일정은 가장 가까운 하나만
      const seen = new Set();
      pool = pool.filter(o => (seen.has(o.id) ? false : seen.add(o.id)));
    }
    return { occs: pool, date: d[0] ? d[0].date : null, kws };
  }

  // ───────── 브리핑 ─────────
  async function briefing(date) {
    date = date || T.now().date;
    const ai = DF.push ? await DF.push.brief(date) : null;
    if (ai) return say(aiBriefHtml(ai));
    const w = await DF.weather.get().catch(() => null);
    say(briefingHtml(B.morning(date, w)));
  }
  /** Claude가 쓴 아침 브리핑 */
  function aiBriefHtml(ai) {
    const lines = String(ai.body || '').split('\n').map(l => l.trim()).filter(Boolean);
    return `<p><b>${esc(ai.summary)}</b></p>${lines.length ? `<ul class="plain">${lines.map(l => `<li>${esc(l.replace(/^[·•\-]\s*/, ''))}</li>`).join('')}</ul>` : ''}`;
  }
  function briefingHtml(b) {
    let h = `<p><b>${esc(b.greet)}</b>${b.weatherLine ? ' ' + esc(b.weatherLine) : ''}</p>`;
    if (b.empty) return h + `<p>${esc(b.summary)} 하고 싶은 일이 생기면 바로 추가해 주세요.</p><p class="quote">${esc(b.quote)}</p>`;
    h += `<p class="sec">① 오늘의 전체 일정 · ${b.occs.length}개</p>${listHtml(b.occs)}`;
    if (b.important && b.important.length) h += `<p class="sec">② 가장 중요한 일정</p>${bullet(b.important.map(x => `<b>${esc(x.o.start || '미정')} ${esc(x.o.title)}</b> — ${esc(x.reason)}`))}`;
    if (b.sections.time.length) h += `<p class="sec">③ 시간 관리</p>${bullet(b.sections.time.map(t => (t.kind === 'warn' ? icon('alert', 13, 'warn') + ' ' : '') + esc(t.text)))}`;
    const plan = b.sections.plan.concat(b.sections.prep.length ? ['미리 준비할 것: ' + b.sections.prep.join(', ')] : []);
    if (plan.length) h += `<p class="sec">④ 하루 계획 제안</p>${bullet(plan.map(esc))}`;
    h += `<p class="sec">⑤ 오늘의 한마디</p><p class="quote">${esc(b.quote)}</p>`;
    return h;
  }

  // ───────── 추가 ─────────
  function draftCard(p, title) {
    const d = Object.assign({}, p, { reminders: p.reminders || [S.settings.defaultReminder].filter(x => x > 0 || x === 0) });
    const notes = [];
    p.assumptions.forEach(a => notes.push(esc(a)));
    if (p.missing.includes('time')) notes.push('시간이 없어서 <b>시간 미정</b>으로 저장돼요. 아래에서 시간을 넣어도 돼요.');
    const conf = p.date && p.start ? S.conflicts(p) : [];
    if (conf.length) notes.push(`${icon('alert', 13, 'warn')} ${conf.map(o => `${esc(o.start)} ${qj(o.title, '과/와')}`).join(', ')} 시간이 겹쳐요.`);
    return card(`<p class="card-title">${title || '이렇게 등록할까요?'}</p>${notes.length ? bullet(notes) : ''}${U.formHtml(d, { compact: true })}
      <div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn primary" data-act="save">등록</button></div>`, {
      save: async (c) => {
        const draft = U.readForm(c);
        draft.people = p.people;
        const r = await U.saveWithChecks(draft);
        if (r === 'edit') return;
        if (!r) return resolveCard(c.dataset.card, '취소했어요');
        resolveCard(c.dataset.card, `${T.fmtDate(r.date)}${r.endDate ? ' ~ ' + T.fmtDate(r.endDate) : ''} ${r.start || '시간 미정'} 등록 완료`);
        say(`${qj(r.title, '을/를')} ${esc(T.relLabel(r.date))}${r.endDate ? ' ~ ' + esc(T.fmtDate(r.endDate)) : ''}${r.start ? ' ' + esc(T.timeK(r.start)) : ''}에 등록했어요.`);
      },
      cancel: c => resolveCard(c.dataset.card, '취소했어요')
    });
  }
  function addFlow(t) {
    const many = N.parseMany(t);
    if (many.length > 1) {
      say(`일정 ${many.length}개를 찾았어요.${bullet(many.map((p, i) => `${i + 1}. ${esc(T.fmtDate(p.date))}${p.endDate ? ' ~ ' + esc(T.fmtDate(p.endDate)) : ''} ${esc(p.title)}${p.start ? ' · ' + esc(p.start) : ''}`))}각각 확인한 뒤 등록해 주세요.`);
      many.forEach((p, i) => say(draftCard(p, `${i + 1}번 일정`)));
      return;
    }
    const p = many[0] || N.parse(t);
    if (!p.title) return say('어떤 일정인지 알려 주세요. 예: “내일 오후 3시 치과”');
    if (!p.date) {
      p.date = T.now().date;
      return say(`날짜가 없어서 일단 오늘로 채웠어요. 날짜가 다르면 아래에서 바꿔 주세요.${draftCard(p)}`);
    }
    say(draftCard(p));
  }

  // ───────── Claude 비서 ─────────
  let aiOff = false; // 키가 없거나 기기 제한이면 이번 실행 동안은 기본 비서로만
  function plain(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    d.querySelectorAll('.card-inline').forEach(c => c.remove());
    return d.textContent.replace(/\s+/g, ' ').trim();
  }
  /** Claude에게 보낼 [지금]·[일정] 데이터 */
  function aiContext() {
    const n = T.now();
    const line = e => [e.id, e.date + (e.endDate ? '~' + e.endDate : ''), (e.start || '미정') + (e.end ? '-' + e.end : ''), e.title, e.location || '-', e.category, e.priority,
      S.isSeries(e) ? (e.endDate ? '여러 날' : S.repeatLabel(e.repeat)) + (e.repeat.until ? ` (~${e.repeat.until})` : '') : '한 번',
      !S.isSeries(e) && e.done ? '완료' : ''].join(' | ');
    const from = T.addDays(n.date, -21), to = T.addDays(n.date, 45);
    const last = e => e.endDate || (e.repeat.freq !== 'none' ? (e.repeat.until || '9999-12-31') : e.date);
    const all = S.all().filter(e => last(e) >= from && e.date <= to);
    const byDay = T.range(from, to).map(d => {
      const occ = S.on(d);
      return occ.length ? `${d}(${T.DOW[T.dow(d)]}): ` + occ.map(o => `${o.start || '미정'} ${o.title}[${o.id}]${o.done ? '✓' : ''}`).join(', ') : null;
    }).filter(Boolean);
    return `[지금] ${n.date} (${T.DOW[n.dow]}) ${n.time}\n[사용자] ${S.settings.name || '(이름 없음)'}\n` +
      `[일정 목록] id | 날짜 | 시간 | 제목 | 장소 | 분류 | 중요도 | 반복 | 완료\n${all.map(line).join('\n') || '(없음)'}\n` +
      `[날짜별 일정 ${from}~${to}] (✓=완료)\n${byDay.join('\n') || '(없음)'}`;
  }
  /** Claude로 처리했으면 true, 쓸 수 없으면 false (기본 비서로 넘김) */
  async function aiFlow(text) {
    if (aiOff || !DF.push || !navigator.onLine) return false;
    const history = messages.slice(-11, -1).map(m => ({ role: m.role === 'me' ? 'user' : 'assistant', text: plain(m.html) })).filter(h => h.text);
    const typing = document.createElement('div');
    typing.className = 'msg ai typing';
    typing.innerHTML = `<div class="avatar ai">${icon('spark', 14)}</div><div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div>`;
    const log = root && root.querySelector('#chat-log');
    if (log) { log.appendChild(typing); log.scrollTop = log.scrollHeight; }
    let r;
    try {
      r = await DF.push.call('/ai', { message: text, history, context: aiContext() });
    } catch (e) {
      typing.remove();
      if (['no_key', 'device_limit', 'forbidden'].includes(e.code)) aiOff = true;
      else if (e.code === 'daily_limit') say(esc(e.message) + ' 지금은 기본 비서로 답할게요.');
      return false;
    }
    typing.remove();
    const added = [], confirms = [];
    for (const a of r.actions || []) {
      if (a.name === 'add_event') added.push(await aiAdd(a.input));
      else confirms.push(a);
    }
    let html = esc(r.text || '').replace(/\n/g, '<br>');
    const ok = added.filter(Boolean);
    if (ok.length) {
      html += listHtml(ok.map(ev => S.on(ev.date).find(o => o.id === ev.id) || Object.assign({}, ev, { occDate: ev.date, key: ev.id + '@' + ev.date })), true);
      html += card(`<div class="card-actions"><button class="btn ghost" data-act="undo">추가 취소</button></div>`, {
        undo: async c => { for (const ev of ok) await S.remove(ev.id); resolveCard(c.dataset.card, '추가를 취소했어요'); }
      });
    }
    if (added.length > ok.length) html += '<br><span class="muted small">일부 일정은 정보가 맞지 않아 추가하지 못했어요.</span>';
    confirms.forEach(a => { html += aiConfirmCard(a); });
    say(html || '네.');
    return true;
  }
  async function aiAdd(x) {
    const d = {
      title: x.title, date: x.date, endDate: x.end_date || null, start: x.start || null, end: x.end || null, location: x.location || '',
      category: x.category, priority: x.priority, repeat: { freq: x.repeat_freq || 'none', days: x.repeat_days || null, until: x.repeat_until || null },
      reminders: Array.isArray(x.reminder_minutes) ? x.reminder_minutes : []
    };
    if (U.validate(d)) return null;
    return S.add(d);
  }
  /** 바꾸기·지우기·완료는 확인 버튼을 눌러야 반영한다 */
  function aiConfirmCard(a) {
    const x = a.input || {};
    const ev = S.get(x.event_id);
    if (!ev) return '';
    const day = x.occurrence_date && S.isSeries(ev) ? x.occurrence_date : null;
    const what = `<b>${esc(ev.title)}</b> ${day ? `(${esc(T.fmtDate(day))})` : S.isSeries(ev) ? '(모든 날)' : `(${esc(T.fmtDate(ev.date))})`}`;
    let desc, run;
    if (a.name === 'delete_event') {
      desc = `${what} 삭제`;
      run = () => (day ? S.skipOcc({ id: ev.id, occDate: day }) : S.remove(ev.id));
    } else if (a.name === 'set_done') {
      desc = `${what} ${x.done ? '완료로 표시' : '완료 취소'}`;
      const occDate = x.occurrence_date || ev.date;
      run = () => S.setDone({ id: ev.id, occDate }, !!x.done);
    } else if (a.name === 'change_event') {
      const parts = [];
      if (x.date) parts.push(`날짜 → ${T.fmtDate(x.date)}`);
      if (x.start) parts.push(`시작 → ${x.start}`);
      if (x.end) parts.push(`종료 → ${x.end}`);
      if (x.title) parts.push(`제목 → ${x.title}`);
      if (x.location) parts.push(`장소 → ${x.location}`);
      if (x.priority) parts.push(`중요도 → ${S.PRIORITY[x.priority] || x.priority}`);
      if (!parts.length) return '';
      desc = `${what}: ${esc(parts.join(', '))}`;
      run = async () => {
        let target = ev;
        if (day && (x.date || x.start)) target = await S.moveOcc({ id: ev.id, occDate: day }, x.date || day, x.start || undefined);
        else if (x.date || x.start) {
          const patch = {};
          if (x.date) patch.date = x.date;
          if (x.start) {
            patch.start = x.start;
            if (!x.end && ev.start && ev.end) patch.end = T.fromMin(T.toMin(x.start) + T.toMin(ev.end) - T.toMin(ev.start));
          }
          target = await S.update(ev.id, patch);
        }
        const rest = {};
        if (x.end) rest.end = x.end;
        if (x.title) rest.title = x.title;
        if (x.location) rest.location = x.location;
        if (x.priority) rest.priority = x.priority;
        if (Object.keys(rest).length && target) await S.update(target.id, rest);
      };
    } else return '';
    return card(`<p class="card-title">${desc}</p><div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn ${a.name === 'delete_event' ? 'danger' : 'primary'}" data-act="ok">확인</button></div>`, {
      ok: async c => { await run(); resolveCard(c.dataset.card, '반영했어요'); },
      cancel: c => resolveCard(c.dataset.card, '취소했어요')
    });
  }

  // ───────── 알려 주기 (바로 등록) ─────────
  async function remindFlow(t) {
    const today = T.now().date;
    const p = N.parse(t);
    if (!p.start) return say('몇 시에 알려 드릴까요? 예: “7시에 씻으라고 해줘”, “30분 뒤에 숙제하라고 알려줘”');
    const wake = /깨워|알람|기상/.test(t);
    // 시각 후보: 오전/오후를 말하지 않았으면 두 시각 중 가장 가까운 앞으로의 시각 (깨워·알람은 아침 우선)
    const ampmUnsaid = p.assumptions.some(a => /오전\/오후 표시가 없어/.test(a));
    let starts = [p.start];
    if (ampmUnsaid) {
      const m = T.toMin(p.start), other = m >= 720 ? m - 720 : m + 720;
      starts = wake ? [T.fromMin(Math.min(m, other))] : [p.start, T.fromMin(other)];
    }
    const days = p.date ? [p.date] : [today, T.addDays(today, 1)];
    const cands = [];
    days.forEach(d => starts.forEach(s => cands.push({ date: d, start: s, at: T.epoch(d, s) })));
    const future = cands.filter(c => c.at > Date.now() - 30e3).sort((a, b) => a.at - b.at);
    const pick = future[0] || cands.sort((a, b) => a.at - b.at)[0];
    const { date, start } = pick;
    const title = p.title || (wake ? '기상' : '알림');
    const ev = await S.add({ title, date, start, category: p.category, priority: 'high', repeat: p.repeat, reminders: [0], people: p.people, alarm: true });
    const left = Math.max(0, Math.round((T.epoch(date, start) - Date.now()) / 6e4));
    const when = `${T.relLabel(date).split(' · ')[0]} ${T.timeK(start)}`;
    const leftTxt = left < 1 ? '곧' : left < 180 ? `${T.durK(left)} 뒤` : '';
    say(`⏰ ${when}${leftTxt ? `(${leftTxt})` : ''}에 ${qj(title, '을/를')} 알람으로 알려 드릴게요.${p.repeat.freq !== 'none' ? ` (${esc(S.repeatLabel(p.repeat))} 반복)` : ''}` +
      (DF.push && DF.push.active ? '' : '<br><span class="muted small">앱을 닫아도 받으려면 알림을 허용해 주세요. 지금은 앱이 열려 있을 때만 알려 드려요.</span>') +
      card(`<div class="card-actions"><button class="btn ghost" data-act="undo">취소</button></div>`, {
        undo: async c => { await S.remove(ev.id); resolveCard(c.dataset.card, '알람을 취소했어요'); }
      }));
  }

  // ───────── 조회 ─────────
  function query(t) {
    const today = T.now().date;
    const rg = N.findRange(t, today);
    if (rg) {
      const occs = S.occurrences(rg.from, rg.to);
      if (!occs.length) return say(`${esc(rg.label)}에는 등록된 일정이 없어요.`);
      return say(`${esc(rg.label)}(${esc(T.fmtDate(rg.from, false))}~${esc(T.fmtDate(rg.to, false))}) 일정은 ${occs.length}개예요.${listHtml(occs, true)}`);
    }
    const d = N.findDates(t, today, { future: false }).found;
    const date = d.length ? d[0].date : today;
    const occs = S.on(date);
    const label = T.relLabel(date, today);
    if (!occs.length) return say(`${esc(label)}에는 등록된 일정이 없어요. 여유로운 하루예요.`);
    const done = occs.filter(o => o.done).length;
    say(`${esc(label)} 일정은 ${occs.length}개예요${done ? ` (완료 ${done}개)` : ''}.${listHtml(occs)}`);
  }

  // ───────── 이동 ─────────
  /** 일정마다 옮길 곳이 다른 경우의 확인 카드 */
  function confirmMoves(occs, dest, label) {
    const rows = occs.map(o => ({ o, to: dest(o) })).filter(x => x.to);
    if (!rows.length) return say('옮길 수 있는 일정이 없어요. 시간이 정해진 일정만 시간을 옮길 수 있어요.');
    say(`다음 일정을 옮길까요? ${esc(label)}` + card(`<div class="pick-list">${rows.map((x, i) => `<label class="pick"><input type="checkbox" data-pick="${i}" checked><span>${U.catDot(x.o.category)}<b>${esc(T.fmtDate(x.o.occDate))} ${esc(x.o.start || '미정')}</b> ${esc(x.o.title)} → <b>${esc(T.fmtDate(x.to.date))} ${esc(x.to.start || x.o.start || '')}</b></span></label>`).join('')}</div>
      <div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn primary" data-act="ok">옮기기</button></div>`, {
      ok: async c => {
        const sel = [...c.querySelectorAll('[data-pick]')].filter(i => i.checked).map(i => rows[+i.dataset.pick]);
        for (const x of sel) await S.moveOcc(x.o, x.to.date, x.to.start);
        resolveCard(c.dataset.card, `${sel.length}개 이동 완료`);
        say(`${sel.length}개 일정을 옮겼어요.`);
      },
      cancel: c => resolveCard(c.dataset.card, '취소했어요')
    }));
  }

  function moveFlow(t) {
    const today = T.now().date;
    // "주짓수 30분 뒤로 미뤄", "치과 1시간 당겨줘"
    const sh = /(\d+)\s*(분|시간)\s*(반\s*)?(?:뒤로|후로|늦게|늦춰|미뤄|미루)|(\d+)\s*(분|시간)\s*(반\s*)?(?:앞으로|당겨|당기|일찍|빨리)/.exec(t);
    if (sh) {
      const later = !!sh[1];
      const n = +(later ? sh[1] : sh[4]), unit = later ? sh[2] : sh[5], half = later ? sh[3] : sh[6];
      const delta = (unit === '시간' ? n * 60 : n) + (half ? 30 : 0);
      const { occs } = matchOccs(t.slice(0, sh.index), today);
      const timed = occs.filter(o => o.start);
      if (!timed.length) return say('시간을 옮길 일정을 찾지 못했어요. 시간이 정해진 일정 이름을 함께 말씀해 주세요.');
      return confirmMoves(timed, o => {
        const m = T.toMin(o.start) + (later ? delta : -delta);
        return m >= 0 && m < 1440 ? { date: o.occDate, start: T.fromMin(m) } : null;
      }, `(${later ? '' : '-'}${T.durK(delta)})`);
    }
    const ds = N.findDates(t, today, { future: false }).found;
    // "치과 다음 주로 미뤄줘" — 요일 없이 다음 주면 같은 요일로
    if (/다음\s*주로|일주일\s*(뒤로|미뤄|후로)/.test(t) && !ds.some(d => /요일|욜/.test(d.text))) {
      const { occs } = matchOccs(t.replace(/다음\s*주로.*$|일주일.*$/, ' '), today);
      if (!occs.length) return say('옮길 일정을 찾지 못했어요. 일정 이름을 함께 말씀해 주세요.');
      return confirmMoves(occs, o => ({ date: T.addDays(o.occDate, 7) }), '(일주일 뒤 같은 요일)');
    }
    const toIdx = t.search(/(으로|로)\s*(옮|이동|미뤄|미루|연기|당겨|변경|바꿔)/);
    let target = null, source = null;
    if (ds.length >= 2) { source = ds[0]; target = ds[ds.length - 1]; }
    else if (ds.length === 1) { if (toIdx > -1 && ds[0].index < toIdx && ds[0].index + ds[0].len >= toIdx - 3) target = ds[0]; else source = ds[0]; }
    if (/내일로\s*미뤄|미뤄/.test(t) && !target) target = { date: T.addDays(source ? source.date : today, 1) };
    const tail = toIdx > -1 ? t.slice(Math.max(0, (target && target.index) || 0)) : '';
    const tm = target && target.index != null ? N.findTime(t.slice(target.index)) : (tail ? N.findTime(tail) : null);
    const srcText = source ? t.slice(0, (target && target.index) || t.length) : t.slice(0, target && target.index != null ? target.index : t.length);
    const found = matchOccs(srcText, today);
    let occs = found.occs.filter(o => !source || o.occDate === source.date);
    if (!target && !tm) return say('어느 날짜(또는 시간)로 옮길지 알려 주세요. 예: “금요일 일정을 토요일로 옮겨줘”');
    if (!occs.length) return say(`${source ? esc(T.relLabel(source.date)) + '에 ' : ''}옮길 일정을 찾지 못했어요. 일정 이름이나 날짜를 함께 말씀해 주세요.`);
    const toDate = target ? target.date : occs[0].occDate;
    const toStart = tm ? tm.start : undefined;
    const dest = `${T.relLabel(toDate)}${toStart ? ' ' + toStart : ''}`;
    say(`다음 일정을 옮길까요? 옮길 일정만 체크해 주세요.<br>옮길 곳: <b>${esc(dest)}</b>` +
      card(`${pickList(occs)}<div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn primary" data-act="ok">옮기기</button></div>`, {
        ok: async c => {
          const sel = picked(c, occs);
          if (!sel.length) return U.toast('옮길 일정을 하나 이상 골라 주세요.');
          const warn = [];
          for (const o of sel) {
            const startFor = toStart !== undefined ? toStart : o.start;
            const conf = startFor ? S.conflicts({ date: toDate, start: startFor, end: o.end && o.start && toStart ? T.fromMin(T.toMin(toStart) + T.toMin(o.end) - T.toMin(o.start)) : (toStart ? null : o.end) }, o.id) : [];
            if (conf.length) warn.push(`${qj(o.title, '이/가')} ${conf.map(x => qj(x.title, '과/와')).join(', ')} 시간이 겹쳐요.`);
            await S.moveOcc(o, toDate, toStart);
          }
          resolveCard(c.dataset.card, `${sel.length}개 이동 완료`);
          say(`${sel.length}개 일정을 옮겼어요. (→ ${esc(dest)})${warn.length ? bullet(warn.map(w => icon('alert', 13, 'warn') + ' ' + w)) : ''}`);
        },
        cancel: c => resolveCard(c.dataset.card, '취소했어요')
      }));
  }
  function pickList(occs) {
    return `<div class="pick-list">${occs.map((o, i) => `<label class="pick"><input type="checkbox" data-pick="${i}" checked><span>${U.catDot(o.category)}<b>${esc(T.fmtDate(o.occDate))} ${esc(o.start || '미정')}</b> ${esc(o.title)}${o.isMulti ? ` <span class="muted">(${o.dayIndex}/${o.dayTotal}일째)</span>` : o.isRepeat ? ' <span class="muted">(반복)</span>' : ''}</span></label>`).join('')}</div>`;
  }
  const picked = (c, occs) => [...c.querySelectorAll('[data-pick]')].filter(i => i.checked).map(i => occs[+i.dataset.pick]);

  // ───────── 삭제 ─────────
  function deleteFlow(t) {
    const { occs } = matchOccs(t, T.now().date);
    if (!occs.length) return say('삭제할 일정을 찾지 못했어요. 날짜나 일정 이름을 함께 말씀해 주세요.');
    say(`다음 일정을 삭제할까요? 삭제할 것만 체크해 주세요.${occs.some(o => o.isRepeat) ? ' 반복·여러 날 일정은 해당 날짜만 삭제돼요.' : ''}` +
      card(`${pickList(occs)}<div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn danger" data-act="ok">삭제</button></div>`, {
        ok: async c => {
          const sel = picked(c, occs);
          if (!sel.length) return U.toast('삭제할 일정을 하나 이상 골라 주세요.');
          const backups = [];
          for (const o of sel) {
            const ev = S.get(o.id);
            if (!ev) continue;
            backups.push(Object.assign({}, ev));
            if (o.isRepeat) await S.skipOcc(o); else await S.remove(o.id);
          }
          resolveCard(c.dataset.card, `${sel.length}개 삭제 완료`);
          say(`${sel.length}개 일정을 삭제했어요.`);
          U.toast('일정을 삭제했어요.', { action: '되돌리기', duration: 10000, onAction: async () => { for (const b of backups) await S.restore(b); say('삭제한 일정을 되돌렸어요.'); } });
        },
        cancel: c => resolveCard(c.dataset.card, '취소했어요')
      }));
  }

  // ───────── 완료 ─────────
  function completeFlow(t) {
    const today = T.now().date;
    let { occs } = matchOccs(t, today);
    occs = occs.filter(o => !o.done && o.occDate <= today);
    if (!occs.length) return say('완료 처리할 일정을 찾지 못했어요. 오늘 일정 이름을 함께 말씀해 주세요.');
    say('다음 일정을 완료로 표시할까요?' + card(`${pickList(occs)}<div class="card-actions"><button class="btn ghost" data-act="cancel">취소</button><button class="btn primary" data-act="ok">완료 처리</button></div>`, {
      ok: async c => {
        const sel = picked(c, occs);
        for (const o of sel) await S.setDone(o, true);
        resolveCard(c.dataset.card, `${sel.length}개 완료`);
        say(`${sel.length}개 일정을 완료했어요. 수고했어요.`);
      },
      cancel: c => resolveCard(c.dataset.card, '취소했어요')
    }));
  }

  // ───────── 분석 질문 ─────────
  function count(t) {
    const today = T.now().date;
    const rg = N.findRange(t, today) || { from: T.monthStart(today), to: T.monthEnd(today), label: '이번 달' };
    const cat = S.CATEGORIES.find(c => t.includes(c)) || (/(운동|헬스|축구|주짓수|수영|요가)/.test(t) ? '운동' : /공부/.test(t) ? '공부' : null);
    const kws = keywords(t.replace(/몇\s*(번|개|회|시간)|횟수|얼마나|했어|했지|있어|있지|있었어|이번\s*달|다음\s*달|지난\s*달|이번\s*주|다음\s*주|지난\s*주/g, ' ')).filter(k => k !== cat);
    const pastOnly = /했|었/.test(t);
    const to = pastOnly && rg.to > today ? today : rg.to;
    let occs = S.occurrences(rg.from, to);
    if (cat) occs = occs.filter(o => o.category === cat || (o.title.includes(cat)));
    else if (kws.length) occs = occs.filter(o => kws.some(k => o.title.includes(k)));
    const label = cat || kws.join(' ') || '전체';
    if (/시간/.test(t)) {
      const mins = occs.filter(o => o.start).reduce((s, o) => s + S.span(o)[1] - S.span(o)[0], 0);
      return say(`${esc(rg.label)} ‘${esc(label)}’ 일정에 쓴 시간은 약 ${esc(T.durK(mins))}이에요 (시간이 정해진 일정 ${occs.filter(o => o.start).length}개 기준).`);
    }
    const done = occs.filter(o => o.done).length;
    if (!occs.length) return say(`${esc(rg.label)}에는 ‘${esc(label)}’ 일정이 없어요.`);
    if (label === '전체') return say(`${esc(rg.label)} 일정은 ${pastOnly ? '오늘까지 ' : ''}모두 ${occs.length}개예요 (반복 일정은 날마다 하나로 셈). 완료로 체크한 건 ${done}개예요.`);
    say(`${esc(rg.label)} ‘${esc(label)}’ 일정은 ${pastOnly ? '오늘까지 ' : ''}${occs.length}번이고, 그중 완료로 체크한 건 ${done}번이에요.${listHtml(occs.slice(-8), true)}`);
  }
  function busiest(t) {
    const today = T.now().date;
    const rg = N.findRange(t, today) || { from: T.weekStart(today), to: T.addDays(T.weekStart(today), 6), label: '이번 주' };
    const days = T.range(rg.from, rg.to).map(d => ({ d, occs: S.on(d) }));
    days.forEach(x => { x.mins = x.occs.filter(o => o.start).reduce((s, o) => s + S.span(o)[1] - S.span(o)[0], 0); });
    const quiet = /한가|여유/.test(t);
    const sorted = days.slice().sort((a, b) => quiet ? (a.occs.length - b.occs.length || a.mins - b.mins) : (b.occs.length - a.occs.length || b.mins - a.mins));
    const top = sorted[0];
    if (!quiet && (!top || !top.occs.length)) return say(`${esc(rg.label)}에는 등록된 일정이 없어요.`);
    say(`${esc(rg.label)}에 ${quiet ? '가장 여유로운' : '가장 바쁜'} 날은 <b>${esc(T.fmtDate(top.d))}</b>이에요. 일정 ${top.occs.length}개${top.mins ? `, 약 ${esc(T.durK(top.mins))}` : ''}.${listHtml(top.occs)}
      <div class="mini-bars">${days.map(x => `<div class="mb"><div class="mb-bar" style="height:${Math.max(4, x.occs.length * 14)}px"></div><span>${T.DOW[T.dow(x.d)]}</span><em>${x.occs.length}</em></div>`).join('')}</div>`);
  }
  function prepare() {
    const n = T.now();
    const occs = S.on(n.date).filter(o => !o.done);
    if (!occs.length) return say('오늘 남은 일정이 없어요.');
    const upcoming = occs.filter(o => !o.start || S.span(o)[1] > n.minutes);
    const first = upcoming.find(o => o.start) || upcoming[0];
    if (!first) return say('오늘 남은 일정이 없어요.');
    const imp = B.importantOf(occs)[0];
    const prep = B.prepFor(first);
    let h = `가장 먼저 준비할 일정은 <b>${esc(first.start ? T.timeK(first.start) : '시간 미정')} ${esc(first.title)}</b>이에요.`;
    if (first.start) { const left = T.toMin(first.start) - n.minutes; if (left > 0) h += ` ${esc(T.durK(left))} 남았어요.`; }
    if (prep) h += ` 챙길 것: ${esc(prep)}.`;
    if (first.location) h += ` 장소는 ${esc(first.location)}이에요.`;
    if (imp && imp.id !== first.id) h += `<br>가장 중요한 일정은 ${qj(imp.title, '이에요/예요')}${imp.start ? ` (${esc(imp.start)})` : ''}. 미리 시간을 확인해 두세요.`;
    say(h);
  }
  function free(t) {
    const n = T.now();
    const d = N.findDates(t, n.date, { future: true }).found;
    const date = d.length ? d[0].date : n.date;
    const fromMin = date === n.date ? Math.max(n.minutes, 8 * 60) : 8 * 60;
    const busy = S.on(date).filter(o => o.start).map(S.span).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let cur = fromMin;
    busy.forEach(([s, e]) => { if (s - cur >= 30) gaps.push([cur, s]); cur = Math.max(cur, e); });
    if (22 * 60 - cur >= 30) gaps.push([cur, 22 * 60]);
    if (!gaps.length) return say(`${esc(T.relLabel(date))}에는 30분 이상 빈 시간이 없어요.`);
    say(`${esc(T.relLabel(date))} 빈 시간이에요 (08:00~22:00 기준).${bullet(gaps.map(([a, b]) => `${T.fromMin(a)} ~ ${T.fromMin(b)} · ${esc(T.durK(b - a))}`))}`);
  }
  function statsReply() {
    const s = B.stats();
    say(`이번 주 일정 ${s.weekCount}개(완료 ${s.weekDone}), 이번 달 일정 ${s.monthCount}개(완료 ${s.monthDone})예요.` +
      (s.rate != null ? ` 최근 30일 완료율은 ${s.rate}%예요.` : '') +
      (s.busiestDow != null ? ` 최근 8주 동안 가장 바빴던 요일은 ${T.DOW_LONG[s.busiestDow]}이에요.` : '') +
      ` 자세한 내용은 <a href="#/stats">통계</a>에서 볼 수 있어요.`);
  }
  function forecastReply() {
    const f = B.forecast(21);
    const parts = [];
    if (f.busy.length) parts.push(`바쁜 날: ${f.busy.slice(0, 4).map(b => `${T.fmtDate(b.date)} (${b.count}개)`).join(', ')}`);
    f.clusters.forEach(c => parts.push(`${T.fmtDate(c[0].date, false)}~${T.fmtDate(c[c.length - 1].date, false)}에 일정이 몰려 있어요.`));
    f.prepare.forEach(p => parts.push(`D-${p.dday} ${p.o.title}${p.prep ? ' — ' + p.prep : ''}`));
    say(parts.length ? `앞으로 3주를 살펴봤어요.${bullet(parts.map(esc))}` : '앞으로 3주 동안 특별히 몰린 일정은 없어요.');
  }
  function search(t) {
    const kws = keywords(t.replace(/(찾아|검색|언제였|언제\s*만났|언제\s*봤|언제|약속|일정)\S*/g, ' '));
    if (!kws.length) return say('무엇을 찾을지 알려 주세요. 예: “민수랑 약속 찾아줘”');
    const res = S.search(kws.join(' ')).slice(0, 12);
    if (!res.length) return say(`‘${esc(kws.join(' '))}’ 관련 일정이 없어요.`);
    say(`‘${esc(kws.join(' '))}’ 관련 일정 ${res.length}개를 찾았어요.${listHtml(res.map(e => Object.assign({}, e, { occDate: e.date, key: e.id + '@' + e.date })), true)}`);
  }

  // ───────── 저녁 마감 대화 ─────────
  async function startEvening() {
    const today = T.now().date;
    evening = { step: 'feel', date: today, waiting: true, newOnes: [] };
    const occs = S.on(today);
    const list = occs.length
      ? card(`<p class="muted">완료한 일정을 체크해 주세요.</p><div class="pick-list">${occs.map((o, i) => `<label class="pick"><input type="checkbox" data-done="${i}" ${o.done ? 'checked' : ''}><span>${U.catDot(o.category)}<b>${esc(o.start || '미정')}</b> ${esc(o.title)}</span></label>`).join('')}</div>
        <div class="card-actions"><button class="btn primary" data-act="ok">체크 반영</button></div>`, {
        ok: async c => {
          const marks = [...c.querySelectorAll('[data-done]')];
          for (const el of marks) { const o = occs[+el.dataset.done]; if (o.done !== el.checked) await S.setDone(o, el.checked); }
          resolveCard(c.dataset.card, `완료 ${marks.filter(m => m.checked).length}/${marks.length} 반영`);
        }
      })
      : '<p class="muted">오늘은 등록된 일정이 없었어요.</p>';
    say(`<b>하루 마감</b><br>오늘 하루는 어떠셨나요? 예정된 일정은 잘 마무리했나요?${list}<p class="muted">짧게 오늘 하루를 적어 주시면 기록해 둘게요. 넘어가려면 “넘어가기”라고 해 주세요.</p>`);
  }
  async function eveningReply(text) {
    const skip = /^(넘어가기|넘어가|패스|없어|없어요|없음|아니|아니요|ㄴㄴ|no)\.?$/i.test(text.trim());
    if (evening.step === 'feel') {
      if (!skip) await S.setKV('journal:' + evening.date, { text, at: Date.now() });
      evening.step = 'new';
      return say(`${skip ? '' : '기록해 뒀어요. '}오늘 새롭게 추가된 일정이 있나요? 있다면 편하게 말씀해 주세요. (예: “금요일에 친구랑 저녁 먹기로 했어. 토요일에는 치과 가야 해.”) 없으면 “없어”라고 해 주세요.`);
    }
    if (evening.step === 'new') {
      if (skip) return eveningUnfinished();
      const found = N.parseMany(text);
      if (!found.length) return say('일정을 찾지 못했어요. 날짜와 함께 다시 말씀해 주세요. 없으면 “없어”라고 해 주세요.');
      const saved = [];
      for (const p of found) {
        const ev = await S.add({ title: p.title, date: p.date, endDate: p.endDate, start: p.start, end: p.end, location: p.location, category: p.category, priority: p.priority, repeat: p.repeat, reminders: p.reminders || (p.start ? [S.settings.defaultReminder] : []), people: p.people });
        saved.push(ev);
      }
      evening.newOnes = saved;
      const noTime = saved.filter(e => !e.start);
      const listTxt = bullet(saved.map((e, i) => `${i + 1}. ${esc(T.fmtDate(e.date))}${e.endDate ? ' ~ ' + esc(T.fmtDate(e.endDate)) : ''} ${esc(e.title)}${e.start ? ' · ' + esc(T.timeK(e.start)) : ' · <span class="muted">시간 미정</span>'}`));
      const undoIds = saved.map(e => e.id);
      const undo = card(`<div class="card-actions"><button class="btn ghost" data-act="undo">방금 저장한 일정 되돌리기</button></div>`, {
        undo: async c => { for (const id of undoIds) await S.remove(id); resolveCard(c.dataset.card, '저장을 취소했어요'); evening.newOnes = []; evening.step = 'new'; say('저장을 취소했어요. 다시 말씀해 주세요.'); }
      });
      if (noTime.length) {
        evening.step = 'times';
        return say(`새로운 일정 ${saved.length}개를 발견해서 저장했어요.${listTxt}${undo}${noTime.length === saved.length ? '각' : '시간이 없는'} 일정의 정확한 시간을 알려주시겠어요? (예: “금요일은 저녁 7시, 토요일은 오전 10시”) 모르면 “미정”이라고 해 주세요.`);
      }
      say(`새로운 일정 ${saved.length}개를 발견해서 저장했어요.${listTxt}${undo}`);
      return eveningUnfinished();
    }
    if (evening.step === 'times') {
      if (/^미정|모르|나중/.test(text.trim()) || skip) { say('시간은 미정으로 두었어요. 정해지면 알려 주세요.'); return eveningUnfinished(); }
      const pending = evening.newOnes.map(e => S.get(e.id)).filter(e => e && !e.start);
      const segs = text.split(/[,.\n]|그리고|고\s/).map(s => s.trim()).filter(Boolean);
      const updates = [];
      segs.forEach(seg => {
        const tm = N.findTime(seg);
        if (!tm) return;
        const d = N.findDates(seg, evening.date).found[0];
        let target = d ? pending.find(e => e.date === d.date && !updates.some(u => u.ev.id === e.id)) : null;
        if (!target) target = pending.find(e => seg.includes(e.title.split(' ')[0]) && !updates.some(u => u.ev.id === e.id));
        if (!target && pending.length - updates.length === 1) target = pending.find(e => !updates.some(u => u.ev.id === e.id));
        if (!target && !d) target = pending.find(e => !updates.some(u => u.ev.id === e.id));
        if (target) updates.push({ ev: target, start: tm.start, end: tm.end });
      });
      if (!updates.length) return say('시간을 알아듣지 못했어요. “금요일은 저녁 7시”처럼 말씀해 주세요. 모르면 “미정”이라고 해 주세요.');
      const warn = [];
      for (const u of updates) {
        const c = S.conflicts({ date: u.ev.date, start: u.start, end: u.end }, u.ev.id);
        if (c.length) warn.push(`${qj(u.ev.title, '이/가')} ${c.map(x => qj(x.title, '과/와')).join(', ')} 시간이 겹쳐요.`);
        await S.update(u.ev.id, { start: u.start, end: u.end, reminders: u.ev.reminders.length ? u.ev.reminders : [S.settings.defaultReminder] });
      }
      say(`시간을 반영했어요.${bullet(updates.map(u => `${esc(T.fmtDate(u.ev.date))} ${esc(u.ev.title)} → ${esc(T.timeK(u.start))}`))}${warn.length ? bullet(warn.map(w => icon('alert', 13, 'warn') + ' ' + w)) : ''}`);
      const still = evening.newOnes.map(e => S.get(e.id)).filter(e => e && !e.start);
      if (still.length) say(`${still.map(e => qj(e.title, '은/는')).join(', ')} 시간 미정으로 두었어요.`);
      return eveningUnfinished();
    }
    if (evening.step === 'unfinished' || evening.step === 'done') {
      evening.waiting = false;
      return route(text);
    }
  }
  function eveningUnfinished() {
    evening.step = 'unfinished';
    const occs = S.on(evening.date).filter(o => !o.done);
    if (!occs.length) { say('오늘 계획한 일정은 모두 마무리했어요.'); return eveningWrap(); }
    const tomorrowD = T.addDays(evening.date, 1);
    say(`오늘 계획 중 완료하지 못한 일정이 ${occs.length}개 있어요. 각각 어떻게 할까요?` + card(`
      <div class="pick-list">${occs.map((o, i) => `<div class="decide-row"><span>${U.catDot(o.category)}<b>${esc(o.start || '미정')}</b> ${esc(o.title)}</span>
        <div class="decide"><select data-dec="${i}"><option value="tomorrow">내일로 이동</option><option value="date">다른 날짜로 이동</option><option value="cancel">취소</option><option value="later">나중에 결정</option></select>
        <input type="date" data-date="${i}" value="${T.addDays(evening.date, 2)}" min="${tomorrowD}" hidden></div></div>`).join('')}</div>
      <div class="card-actions"><button class="btn primary" data-act="ok">적용</button></div>`, {
      ok: async c => {
        const res = [];
        for (let i = 0; i < occs.length; i++) {
          const o = occs[i], v = c.querySelector(`[data-dec="${i}"]`).value;
          if (v === 'tomorrow') { await S.moveOcc(o, tomorrowD); res.push(`${o.title} → 내일`); }
          else if (v === 'date') { const d = c.querySelector(`[data-date="${i}"]`).value; if (T.isDate(d)) { await S.moveOcc(o, d); res.push(`${o.title} → ${T.fmtDate(d)}`); } }
          else if (v === 'cancel') { if (o.isRepeat) await S.skipOcc(o); else await S.remove(o.id); res.push(`${o.title} 취소`); }
          else { if (!o.isRepeat) await S.update(o.id, { pendingDecision: true }); res.push(`${o.title} → 나중에 결정`); }
        }
        resolveCard(c.dataset.card, '적용 완료');
        say(`정리했어요.${bullet(res.map(esc))}`);
        eveningWrap();
      }
    }));
    setTimeout(() => {
      root && root.querySelectorAll('[data-dec]').forEach(sel => sel.addEventListener('change', () => {
        const d = sel.parentElement.querySelector('[data-date]');
        if (d) d.hidden = sel.value !== 'date';
      }));
    }, 0);
  }
  async function eveningWrap() {
    const tmr = T.addDays(evening.date, 1);
    const w = await DF.weather.get().catch(() => null);
    const t = B.tomorrow(tmr, w);
    let h = `<b>내일 (${esc(T.fmtDate(tmr))}) 미리 보기</b>`;
    if (t.weather) { const [desc] = DF.weather.describe(t.weather.code); h += `<br>날씨: ${esc(desc)}, ${t.weather.min}°~${t.weather.max}°${t.weather.rain != null ? `, 강수 확률 ${t.weather.rain}%` : ''}`; }
    if (!t.occs.length) h += '<p>내일은 아직 등록된 일정이 없어요. 여유로운 하루가 될 것 같아요.</p>';
    else {
      h += listHtml(t.occs);
      if (t.first) h += `<p>첫 일정은 ${esc(T.timeK(t.first.start))} ${qj(t.first.title, '이에요/예요')}.</p>`;
    }
    if (t.preps.length) h += `<p class="sec">준비할 것</p>${bullet(t.preps.map(esc))}`;
    h += '<p>오늘도 수고 많았어요. 푹 쉬세요.</p>';
    say(h);
    await S.setKV('eveningDone:' + evening.date, true);
    if (DF.push) DF.push.sync(); // 오늘 저녁 마감 알림은 더 보내지 않는다
    evening.step = 'done';
    evening.waiting = false;
  }

  // 대화 기록 지우기
  async function clear() { messages = []; actions.clear(); evening = null; await S.setKV('chat', []); render(); }

  // 다른 화면에서 일정이 바뀌면 카드 안 목록도 다시 그림 (상태 표시만)
  function onEventsChanged() { /* 기록된 메시지는 당시 상태 그대로 둔다 */ }

  DF.chat = { load, mount, handle, briefing, briefingHtml, aiBriefHtml, startEvening, clear, onEventsChanged, intent, get evening() { return evening; } };
})(window.DF = window.DF || {});

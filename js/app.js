/* DAYFLOW — 화면 구성과 라우팅 */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store, U = DF.ui, N = DF.nlp, B = DF.brief, W = DF.weather;
  const { esc, icon } = U;

  const NAV = [
    ['today', '오늘', 'home'], ['calendar', '캘린더', 'calendar'], ['assistant', 'AI 비서', 'chat'],
    ['stats', '통계', 'chart'], ['settings', '설정', 'settings']
  ];
  const view = () => document.getElementById('view');
  let current = null, weather = null, clockTimer = null;
  const cal = { mode: 'month', anchor: null, selected: null };

  // ───────── 공통 ─────────
  function occFromKey(key) {
    const at = key.lastIndexOf('@');
    const id = key.slice(0, at), date = key.slice(at + 1);
    const ev = S.get(id);
    if (!ev) return null;
    return S.on(date).find(o => o.id === id) || Object.assign({}, ev, { occDate: date, key, isRepeat: ev.repeat.freq !== 'none' });
  }
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.ev [data-act]');
    if (!btn || btn.closest('[data-card]')) return;
    const row = btn.closest('.ev');
    const occ = occFromKey(row.dataset.occ);
    if (!occ) return U.toast('이미 삭제된 일정이에요.');
    if (btn.dataset.act === 'toggle') {
      await S.setDone(occ, !occ.done);
      if (!occ.done) U.toast(`‘${esc(occ.title)}’ 완료!`, { action: '되돌리기', onAction: () => S.setDone(Object.assign({}, occ, { done: true }), false) });
    } else if (btn.dataset.act === 'open') U.openEvent(occ);
  });

  function renderNav() {
    const r = current;
    const items = NAV.map(([id, label, ic]) => `<a href="#/${id}" class="nav-item ${r === id ? 'active' : ''}" ${r === id ? 'aria-current="page"' : ''}>${icon(ic, 18)}<span>${label}</span></a>`).join('');
    document.getElementById('side-nav').innerHTML = items;
    document.getElementById('tabbar').innerHTML = items;
  }

  // ───────── 헤더(날짜·시간·날씨·프로필) ─────────
  function weatherChip() {
    if (!weather) return `<span class="wx muted">날씨 불러오는 중…</span>`;
    if (!weather.ok) return `<button class="wx muted" data-wx-retry title="다시 시도">${icon('cloud', 16)} 날씨 정보 없음</button>`;
    const [desc, ic] = W.describe(weather.code);
    const d = W.forDate(weather, T.now().date);
    return `<span class="wx" title="${esc(weather.city)} · 체감 ${weather.feels}°${weather.stale ? ' · 오프라인(이전 값)' : ''}">${icon(ic, 18)}<b>${weather.temp}°</b><span>${esc(desc)}</span>${d ? `<span class="muted">${d.max}° / ${d.min}°${d.rain >= 30 ? ` · 비 ${d.rain}%` : ''}</span>` : ''}<span class="muted">${esc(weather.city)}</span></span>`;
  }
  function header(title, sub) {
    const n = T.now();
    const name = S.settings.name;
    return `<header class="page-head">
      <div>
        <p class="eyebrow" id="clock-date">${esc(T.fmtDateLong(n.date))}</p>
        <h1>${title}</h1>
        ${sub ? `<p class="sub">${sub}</p>` : ''}
      </div>
      <div class="head-right">
        <span class="clock" id="clock">${n.time}<small>:${T.pad(n.s)}</small></span>
        <div id="wx-slot">${weatherChip()}</div>
        <button class="icon-btn" data-search aria-label="검색 (/)" title="검색 (/)">${icon('search')}</button>
        <a class="profile" href="#/settings" title="프로필 설정"><span class="avatar">${esc((name || '나').slice(0, 1))}</span><span class="pname">${esc(name || '사용자')}</span></a>
      </div>
    </header>`;
  }
  function bindHeader() {
    const s = view().querySelector('[data-search]');
    if (s) s.addEventListener('click', openSearch);
    const r = view().querySelector('[data-wx-retry]');
    if (r) r.addEventListener('click', () => loadWeather(true));
  }
  function tickClock() {
    const n = T.now();
    const c = document.getElementById('clock');
    if (c) c.innerHTML = `${n.time}<small>:${T.pad(n.s)}</small>`;
    const d = document.getElementById('clock-date');
    if (d && d.textContent !== T.fmtDateLong(n.date)) { d.textContent = T.fmtDateLong(n.date); route(); }
    if (n.s === 0 && current === 'today') renderToday(true);
  }
  async function loadWeather(force) {
    weather = await W.get(force);
    const slot = document.getElementById('wx-slot');
    if (slot) { slot.innerHTML = weatherChip(); const r = slot.querySelector('[data-wx-retry]'); if (r) r.addEventListener('click', () => loadWeather(true)); }
  }

  // ───────── 오늘 ─────────
  function greeting() {
    const h = T.now().h, name = S.settings.name;
    const g = h < 5 ? '늦은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '좋은 오후예요' : '좋은 저녁이에요';
    return name ? `${g}, ${esc(name)}님` : g;
  }
  async function renderToday(soft) {
    const n = T.now(), today = n.date;
    const occs = S.on(today);
    const done = occs.filter(o => o.done).length;
    const pct = occs.length ? Math.round(done / occs.length * 100) : 0;
    const line = B.dailyLine(today);
    const pending = S.all().filter(e => e.pendingDecision);
    const nowKey = (occs.find(o => o.start && T.toMin(o.start) <= n.minutes && S.span(o)[1] > n.minutes) || {}).key;
    const untimed = occs.filter(o => !o.start), timed = occs.filter(o => o.start);
    let nowPlaced = false;
    const rows = timed.map(o => {
      let pre = '';
      if (!nowPlaced && T.toMin(o.start) > n.minutes) { pre = `<div class="now-line"><span>지금 ${n.time}</span></div>`; nowPlaced = true; }
      return pre + U.occRow(o, { now: o.key === nowKey });
    }).join('') + (!nowPlaced && timed.length ? `<div class="now-line"><span>지금 ${n.time}</span></div>` : '');
    const upcoming = S.occurrences(T.addDays(today, 1), T.addDays(today, 3));
    const mDone = await S.getKV('eveningDone:' + today, false);

    const html = `${header(greeting())}
      <section class="ai-line card">
        <div class="ai-mark">${icon('spark', 16)}</div>
        <div class="ai-text"><p class="ai-main">${esc(line.line)}</p><p class="ai-quote">${esc(line.quote)}</p></div>
        <div class="ai-actions">
          <button class="btn sm" data-brief>${icon('sunrise', 15)} 아침 브리핑</button>
          <button class="btn sm" data-evening>${icon('moonset', 15)} ${mDone ? '마감 다시 하기' : '하루 마감'}</button>
        </div>
      </section>
      <section class="stats-row">
        <div class="stat"><span class="stat-label">오늘 일정</span><b>${occs.length}</b></div>
        <div class="stat"><span class="stat-label">완료</span><b>${done}</b></div>
        <div class="stat"><span class="stat-label">남은 일정</span><b>${occs.length - done}</b></div>
        <div class="stat"><span class="stat-label">진행률</span><b>${pct}<small>%</small></b><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div></div>
      </section>
      ${pending.length ? `<section class="card notice"><p class="card-title">${icon('flag', 15)} 결정을 미뤄 둔 일정 ${pending.length}개</p><div class="ev-list compact">${pending.map(e => U.occRow(Object.assign({}, e, { occDate: e.date, key: e.id + '@' + e.date }), { showDate: true })).join('')}</div><p class="muted small">일정을 눌러 날짜를 바꾸거나 삭제하세요.</p></section>` : ''}
      <section class="card timeline">
        <div class="section-head"><h2>오늘의 타임라인</h2>
          <div class="row-gap"><button class="btn sm" data-chat>${icon('chat', 15)} AI 비서와 대화</button><button class="btn sm primary" data-quick>${icon('plus', 15)} 빠른 추가</button></div>
        </div>
        ${occs.length ? `${untimed.length ? `<p class="group-label">시간 미정</p><div class="ev-list">${untimed.map(o => U.occRow(o)).join('')}</div>` : ''}
          ${timed.length ? `${untimed.length ? '<p class="group-label">시간순</p>' : ''}<div class="ev-list">${rows}</div>` : ''}`
        : `<div class="empty"><p>오늘은 등록된 일정이 없어요.</p><p class="muted">“내일 오후 5시 축구”처럼 한 문장으로 추가해 보세요.</p></div>`}
      </section>
      <section class="card">
        <div class="section-head"><h2>다가오는 일정</h2><a class="link" href="#/calendar">캘린더 보기 ${icon('right', 14)}</a></div>
        ${upcoming.length ? `<div class="ev-list compact">${upcoming.slice(0, 8).map(o => U.occRow(o, { showDate: true })).join('')}</div>` : '<p class="muted">앞으로 3일 동안 등록된 일정이 없어요.</p>'}
      </section>`;
    const y = soft ? window.scrollY : 0;
    view().innerHTML = html;
    if (soft) window.scrollTo(0, y);
    bindHeader();
    view().querySelector('[data-brief]').addEventListener('click', () => showMorning());
    view().querySelector('[data-evening]').addEventListener('click', () => { location.hash = '#/assistant?evening=1'; });
    view().querySelector('[data-chat]').addEventListener('click', () => { location.hash = '#/assistant'; });
    view().querySelector('[data-quick]').addEventListener('click', () => quickAdd());
  }

  // ───────── 아침 브리핑 모달 ─────────
  async function showMorning(b) {
    if (!b) { await loadWeather(); b = B.morning(T.now().date, weather); }
    const m = U.modal(`<div class="modal-head"><h2>${icon('sunrise', 18)} 오늘의 브리핑</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
      <div class="modal-body briefing">${DF.chat.briefingHtml(b)}</div>
      <div class="modal-foot"><button class="btn ghost" data-chat>AI 비서에게 묻기</button><span class="grow"></span><button class="btn primary" data-close>좋아요</button></div>`, { wide: true });
    m.el.querySelector('[data-chat]').addEventListener('click', () => { m.close(); location.hash = '#/assistant'; });
  }

  // ───────── 빠른 추가 ─────────
  function quickAdd(presetDate) {
    let parsed = null;
    const m = U.modal(`<div class="modal-head"><h2>빠른 추가</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
      <div class="modal-body">
        <div class="nl-input"><span>${icon('spark', 16)}</span><input id="qa-text" autofocus placeholder="예: 내일 오후 5시에 친구랑 축구하기" aria-label="한 문장으로 일정 입력"></div>
        <p class="muted small">날짜, 기간(“12월 1일부터 9일까지”), 시간, 장소(“~에서”), 반복(“매주 화요일”), 알림(“30분 전 알림”)을 알아들어요.</p>
        <div id="qa-preview"></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" data-detail>직접 입력</button><span class="grow"></span><button class="btn ghost" data-close>취소</button><button class="btn primary" data-save disabled>등록</button></div>`, { wide: true });
    const inp = m.el.querySelector('#qa-text'), prev = m.el.querySelector('#qa-preview'), save = m.el.querySelector('[data-save]');
    let t = null;
    const update = () => {
      const v = inp.value.trim();
      if (!v) { prev.innerHTML = ''; save.disabled = true; parsed = null; return; }
      parsed = N.parse(v);
      if (!parsed.date && presetDate) { parsed.date = presetDate; parsed.missing = parsed.missing.filter(x => x !== 'date'); }
      const p = parsed;
      const questions = [];
      if (p.missing.includes('title')) questions.push('무엇을 하는 일정인가요?');
      if (p.missing.includes('date')) questions.push('언제인가요? (예: 내일, 11월 10일, 다음 주 금요일) — 없으면 오늘로 저장해요.');
      if (p.missing.includes('time')) questions.push('몇 시인가요? 모르면 시간 미정으로 저장돼요.');
      const conf = p.date && p.start ? S.conflicts(p) : [];
      prev.innerHTML = `<div class="recog">
        <p class="card-title">인식한 내용</p>
        <dl class="recog-grid">
          <dt>제목</dt><dd>${p.title ? esc(p.title) : '<span class="warn-text">없음</span>'}</dd>
          <dt>날짜</dt><dd>${p.date ? esc(T.relLabel(p.date)) + (p.endDate ? ` ~ ${esc(T.fmtDate(p.endDate))} <span class="muted">(${T.diff(p.date, p.endDate) + 1}일간)</span>` : '') : '<span class="warn-text">없음 → 오늘</span>'}</dd>
          <dt>시간</dt><dd>${p.start ? esc(p.start + (p.end ? ' – ' + p.end : '')) : '<span class="muted">미정</span>'}</dd>
          ${p.location ? `<dt>장소</dt><dd>${esc(p.location)}</dd>` : ''}
          <dt>분류</dt><dd>${U.catDot(p.category)}${esc(p.category)} · 중요도 ${S.PRIORITY[p.priority]}</dd>
          ${p.repeat.freq !== 'none' ? `<dt>반복</dt><dd>${S.repeatLabel(p.repeat)}</dd>` : ''}
          ${p.reminders ? `<dt>알림</dt><dd>${p.reminders.length ? p.reminders.map(x => T.durK(x) + ' 전').join(', ') : '없음'}</dd>` : ''}
        </dl>
        ${p.assumptions.length ? `<ul class="plain small">${p.assumptions.map(a => `<li>${icon('alert', 13, 'warn')} ${esc(a)}</li>`).join('')}</ul>` : ''}
        ${questions.length ? `<ul class="plain small ask">${questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
        ${conf.length ? `<p class="warn-text small">${icon('alert', 13)} ${conf.map(o => `${esc(o.start)} ${esc(o.title)}`).join(', ')} 일정과 시간이 겹쳐요. 등록할 때 해결 방법을 고를 수 있어요.</p>` : ''}
      </div>`;
      save.disabled = !p.title;
    };
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 120); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && !save.disabled) { e.preventDefault(); update(); save.click(); } });
    const toDraft = () => {
      const p = parsed;
      return { title: p.title, date: p.date || T.now().date, endDate: p.endDate, start: p.start, end: p.end, location: p.location, category: p.category, priority: p.priority, repeat: p.repeat, reminders: p.reminders || (p.start ? [S.settings.defaultReminder] : []), people: p.people };
    };
    save.addEventListener('click', async () => {
      if (!parsed || !parsed.title) return;
      const r = await U.saveWithChecks(toDraft());
      if (r === 'edit') { m.close(); U.openEvent(null, toDraft()); return; }
      if (!r) return;
      m.close();
      U.toast(`‘${esc(r.title)}’ — ${esc(T.relLabel(r.date))}${r.endDate ? ' ~ ' + esc(T.fmtDate(r.endDate)) : ''} ${r.start || '시간 미정'} 등록했어요.`);
    });
    m.el.querySelector('[data-detail]').addEventListener('click', () => {
      const d = parsed && parsed.title ? toDraft() : { date: presetDate || T.now().date };
      m.close();
      U.openEvent(null, d);
    });
  }

  // ───────── 캘린더 ─────────
  function renderCalendar() {
    const today = T.now().date;
    cal.anchor = cal.anchor || today;
    cal.selected = cal.selected || today;
    let title, body;
    if (cal.mode === 'month') {
      const ms = T.monthStart(cal.anchor), me = T.monthEnd(cal.anchor);
      const gs = T.weekStartSun(ms), ge = T.addDays(T.weekStartSun(me), 6);
      const occs = S.occurrences(gs, ge);
      const { y, m } = T.ymd(ms);
      title = `${y}년 ${m}월`;
      body = `<div class="month">
        ${['일', '월', '화', '수', '목', '금', '토'].map(d => `<div class="mhead ${d === '토' ? 'sat' : d === '일' ? 'sun' : ''}">${d}</div>`).join('')}
        ${T.range(gs, ge).map(d => {
          const list = occs.filter(o => o.occDate === d);
          const cls = [d < ms || d > me ? 'out' : '', d === today ? 'today' : '', d === cal.selected ? 'sel' : '', T.dow(d) === 0 ? 'sun' : T.dow(d) === 6 ? 'sat' : ''].join(' ');
          return `<button class="mcell ${cls}" data-day="${d}" aria-label="${esc(T.fmtDate(d))} 일정 ${list.length}개">
            <span class="mnum">${T.ymd(d).d}</span>
            <span class="mchips">${list.slice(0, 3).map(o => `<span class="mchip ${o.done ? 'done' : ''}" style="--c:${S.CAT_COLOR[o.category]}">${o.start ? `<em>${o.start}</em>` : ''}${esc(o.title)}</span>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : ''}</span>
            ${list.length ? `<span class="mdots">${list.slice(0, 4).map(o => `<i style="--c:${S.CAT_COLOR[o.category]}"></i>`).join('')}</span>` : ''}
          </button>`;
        }).join('')}
      </div>`;
    } else {
      const ws = T.weekStartSun(cal.anchor), we = T.addDays(ws, 6);
      title = `${T.fmtDate(ws, false)} – ${T.fmtDate(we, false)}`;
      body = `<div class="week">${T.range(ws, we).map(d => {
        const list = S.on(d);
        return `<div class="wcol ${d === today ? 'today' : ''}">
          <button class="whead" data-day="${d}"><span>${T.DOW[T.dow(d)]}</span><b>${T.ymd(d).d}</b></button>
          <div class="ev-list compact">${list.map(o => U.occRow(o)).join('') || '<p class="muted small center">일정 없음</p>'}</div>
          <button class="add-line" data-add="${d}">${icon('plus', 14)} 추가</button>
        </div>`;
      }).join('')}</div>`;
    }
    const selList = S.on(cal.selected);
    view().innerHTML = `${header('캘린더')}
      <div class="cal-bar">
        <div class="seg" role="tablist"><button class="${cal.mode === 'week' ? 'on' : ''}" data-mode="week">주간</button><button class="${cal.mode === 'month' ? 'on' : ''}" data-mode="month">월간</button></div>
        <div class="cal-nav"><button class="icon-btn" data-nav="-1" aria-label="이전">${icon('left')}</button><b>${esc(title)}</b><button class="icon-btn" data-nav="1" aria-label="다음">${icon('right')}</button><button class="btn sm" data-nav="0">오늘</button></div>
        <button class="btn sm primary" data-add="${cal.selected}">${icon('plus', 15)} 일정 추가</button>
      </div>
      <div class="cal-layout ${cal.mode}">
        <section class="card cal-main">${body}</section>
        ${cal.mode === 'month' ? `<section class="card day-panel">
          <div class="section-head"><h2>${esc(T.relLabel(cal.selected, today))}</h2><button class="btn sm" data-add="${cal.selected}">${icon('plus', 14)}</button></div>
          ${selList.length ? `<div class="ev-list compact">${selList.map(o => U.occRow(o)).join('')}</div>` : '<p class="muted">등록된 일정이 없어요.</p>'}
        </section>` : ''}
      </div>`;
    bindHeader();
    view().querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { cal.mode = b.dataset.mode; cal.anchor = cal.selected; renderCalendar(); }));
    view().querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      const d = +b.dataset.nav;
      if (!d) { cal.anchor = cal.selected = today; }
      else cal.anchor = cal.mode === 'month' ? T.addMonths(T.monthStart(cal.anchor), d) : T.addDays(cal.anchor, 7 * d);
      renderCalendar();
    }));
    view().querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      cal.selected = b.dataset.day;
      if (cal.mode === 'week') { cal.mode = 'month'; cal.anchor = cal.selected; }
      renderCalendar();
    }));
    view().querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => quickAdd(b.dataset.add)));
  }

  // ───────── AI 비서 ─────────
  function renderAssistant(params) {
    view().innerHTML = `${header('AI 비서', '일정을 말로 추가하고, 묻고, 옮기세요. 바꾸기 전엔 꼭 확인을 받아요.')}
      <section class="card chat-card"><div id="chat-root"></div></section>
      <p class="center small"><button class="link-btn" data-clear>대화 기록 지우기</button></p>`;
    bindHeader();
    DF.chat.mount(document.getElementById('chat-root'));
    view().querySelector('[data-clear]').addEventListener('click', async () => {
      if (await U.confirmBox('대화 기록 지우기', '<p>대화 기록만 지워지고 일정은 그대로 남아요.</p>', '지우기', true)) { await DF.chat.clear(); renderAssistant(); }
    });
    if (params.get('evening') === '1') {
      history.replaceState(null, '', '#/assistant');
      DF.chat.startEvening();
    }
  }

  // ───────── 통계 ─────────
  function bars(items, max, fmt) {
    return `<div class="hbars">${items.map(([label, v, color]) => `<div class="hbar"><span class="hb-label">${label}</span><span class="hb-track"><i style="width:${max ? Math.max(v ? 2 : 0, v / max * 100) : 0}%;${color ? `background:${color}` : ''}"></i></span><span class="hb-val">${fmt(v)}</span></div>`).join('')}</div>`;
  }
  function renderStats() {
    const s = B.stats(), f = B.forecast(21);
    const catItems = S.CATEGORIES.map(c => [`${U.catDot(c)}${c}`, s.catMins[c], S.CAT_COLOR[c]]).sort((a, b) => b[1] - a[1]);
    const catMax = Math.max(...catItems.map(x => x[1]));
    const dowOrder = [1, 2, 3, 4, 5, 6, 0];
    const dowMax = Math.max(...s.dowCount);
    const fMax = Math.max(1, ...f.byDay.map(d => d.count));
    view().innerHTML = `${header('통계와 예측')}
      <section class="stats-row">
        <div class="stat"><span class="stat-label">이번 주 일정</span><b>${s.weekCount}</b><span class="muted small">완료 ${s.weekDone}</span></div>
        <div class="stat"><span class="stat-label">이번 달 일정</span><b>${s.monthCount}</b><span class="muted small">완료 ${s.monthDone}</span></div>
        <div class="stat"><span class="stat-label">완료율 (최근 30일)</span><b>${s.rate == null ? '–' : s.rate}<small>${s.rate == null ? '' : '%'}</small></b><span class="muted small">${s.pastDone}/${s.pastCount}</span></div>
        <div class="stat"><span class="stat-label">가장 바빴던 요일</span><b>${s.busiestDow == null ? '–' : T.DOW_LONG[s.busiestDow]}</b><span class="muted small">최근 8주</span></div>
      </section>
      <div class="grid-2">
        <section class="card"><div class="section-head"><h2>이번 달 카테고리별 시간</h2></div>
          ${catMax ? bars(catItems, catMax, v => (v ? T.durK(v) : '–')) : '<p class="muted">시간이 정해진 일정이 아직 없어요.</p>'}</section>
        <section class="card"><div class="section-head"><h2>요일별 일정 수 (최근 8주)</h2></div>
          ${dowMax ? bars(dowOrder.map(d => [T.DOW_LONG[d], s.dowCount[d]]), dowMax, v => v + '개') : '<p class="muted">아직 기록이 없어요.</p>'}</section>
      </div>
      <section class="card"><div class="section-head"><h2>앞으로 3주</h2><span class="muted small">하루 평균 ${f.avg.toFixed(1)}개</span></div>
        <div class="fbars">${f.byDay.map(d => `<div class="fb ${f.busy.some(b => b.date === d.date) ? 'busy' : ''}" title="${esc(T.fmtDate(d.date))}: ${d.count}개"><em>${d.count || ''}</em><i style="height:${d.count / fMax * 100}%"></i><span>${T.ymd(d.date).d}</span><span class="dw">${T.DOW[T.dow(d.date)]}</span></div>`).join('')}</div>
        <div class="grid-2 tight">
          <div><p class="group-label">바쁜 날</p>${f.busy.length ? `<ul class="plain">${f.busy.slice(0, 5).map(b => `<li><b>${esc(T.fmtDate(b.date))}</b> · 일정 ${b.count}개${b.mins ? ` · ${esc(T.durK(b.mins))}` : ''}</li>`).join('')}</ul>` : '<p class="muted small">특별히 바쁜 날은 없어요.</p>'}
            ${f.clusters.length ? `<p class="group-label">일정이 몰린 기간</p><ul class="plain">${f.clusters.map(c => `<li>${esc(T.fmtDate(c[0].date, false))} ~ ${esc(T.fmtDate(c[c.length - 1].date, false))} (${c.reduce((a, d) => a + d.count, 0)}개)</li>`).join('')}</ul>` : ''}</div>
          <div><p class="group-label">미리 준비할 일정</p>${f.prepare.length ? `<ul class="plain">${f.prepare.map(p => `<li><span class="dday">D-${p.dday}</span> <b>${esc(p.o.title)}</b> <span class="muted">${esc(T.fmtDate(p.o.occDate))}</span>${p.prep ? `<br><span class="small muted">준비: ${esc(p.prep)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">2주 안에 특별히 준비할 일정은 없어요.</p>'}</div>
        </div>
      </section>`;
    bindHeader();
  }

  // ───────── 검색 ─────────
  function openSearch() {
    const m = U.modal(`<div class="modal-head"><h2>일정 검색</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
      <div class="modal-body">
        <div class="nl-input"><span>${icon('search', 16)}</span><input id="sq" autofocus placeholder="제목, 장소, 사람 이름, 메모" aria-label="검색어"></div>
        <div class="filters">
          <select id="sc" aria-label="카테고리"><option value="">모든 카테고리</option>${S.CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select>
          <select id="ss" aria-label="기간"><option value="">전체 기간</option><option value="past">지난 일정</option><option value="future">앞으로의 일정</option></select>
          <select id="st" aria-label="상태"><option value="">모든 상태</option><option value="open">미완료</option><option value="done">완료</option></select>
        </div>
        <div id="sr" class="search-results"></div>
      </div>`, { wide: true });
    const q = m.el.querySelector('#sq'), out = m.el.querySelector('#sr');
    const run = () => {
      const res = S.search(q.value, { category: m.el.querySelector('#sc').value, scope: m.el.querySelector('#ss').value, status: m.el.querySelector('#st').value });
      const any = q.value.trim() || m.el.querySelector('#sc').value || m.el.querySelector('#ss').value || m.el.querySelector('#st').value;
      if (!any) { out.innerHTML = `<p class="muted small">총 ${S.all().length}개의 일정이 저장되어 있어요.</p>`; return; }
      out.innerHTML = res.length ? `<p class="muted small">${res.length}개</p><div class="ev-list compact">${res.slice(0, 80).map(e => U.occRow(Object.assign({}, e, { occDate: e.date, key: e.id + '@' + e.date }), { showDate: true })).join('')}</div>` : '<p class="muted">검색 결과가 없어요.</p>';
    };
    q.addEventListener('input', run);
    m.el.querySelectorAll('select').forEach(s => s.addEventListener('change', run));
    out.addEventListener('click', e => { if (e.target.closest('[data-act="open"]')) m.close(); });
    run();
  }

  // ───────── 설정 ─────────
  async function renderSettings() {
    const st = S.settings;
    const perm = DF.notify.permission();
    const backups = await S.listBackups();
    const ps = await DF.push.status();
    const pushHtml = ps.permission === 'granted' && ps.supported
      ? `<p class="small ok-text">${icon('check', 14)} <b>켜짐</b> — 앱을 닫아도 정해진 시각에 알림이 와요.${ps.lastSync ? ` <span class="muted">(${ps.lastCount || 0}개 예약 · ${esc(new Date(ps.lastSync).toLocaleString('ko-KR', { timeZone: T.TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} 동기화)</span>` : ''}</p>
         ${ps.lastError ? `<p class="small warn-text">마지막 동기화 실패: ${esc(ps.lastError)} — 인터넷 연결을 확인해 주세요.</p>` : ''}
         <div class="row-gap wrap"><button class="btn sm" data-push-test>${icon('bell', 15)} 닫힌 상태 알림 테스트</button></div>`
      : ps.ios && !ps.standalone ? '<p class="small warn-text">iPhone에서는 Safari 공유 버튼 → “홈 화면에 추가”로 설치한 DAYFLOW 앱에서 알림을 받을 수 있어요.</p>'
      : !ps.supported ? '<p class="small warn-text">이 브라우저는 백그라운드 알림을 지원하지 않아요.</p>'
      : ps.permission === 'denied' ? '<p class="small warn-text">알림이 차단되어 있어요. 기기 설정에서 DAYFLOW 알림을 허용해 주세요.</p>'
      : `<p class="small">알림을 허용하면 바로 켜져요.</p><div class="row-gap wrap"><button class="btn sm primary" data-perm>${icon('bell', 15)} 알림 허용하기</button></div>`;
    const permText = { granted: '허용됨', denied: '차단됨 (브라우저 설정에서 허용해 주세요)', default: '아직 묻지 않음', unsupported: '이 환경은 시스템 알림을 지원하지 않아 앱 안 알림으로 보여 드려요' }[perm];
    view().innerHTML = `${header('설정')}
      <div class="grid-2">
        <section class="card"><div class="section-head"><h2>프로필</h2></div>
          <label class="field full"><span>이름</span><input id="s-name" maxlength="20" value="${esc(st.name)}" placeholder="이름 또는 닉네임"></label>
          <label class="field full"><span>날씨 지역</span><select id="s-city">${Object.keys(W.CITIES).map(c => `<option ${c === st.city ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field full"><span>테마</span><select id="s-theme"><option value="system" ${st.theme === 'system' ? 'selected' : ''}>시스템 설정 따르기</option><option value="light" ${st.theme === 'light' ? 'selected' : ''}>밝게</option><option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>어둡게</option></select></label>
        </section>
        <section class="card"><div class="section-head"><h2>브리핑과 알림</h2></div>
          <label class="field check-line full"><input type="checkbox" id="s-auto" ${st.autoBriefing ? 'checked' : ''}> 아침 브리핑·저녁 마감 자동 실행</label>
          <div class="field two"><label><span>아침 브리핑</span><input type="time" id="s-morning" value="${esc(st.morningTime)}"></label><label><span>저녁 마감</span><input type="time" id="s-evening" value="${esc(st.eveningTime)}"></label></div>
          <label class="field full"><span>기본 알림 (새 일정)</span><select id="s-rem">${[['', '없음'], [0, '정시'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전']].map(([v, l]) => `<option value="${v}" ${String(st.defaultReminder) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <p class="small">브라우저 알림: <b>${esc(permText)}</b></p>
          <div class="row-gap"><button class="btn sm" data-test>${icon('bell', 15)} 테스트 알림</button></div>
        </section>
      </div>
      <section class="card"><div class="section-head"><h2>앱을 닫아도 오는 알림</h2></div>
        <p class="small">일정 알림, 아침 브리핑, 저녁 마감을 앱이 꺼져 있어도 정해진 시각에 보내 드려요. 앞으로 30일치 알림 문구(일정 제목·시간·장소)만 알림 서버에 올라가고, 일정이 바뀌면 자동으로 다시 맞춰요.</p>
        ${pushHtml}
      </section>
      <section class="card"><div class="section-head"><h2>데이터</h2><span class="muted small">${S.all().length}개 일정 · ${DF.db.usingFallback ? 'localStorage' : 'IndexedDB'}에 저장 중</span></div>
        <p class="small">모든 데이터는 이 기기의 브라우저 저장소에 영구 저장돼요. 새로고침하거나 브라우저를 껐다 켜도 그대로 남아요. 다른 기기로 옮기거나 혹시 모를 상황에 대비해 가끔 백업 파일을 내려받아 두세요.</p>
        <div class="row-gap wrap">
          <button class="btn sm" data-export>${icon('download', 15)} 백업 내보내기 (JSON)</button>
          <button class="btn sm" data-ics>${icon('calendar', 15)} 캘린더로 내보내기 (.ics)</button>
          <label class="btn sm">${icon('upload', 15)} 백업 가져오기<input type="file" accept="application/json,.json" data-import hidden></label>
        </div>
        <p class="group-label">자동 백업 (하루 한 번, 최근 7개)</p>
        ${backups.length ? `<div class="backup-list">${backups.map(b => `<div class="backup"><span>${esc(b.id.startsWith('before') ? (b.id.includes('wipe') ? '전체 삭제 직전' : '가져오기 직전') + ' · ' + new Date(b.createdAt).toLocaleString('ko-KR', { timeZone: T.TZ }) : T.fmtDate(b.id))} · ${b.count}개</span><button class="btn sm ghost" data-restore="${esc(b.id)}">이 시점으로 복원</button></div>`).join('')}</div>` : '<p class="muted small">아직 자동 백업이 없어요. 일정이 생기면 다음 날부터 매일 만들어져요.</p>'}
        <p class="group-label danger-text">위험 구역</p>
        <button class="btn sm danger" data-wipe>${icon('trash', 15)} 모든 일정 삭제</button>
      </section>
      <p class="center muted small">DAYFLOW · 당신의 하루를 기억하고, 더 나은 하루를 설계합니다.<br>시간대: 한국 표준시(Asia/Seoul) · 날씨 제공: Open-Meteo</p>`;
    bindHeader();
    const $ = s => view().querySelector(s);
    const saveField = async patch => { await S.saveSettings(patch); applyTheme(); U.toast('저장했어요.'); };
    $('#s-name').addEventListener('change', e => saveField({ name: e.target.value.trim() }));
    $('#s-city').addEventListener('change', async e => { await saveField({ city: e.target.value }); loadWeather(true); });
    $('#s-theme').addEventListener('change', e => saveField({ theme: e.target.value }));
    $('#s-auto').addEventListener('change', e => saveField({ autoBriefing: e.target.checked }));
    $('#s-morning').addEventListener('change', e => { if (T.isTime(e.target.value)) saveField({ morningTime: e.target.value }); });
    $('#s-evening').addEventListener('change', e => { if (T.isTime(e.target.value)) saveField({ eveningTime: e.target.value }); });
    $('#s-rem').addEventListener('change', e => saveField({ defaultReminder: e.target.value === '' ? null : +e.target.value }));
    const pushBtn = async (sel, fn, done) => {
      const b = $(sel);
      if (!b) return;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await fn(); U.toast(done); } catch (e) { U.toast(esc(e.message), { important: true, duration: 9000 }); }
        renderSettings();
      });
    };
    pushBtn('[data-perm]', () => DF.push.enable(), '알림을 켰어요. 앱을 닫아도 정해진 시각에 알려 드릴게요.');
    pushBtn('[data-push-test]', async () => { const r = await DF.push.test(); if (!r.ok) throw new Error('알림 서버가 보내지 못했어요 (' + r.status + '). 끄고 다시 켜 보세요.'); }, '테스트 알림을 보냈어요. 잠시 뒤 도착해요.');
    $('[data-test]').addEventListener('click', () => DF.notify.show('DAYFLOW 테스트 알림', '알림이 잘 도착했어요.', { tag: 'test-' + Date.now() }));
    $('[data-export]').addEventListener('click', async () => {
      const data = await S.exportData();
      download(`dayflow-backup-${T.now().date}.json`, JSON.stringify(data, null, 2), 'application/json');
    });
    $('[data-ics]').addEventListener('click', () => download(`dayflow-${T.now().date}.ics`, S.toICS(), 'text/calendar'));
    $('[data-import]').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch (err) { return U.toast('JSON 파일을 읽을 수 없어요.'); }
      const v = await U.choose('백업 가져오기', `<p>${esc(file.name)} 파일에서 일정 ${Array.isArray(data.events) ? data.events.length : 0}개를 찾았어요.</p><p class="muted small">합치기: 기존 일정을 유지하고 새 일정만 더해요. 덮어쓰기: 지금 일정을 백업한 뒤 파일 내용으로 바꿔요.</p>`,
        [{ id: 'cancel', label: '취소', kind: 'ghost' }, { id: 'merge', label: '합치기', kind: 'primary' }, { id: 'replace', label: '덮어쓰기', kind: 'danger' }]);
      if (v !== 'merge' && v !== 'replace') return;
      try { const n = await S.importData(data, v); U.toast(`${n}개 일정을 가져왔어요.`); renderSettings(); }
      catch (err) { U.toast(esc(err.message)); }
    });
    view().querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
      if (!(await U.confirmBox('백업 복원', '<p>현재 일정을 이 시점의 백업으로 바꿀까요? 지금 상태도 백업해 둘게요.</p>', '복원'))) return;
      try { await S.restoreBackup(b.dataset.restore); U.toast('복원했어요.'); renderSettings(); } catch (err) { U.toast(esc(err.message)); }
    }));
    $('[data-wipe]').addEventListener('click', async () => {
      if (!(await U.confirmBox('모든 일정 삭제', '<p>정말 모든 일정을 삭제할까요? 삭제 직전 상태는 자동 백업 목록에 남겨 둘게요.</p>', '모두 삭제', true))) return;
      await S.wipe();
      U.toast('모든 일정을 삭제했어요. 백업에서 되돌릴 수 있어요.');
      renderSettings();
    });
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ───────── 라우팅 ─────────
  function route() {
    const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'today').split('?');
    const name = NAV.some(n => n[0] === path) ? path : 'today';
    const params = new URLSearchParams(qs || '');
    const changed = current !== name;
    current = name;
    renderNav();
    if (name === 'today') renderToday();
    else if (name === 'calendar') renderCalendar();
    else if (name === 'assistant') renderAssistant(params);
    else if (name === 'stats') renderStats();
    else if (name === 'settings') renderSettings();
    if (changed) window.scrollTo(0, 0);
    document.title = `${NAV.find(n => n[0] === name)[1]} · DAYFLOW`;
  }
  function refresh() {
    if (document.querySelector('.modal-wrap')) { pendingRefresh = true; return; }
    if (current === 'today') renderToday(true);
    else if (current === 'calendar') renderCalendar();
    else if (current === 'stats') renderStats();
  }
  let pendingRefresh = false;
  new MutationObserver(() => {
    if (pendingRefresh && !document.querySelector('.modal-wrap')) { pendingRefresh = false; refresh(); }
  }).observe(document.getElementById('modal-root'), { childList: true });

  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  function onboarding() {
    const m = U.modal(`<div class="modal-head"><h2>DAYFLOW에 오신 걸 환영해요</h2></div>
      <div class="modal-body">
        <p>당신의 하루를 기억하고, 더 나은 하루를 설계합니다.</p>
        <label class="field full"><span>어떻게 불러 드릴까요?</span><input id="ob-name" maxlength="20" placeholder="이름 또는 닉네임 (선택)"></label>
        <ul class="plain small">
          <li>${icon('sunrise', 14)} 매일 아침 ${esc(S.settings.morningTime)}에 오늘의 브리핑을 보여 드려요.</li>
          <li>${icon('moonset', 14)} 저녁 ${esc(S.settings.eveningTime)}에는 하루를 정리하고 새 일정을 확인해요.</li>
          <li>${icon('spark', 14)} “내일 오후 5시 친구랑 축구”처럼 한 문장으로 일정을 추가할 수 있어요.</li>
        </ul>
        <p class="muted small">시간은 설정에서 바꿀 수 있어요. 일정 알림을 받으려면 브라우저 알림을 허용해 주세요.</p>
      </div>
      <div class="modal-foot">${DF.notify.permission() === 'default' ? '<button class="btn ghost" data-perm>알림 허용</button>' : ''}<span class="grow"></span><button class="btn primary" data-start>시작하기</button></div>`);
    const perm = m.el.querySelector('[data-perm]');
    if (perm) perm.addEventListener('click', async () => { let ok = true; try { await DF.push.enable(); } catch (e) { ok = Notification.permission === 'granted'; } perm.textContent = ok ? '알림 허용됨' : '알림 허용 안 됨'; perm.disabled = true; });
    m.el.querySelector('[data-start]').addEventListener('click', async () => {
      await S.saveSettings({ name: m.el.querySelector('#ob-name').value.trim() });
      await S.setKV('onboarded', true);
      m.close();
      route();
    });
  }

  async function boot() {
    try {
      await S.init();
    } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="card fatal"><h2>저장소를 열 수 없어요</h2><p>브라우저의 사이트 데이터 저장이 막혀 있는지 확인해 주세요. (${esc(e.message)})</p></div>`;
      return;
    }
    applyTheme();
    await DF.chat.load();
    await DF.push.init();
    S.onChange(() => refresh());
    S.onChange((type) => { if (type === 'settings') { applyTheme(); if (current === 'today') renderToday(true); } });
    window.addEventListener('hashchange', route);
    document.addEventListener('keydown', e => {
      if (e.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('.modal-wrap')) return;
      if (e.key === '/') { e.preventDefault(); openSearch(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd(); }
    });
    document.getElementById('fab').addEventListener('click', () => quickAdd());
    route();
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 1000);
    loadWeather();
    setInterval(() => loadWeather(), 30 * 6e4);
    if (!(await S.getKV('onboarded', false))) onboarding();
    DF.notify.start({
      morning: b => { if (!document.querySelector('.modal-wrap')) showMorning(b); },
      evening: () => {
        if (current === 'assistant' && DF.chat.evening && DF.chat.evening.waiting) return;
        U.toast('<b>하루 마감 시간이에요.</b><br>오늘을 정리하고 새 일정을 확인해 볼까요?', { action: '시작하기', duration: 30000, onAction: () => { location.hash = '#/assistant?evening=1'; } });
      }
    });
  }

  DF.app = { route, quickAdd, showMorning, openSearch };
  boot();
})(window.DF = window.DF || {});

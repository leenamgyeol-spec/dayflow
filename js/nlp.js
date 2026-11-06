/* DAYFLOW — 한국어 자연어 일정 해석기
 * "내일 오후 5시에 친구랑 축구하기" → { date, start, title, category, ... }
 * 규칙 기반이라 오프라인에서도 동작하며, 확실하지 않은 부분은 assumptions/missing으로 알려 준다.
 * 인식한 구간은 같은 길이의 공백으로 가려서(mask) 위치 정보를 유지한다. */
(function (DF) {
  'use strict';
  const T = DF.time;

  const DAYMAP = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
  const mask = (s, idx, len) => s.slice(0, idx) + ' '.repeat(len) + s.slice(idx + len);

  function upcoming(today, dow) { return T.addDays(today, (dow - T.dow(today) + 7) % 7); }
  function weekDay(today, offset, dow) { return T.addDays(T.addDays(T.weekStart(today), offset * 7), (dow + 6) % 7); }
  function weekOffset(word) {
    word = word.replace(/\s/g, '');
    if (/다다음주/.test(word)) return 2;
    if (/다음주|담주|차주/.test(word)) return 1;
    if (/지난주|저번주/.test(word)) return -1;
    return 0;
  }
  function monthDay(today, m, d, explicitYear, opts) {
    const y = T.ymd(today).y;
    if (m < 1 || m > 12 || d < 1 || d > T.daysInMonth(y, m)) return null;
    let date = T.make(explicitYear || y, m, d), assume = null;
    if (!explicitYear && opts.future && date < today) { date = T.make(y + 1, m, d); assume = '이미 지난 날짜라 내년으로 이해했어요.'; }
    return { date, assume };
  }

  // [정규식, (match, today, opts) => {date, assume} | date문자열 | null]
  const DATE_RULES = [
    [/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g, m => {
      const d = T.make(+m[1], +m[2], +m[3]);
      return T.isDate(d) && T.ymd(d).d === +m[3] ? d : null;
    }],
    [/(올해|내년)?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m, t, o) =>
      monthDay(t, +m[2], +m[3], m[1] === '내년' ? T.ymd(t).y + 1 : (m[1] ? T.ymd(t).y : null), o)],
    [/(?<![\d:./-])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m, t, o) => monthDay(t, +m[1], +m[2], null, o)],
    [/(다다음\s*주|다음\s*주|담주|차주|이번\s*주|금주|지난\s*주|저번\s*주)\s*(월|화|수|목|금|토|일)(?:요일|욜)?/g,
      (m, t) => weekDay(t, weekOffset(m[1]), DAYMAP[m[2]])],
    [/내일\s*모레/g, (m, t) => T.addDays(t, 2)],
    [/오늘|금일/g, (m, t) => t],
    [/내일|명일/g, (m, t) => T.addDays(t, 1)],
    [/모레/g, (m, t) => T.addDays(t, 2)],
    [/글피/g, (m, t) => T.addDays(t, 3)],
    [/그제|그저께/g, (m, t) => T.addDays(t, -2)],
    [/어제/g, (m, t) => T.addDays(t, -1)],
    [/(\d+)\s*일\s*(?:후|뒤)/g, (m, t) => T.addDays(t, +m[1])],
    [/(\d+)\s*주\s*(?:후|뒤)/g, (m, t) => T.addDays(t, 7 * m[1])],
    [/(\d+)\s*(?:개월|달)\s*(?:후|뒤)/g, (m, t) => T.addMonths(t, +m[1])],
    [/(?:이번\s*달|이달)\s*말|월말/g, (m, t) => T.monthEnd(t)],
    [/(?:다음\s*달|담달)\s*(\d{1,2})\s*일/g, (m, t) => {
      const n = T.addMonths(T.monthStart(t), 1), { y, m: mm } = T.ymd(n);
      return +m[1] <= T.daysInMonth(y, mm) ? T.make(y, mm, +m[1]) : null;
    }],
    [/(?:이번\s*)?주말/g, (m, t) => (T.dow(t) === 0 ? t : upcoming(t, 6))],
    [/(?<![\d월/.-])(\d{1,2})\s*일(?!\s*(?:후|뒤|간|동안|전|요))/g, (m, t, o) => {
      const { y, m: mm } = T.ymd(t), d = +m[1];
      if (d < 1 || d > 31) return null;
      let date = d <= T.daysInMonth(y, mm) ? T.make(y, mm, d) : null, assume = null;
      if ((!date || date < t) && o.future) {
        const n = T.ymd(T.addMonths(T.monthStart(t), 1));
        if (d > T.daysInMonth(n.y, n.m)) return null;
        date = T.make(n.y, n.m, d); assume = '이번 달 날짜는 지나서 다음 달로 이해했어요.';
      }
      return date ? { date, assume } : null;
    }],
    [/(월|화|수|목|금|토|일)(?:요일|욜)/g, (m, t) => upcoming(t, DAYMAP[m[1]])]
  ];

  /** 문장 속 모든 날짜 표현을 위치와 함께 찾는다. */
  function findDates(text, today, opts = {}) {
    let work = text;
    const found = [];
    for (const [re, fn] of DATE_RULES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(work))) {
        const r = fn(m, today, opts);
        if (r) {
          const v = typeof r === 'string' ? { date: r } : r;
          found.push({ index: m.index, len: m[0].length, text: m[0], date: v.date, assume: v.assume || null });
          work = mask(work, m.index, m[0].length);
        }
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    return { found: found.sort((a, b) => a.index - b.index), rest: work };
  }

  /** "이번 주", "다음 달", "주말" 같은 기간 표현 */
  function findRange(text, today) {
    let m;
    if ((m = /(이번|다음|담|다다음|지난|저번)\s*주(?!\s*(?:월|화|수|목|금|토|일)(?:요일|욜))/.exec(text))) {
      const ws = T.addDays(T.weekStart(today), weekOffset(m[1] + '주') * 7);
      return { from: ws, to: T.addDays(ws, 6), label: m[0].replace(/\s+/g, ' ') };
    }
    if ((m = /(이번|다음|담|지난|저번)\s*달|이달|이번\s*월/.exec(text))) {
      const off = /다음|담/.test(m[0]) ? 1 : /지난|저번/.test(m[0]) ? -1 : 0;
      const ms = T.addMonths(T.monthStart(today), off);
      return { from: ms, to: T.monthEnd(ms), label: m[0].replace(/\s+/g, ' ') };
    }
    if ((m = /(?<![\d/])(\d{1,2})\s*월(?!\s*\d)/.exec(text)) && +m[1] >= 1 && +m[1] <= 12) {
      const { y, m: cur } = T.ymd(today);
      const ms = T.make(+m[1] < cur ? y + 1 : y, +m[1], 1);
      return { from: ms, to: T.monthEnd(ms), label: `${+m[1]}월` };
    }
    if ((m = /주말/.exec(text))) {
      const sat = T.dow(today) === 0 ? T.addDays(today, -1) : upcoming(today, 6);
      return { from: sat, to: T.addDays(sat, 1), label: '주말' };
    }
    if ((m = /앞으로\s*(\d+)\s*일/.exec(text))) return { from: today, to: T.addDays(today, +m[1] - 1), label: m[0] };
    return null;
  }

  // ───────── 시간 ─────────
  const MARK = '(오전|오후|아침|낮|점심|저녁|밤|새벽)';
  const HM = '(\\d{1,2})(?:\\s*:\\s*(\\d{2})|\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?)';
  const RANGE_RE = new RegExp(`${MARK}?\\s*${HM}\\s*(?:부터|~|–|-|에서)\\s*${MARK}?\\s*${HM}\\s*(?:까지)?`);
  const SINGLE_RE = new RegExp(`${MARK}?\\s*${HM}\\s*(?:쯤|경|정각)?`);

  function toMinutes(mark, h, mm) {
    let assumed = null;
    h = +h; mm = +mm || 0;
    if (mark) {
      if (/오후|저녁|밤/.test(mark)) { if (h < 12) h += 12; if (mark === '밤' && h === 24) h = 0; }
      else if (/오전|아침|새벽/.test(mark)) { if (h === 12) h = 0; }
      else if (/낮|점심/.test(mark)) { if (h < 7) h += 12; }
    } else if (h >= 1 && h <= 7) { h += 12; assumed = 'pm'; }
    else if (h >= 8 && h <= 11) { assumed = 'am'; }
    if (h === 24) h = 0;
    if (h > 23 || mm > 59) return null;
    return { min: h * 60 + mm, assumed };
  }
  const minOf = (g, i) => (g[i + 2] ? +g[i + 2] : g[i + 3] ? +g[i + 3] : g[i + 4] ? 30 : 0);

  function findTime(text) {
    let m = RANGE_RE.exec(text);
    if (m) {
      const s = toMinutes(m[1], m[2], minOf(m, 1));
      let e = toMinutes(m[6] || m[1], m[7], minOf(m, 6));
      if (s && e) {
        if (!m[6] && !m[1] && e.min <= s.min && e.min + 720 > s.min && e.min < 720) e = { min: e.min + 720, assumed: e.assumed };
        if (!m[6] && m[1] && e.min <= s.min && e.min + 720 <= 1439) e = { min: e.min + 720, assumed: null };
        if (e.min > s.min) return { start: T.fromMin(s.min), end: T.fromMin(e.min), assumed: s.assumed, index: m.index, len: m[0].length };
      }
    }
    m = SINGLE_RE.exec(text);
    if (m) {
      const s = toMinutes(m[1], m[2], minOf(m, 1));
      if (s) return { start: T.fromMin(s.min), end: null, assumed: s.assumed, index: m.index, len: m[0].length };
    }
    m = /(정오|자정)/.exec(text);
    if (m) return { start: m[1] === '정오' ? '12:00' : '00:00', end: null, assumed: null, index: m.index, len: m[0].length };
    return null;
  }

  // ───────── 분류 사전 ─────────
  const CAT_WORDS = [
    ['가족', /가족|엄마|어머니|아빠|아버지|부모님|할머니|할아버지|외가|친가|동생|누나|언니|오빠|형이랑|삼촌|이모|고모|사촌|제사|명절|성묘/],
    ['운동', /운동|헬스|축구|풋살|농구|야구|수영|요가|필라테스|주짓수|태권도|합기도|유도|복싱|러닝|달리기|조깅|마라톤|등산|자전거|배드민턴|탁구|테니스|볼링|클라이밍|PT|스트레칭|산책/i],
    ['학교', /학교|수업|강의|등교|하교|조회|종례|담임|방과\s*후|수행\s*평가|학급|동아리|개학|방학식|입학|졸업|교실|급식/],
    ['공부', /공부|학원|과외|숙제|과제|시험|중간고사|기말고사|모의고사|수능|복습|예습|독서실|스터디|인강|문제집|단어|영어|수학|국어|과학|사회|한국사|코딩|자격증|토익|토플|논문|레포트|리포트/i],
    ['개인 약속', /친구|약속|만나|모임|데이트|회식|생일|파티|카페|술|밥\s*먹|저녁\s*먹|점심\s*먹|브런치|동창|선배|후배|면접|미팅|회의/],
    ['취미', /영화|게임|그림|드로잉|기타\s*연습|피아노|바이올린|악기|음악|노래|밴드|콘서트|공연|뮤지컬|전시|미술관|독서|책\s*읽|사진|여행|드라마|쇼핑|요리|베이킹|뜨개/]
  ];
  const HIGH_WORDS = /중요|꼭|반드시|필수|절대|잊지\s*말|놓치면\s*안|시험|중간고사|기말고사|모의고사|수능|면접|발표|마감|제출|병원|치과|진료|예약|수술|비행기|기차/;
  const LOW_WORDS = /가능하면|여유\s*되면|시간\s*되면|할\s*수\s*있으면|선택/;

  function classify(text) {
    let best = '기타', score = 0;
    CAT_WORDS.forEach(([cat, re]) => {
      const n = (text.match(new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : ''))) || []).length;
      if (n > score) { best = cat; score = n; }
    });
    return best;
  }

  // ───────── 제목 다듬기 ─────────
  const VERB_ENDINGS = [
    [/(\S+?)(?:으)?라고(?:\s.*)?$/, (m, stem) => stem + '기'],
    [/(\S*?)(가|와|봐|해|사|자|타|만나|먹어|읽어|써|배워|씻어|들어|챙겨|보내|받아|찍어)야\s*(?:해|돼|됨|함|한다|된다|겠다|지|겠어|할\s*듯)(?:요)?(?=[\s.!?~]|$).*$/, (m, stem, v) => stem + ({ 가: '가기', 와: '오기', 봐: '보기', 해: '하기', 사: '사기', 자: '자기', 타: '타기', 만나: '만나기', 먹어: '먹기', 읽어: '읽기', 써: '쓰기', 배워: '배우기', 씻어: '씻기', 들어: '듣기', 챙겨: '챙기기', 보내: '보내기', 받아: '받기', 찍어: '찍기' }[v])],
    [/(\S+?)기로\s*(?:했|함|하|약속).*$/, (m, stem) => stem + '기'],
    [/(할|갈|볼|먹을|만날)\s*(?:거야|거예요|거임|예정|계획).*$/, (m, v) => ({ 할: '하기', 갈: '가기', 볼: '보기', 먹을: '먹기', 만날: '만나기' }[v])],
    [/\s*(?:있어|있음|있다|있어요|있습니다|잡혔어|잡혔다|생겼어|생겼다)[.!?~]*$/, () => ''],
    [/\s*(?:해요|합니다|함|해)[.!?~]*$/, () => '']
  ];
  function cleanTitle(s) {
    s = s
      .replace(/(?:일정\s*)?(?:으로|로)?\s*(?:추가|등록|저장|잡아|넣어|기록)(?:\s*(?:해\s*줘|해줘|해\s*주세요|해주세요|해\s*줄래|해|줘|좀|줄래))*[.!?~\s]*$/, ' ')
      .replace(/(?:알림|알람|알려\s*줘|알려줘|알려\s*주세요|깨워\s*줘|깨워줘|깨워|말해\s*줘|리마인드)\s*(?:설정|맞춰\s*줘|맞춰줘|맞춰|켜\s*줘|켜줘|해\s*줘|해줘)?/g, ' ')
      .replace(/(?:^|\s)(?:좀|일정|스케줄|그리고|그날|에는|에|엔|은|는|부터|까지|쯤|경|정도|동안)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .replace(/^(?:에는|에|엔|은|는|이랑|랑)\s+/, '');
    for (const [re, fn] of VERB_ENDINGS) {
      const m = re.exec(s);
      if (m) { s = s.slice(0, m.index) + fn(m[0], m[1], m[2]); break; }
    }
    return s.replace(/[.,!?~]+$/, '').replace(/\s+/g, ' ').trim();
  }

  /** 한 문장을 일정 초안으로 해석한다. */
  function parse(input, opts = {}) {
    const today = opts.today || T.now().date;
    const text = String(input || '').replace(/\s+/g, ' ').trim();
    let work = text;
    const r = {
      raw: text, title: '', date: null, endDate: null, start: null, end: null, location: '', description: '',
      category: '기타', priority: 'normal', repeat: { freq: 'none' }, reminders: null, people: [],
      assumptions: [], missing: []
    };
    let m;

    // 1) 알림: "30분 전 알림", "하루 전에 알려줘"
    const remRe = /(\d+)\s*(분|시간)\s*전(?:에)?\s*(?:미리\s*)?(?:알림|알려\s*줘|알려줘|알려|리마인드)?|하루\s*전(?:에)?\s*(?:알림|알려\s*줘|알려줘|알려)/g;
    while ((m = remRe.exec(work))) {
      const min = m[1] ? (m[2] === '시간' ? +m[1] * 60 : +m[1]) : 1440;
      r.reminders = (r.reminders || []).concat(min);
      work = mask(work, m.index, m[0].length);
    }
    if (/알림\s*(?:없이|끄고|필요\s*없)/.test(work)) { r.reminders = []; work = work.replace(/알림\s*(?:없이|끄고|필요\s*없\S*)/, s => ' '.repeat(s.length)); }

    // 2) 반복
    const rep = [
      [/(?:매일|날마다)/, () => ({ freq: 'daily' })],
      [/(?:평일마다|매\s*평일|평일\s*매일|주중\s*매일)/, () => ({ freq: 'weekdays' })],
      [/(?:매주|매\s*주)\s*(월|화|수|목|금|토|일)(?:요일|욜)?(?:마다)?/, mm => ({ freq: 'weekly', date: upcoming(today, DAYMAP[mm[1]]) })],
      [/(월|화|수|목|금|토|일)(?:요일|욜)\s*마다/, mm => ({ freq: 'weekly', date: upcoming(today, DAYMAP[mm[1]]) })],
      [/매주/, () => ({ freq: 'weekly' })],
      [/(?:매달|매월)\s*(\d{1,2})\s*일/, mm => {
        const { y, m: mo } = T.ymd(today), d = +mm[1];
        let date = d <= T.daysInMonth(y, mo) ? T.make(y, mo, d) : null;
        if (!date || date < today) { const n = T.ymd(T.addMonths(T.monthStart(today), 1)); date = d <= T.daysInMonth(n.y, n.m) ? T.make(n.y, n.m, d) : null; }
        return { freq: 'monthly', date };
      }],
      [/매달|매월/, () => ({ freq: 'monthly' })]
    ];
    // "월수금", "매주 화목", "수금 4시" — 여러 요일 반복
    const multi = /(?:^|\s)(매주\s*)?([월화수목금토일]{2,7})(?:요일)?(마다|에는|엔|에)?(?=\s|$)/.exec(work);
    if (multi) {
      const chars = [...multi[2]];
      const unique = new Set(chars).size === chars.length;
      const after = work.slice(multi.index + multi[0].length);
      const sure = multi[1] || multi[3] === '마다' || chars.length >= 3 || /^\s*(?:오전|오후|아침|저녁|밤|\d)/.test(after);
      if (unique && sure && multi[2] !== '금일') {
        const days = chars.map(c => DAYMAP[c]);
        r.repeat = { freq: 'weekly', days };
        r.date = days.map(d => upcoming(today, d)).sort()[0];
        const lead = multi[0].length - multi[0].trimStart().length;
        work = mask(work, multi.index + lead, multi[0].length - lead);
      }
    }
    for (const [re, fn] of rep) {
      if (r.repeat.freq !== 'none') break;
      if ((m = re.exec(work))) {
        const v = fn(m);
        r.repeat = { freq: v.freq };
        r.date = v.date || today; // 반복 일정인데 날짜가 없으면 오늘부터
        work = mask(work, m.index, m[0].length);
        break;
      }
    }

    // 2-1) 지금부터 상대 시간: "1분 뒤", "30분 후", "2시간 있다가", "1시간 반 뒤"
    const relRe = /(?:(\d+)\s*시간\s*(반)?\s*)?(?:(\d+)\s*분\s*)?(?:뒤|후|있다가|이따가?)/g;
    while ((m = relRe.exec(work))) {
      if (!m[1] && !m[3]) { if (!m[0].length) relRe.lastIndex++; continue; }
      const n = T.now();
      const delta = (+m[1] || 0) * 60 + (m[2] ? 30 : 0) + (+m[3] || 0);
      const total = Math.round(n.minutes + n.s / 60 + delta);
      r.date = T.addDays(n.date, Math.floor(total / 1440));
      r.start = T.fromMin(total % 1440);
      r.relative = true;
      work = mask(work, m.index, m[0].length);
      break;
    }

    // 3) 날짜 — 여러 날 일정도 함께 본다: "12월 1일부터 12월 9일까지", "12/1~12/9", "월요일부터 수요일까지", "3박 4일", "5일 동안"
    const future = opts.future !== false;
    let spanDays = null;
    if ((m = /(\d+)\s*박\s*(\d+)\s*일/.exec(work))) { spanDays = +m[2]; work = mask(work, m.index, m[0].length); }
    else if ((m = /(\d+)\s*일\s*(?:동안|간)/.exec(work))) { spanDays = +m[1]; work = mask(work, m.index, m[0].length); }

    const RANGE_MD = /(?:(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{1,2})\/(\d{1,2}))\s*(?:부터|~|–|-|에서)\s*(?:(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{1,2})\/(\d{1,2})|(\d{1,2})\s*일)\s*(?:까지)?/;
    if ((m = RANGE_MD.exec(work)) && r.repeat.freq === 'none') {
      const sm = +(m[1] || m[3]), sd = +(m[2] || m[4]);
      const s = monthDay(today, sm, sd, null, { future });
      const em = m[5] || m[7] ? +(m[5] || m[7]) : sm, ed = +(m[6] || m[8] || m[9]);
      if (s && ed >= 1 && ed <= 31) {
        const y = T.ymd(s.date).y;
        let e = ed <= T.daysInMonth(y, em) ? T.make(y, em, ed) : null;
        if (e && e < s.date) e = m[5] || m[7] ? T.make(y + 1, em, ed) : T.addMonths(e, 1);
        if (e) {
          r.date = s.date; r.endDate = e;
          if (s.assume) r.assumptions.push(s.assume);
          work = mask(work, m.index, m[0].length);
        }
      }
    }
    const dates = findDates(work, today, { future });
    if (dates.found.length) {
      const first = dates.found[0];
      if (!r.date) r.date = first.date;
      if (first.assume) r.assumptions.push(first.assume);
      const second = dates.found[1];
      const between = second ? work.slice(first.index + first.len, second.index) : '';
      if (!r.endDate && second && r.repeat.freq === 'none' && /^\s*(?:부터|~|–|-|에서)\s*$/.test(between)) {
        let e = second.date;
        for (let i = 0; e < r.date && i < 12; i++) e = T.diff(e, r.date) < 7 ? T.addDays(e, 7) : T.addMonths(e, 1);
        r.endDate = e;
        work = mask(work, first.index + first.len, second.index - first.index - first.len);
        const tail = /^\s*까지/.exec(work.slice(second.index + second.len));
        if (tail) work = mask(work, second.index + second.len, tail[0].length);
      }
    }
    work = dates.rest.split('').map((c, i) => (work[i] === ' ' ? ' ' : c)).join('');
    if (!r.endDate && spanDays > 1 && r.date) r.endDate = T.addDays(r.date, spanDays - 1);
    if (r.endDate && (r.endDate <= r.date || T.diff(r.date, r.endDate) > 366)) r.endDate = null;
    // "매일 … 5일 동안"처럼 반복과 기간이 함께 오면 반복 종료일로 쓴다
    if (r.endDate && r.repeat.freq !== 'none') { r.repeat.until = r.endDate; r.endDate = null; }

    // 4) 기간: "2시간 동안"
    let duration = null;
    if ((m = /(\d+)\s*시간\s*(?:(\d+)\s*분)?\s*(?:동안|짜리|정도)?|(\d+)\s*분\s*(?:동안|짜리)/.exec(work)) && !/시간\s*전/.test(m[0])) {
      duration = m[3] ? +m[3] : +m[1] * 60 + (+m[2] || 0);
      work = mask(work, m.index, m[0].length);
    }

    // 5) 시간
    const tm = r.start ? null : findTime(work);
    if (tm) {
      r.start = tm.start; r.end = tm.end;
      if (tm.assumed) r.assumptions.push(`오전/오후 표시가 없어 ${josa(T.timeK(tm.start), '으로/로')} 이해했어요.`);
      work = mask(work, tm.index, tm.len);
    }
    if (r.start && !r.end && duration) r.end = T.fromMin(Math.min(T.toMin(r.start) + duration, 23 * 60 + 59));

    // 6) 장소: "강남역에서", "@스타벅스"
    if ((m = /@\s*(\S+)/.exec(work)) || (m = /(?:장소는|장소:)\s*(\S+)/.exec(work))) {
      r.location = m[1]; work = mask(work, m.index, m[0].length);
    } else if ((m = /(\S+?)\s*에서(?=\s|$)/.exec(work)) && !/^(?:거기|여기|저기)$/.test(m[1])) {
      r.location = m[1]; work = mask(work, m.index, m[0].length);
    }

    // 7) 함께하는 사람
    const pplRe = /(\S+?)(?:이랑|랑|와\s*함께|과\s*함께)(?=\s|$)/g;
    while ((m = pplRe.exec(work))) if (m[1].length <= 6) r.people.push(m[1]);

    // 8) 중요도·분류
    if (HIGH_WORDS.test(text)) r.priority = 'high';
    else if (LOW_WORDS.test(text)) r.priority = 'low';
    work = work.replace(/(?:^|\s)(?:중요한|중요|꼭|반드시|필수로|가능하면|여유\s*되면|시간\s*되면)(?=\s|$)/g, ' ');
    r.category = classify(text);

    // 9) 제목
    r.title = cleanTitle(work);
    if (!r.title && /깨워|알람/.test(text)) r.title = /알람/.test(text) ? '알람' : '기상';
    // 제목 끝에 붙은 조사 '이/가' 떼기 ("시험이 있어" → 시험). '수행평가'처럼 '가'로 끝나는 말은 남긴다
    if (/\S(이|가)$/.test(r.title) && /(있어|있음|있다|잡혔|생겼)/.test(text)) {
      const base = r.title.slice(0, -1), code = base.slice(-1).charCodeAt(0) - 0xac00;
      const batchim = code >= 0 && code < 11172 && code % 28 !== 0;
      const keep = /(평가|휴가|물가|작가|화가|축가|국가|대가)$/.test(r.title);
      if (r.title.endsWith('이') ? batchim : (!batchim && !keep)) r.title = base;
    }
    if (r.date && opts.future !== false && r.date < today && r.repeat.freq === 'none') r.assumptions.push('지난 날짜예요. 맞는지 확인해 주세요.');
    if (!r.title) r.missing.push('title');
    if (!r.date) r.missing.push('date');
    if (!r.start) r.missing.push('time');
    return r;
  }

  /** 여러 일정이 섞인 말("금요일에 저녁 약속, 토요일엔 치과")을 나눠서 해석한다. */
  function parseMany(input, opts = {}) {
    const parts = String(input || '')
      .split(/[.!?\n。]+|\s그리고\s|,\s*(?=[^,]*?(?:요일|욜|내일|모레|오늘|\d+\s*일|\d+\/\d+))/)
      .map(s => s && s.trim()).filter(Boolean);
    const out = [];
    let lastDate = null;
    parts.forEach(p => {
      const r = parse(p, opts);
      if (!r.date && lastDate && r.start) { r.date = lastDate; r.missing = r.missing.filter(x => x !== 'date'); }
      if (r.date) lastDate = r.date;
      if (r.title && r.date) out.push(r);
    });
    return out;
  }

  /** 한국어 조사: josa('영어 공부', '은/는') */
  function josa(word, pair) {
    const [a, b] = pair.split('/');
    const ch = String(word).trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return word + (/[013678]$/.test(ch) ? a : b);
    const jong = (code - 0xac00) % 28;
    if (pair === '으로/로') return word + (jong && jong !== 8 ? a : b);
    return word + (jong ? a : b);
  }

  DF.nlp = { parse, parseMany, findDates, findRange, findTime, classify, cleanTitle, josa, toMinutes };
})(window.DF = window.DF || {});

/* DAYFLOW 기본 비서 회귀 테스트 — 예상 명령 100가지
 * 실행: 로컬 서버(포트 5530)에서 앱을 연 뒤 콘솔에서
 *   await import('./tests/assistant.test.js').then(m => m.run())
 * 시험용 일정으로 저장소를 바꿔 끼우고, 끝나면 원래 일정으로 되돌린다. */
const DF = window.DF;
const T = DF.time, S = DF.store;

// ───────── 시험용 일정 (오늘 기준 상대 날짜) ─────────
function seed() {
  const d0 = T.now().date, d = n => T.addDays(d0, n);
  const ev = (id, o) => Object.assign({ id, repeat: { freq: 'none' }, reminders: [10], category: '기타', priority: 'normal' }, o);
  return [
    ev('school-mwf', { title: '학교', date: '2026-11-02', start: '08:00', end: '15:15', category: '학교', repeat: { freq: 'weekly', days: [1, 3, 5] }, reminders: [] }),
    ev('school-tt', { title: '학교', date: '2026-11-02', start: '08:00', end: '16:10', category: '학교', repeat: { freq: 'weekly', days: [2, 4] }, reminders: [] }),
    ev('math', { title: '수학 학원', date: '2026-11-02', start: '16:00', end: '18:00', category: '공부', repeat: { freq: 'weekly', days: [3, 5] } }),
    ev('jiujitsu', { title: '주짓수', date: d0, start: '23:00', end: '23:50', location: '체육관', category: '운동', priority: 'high' }),
    ev('english', { title: '영어 공부', date: d0, category: '공부' }),
    ev('dentist', { title: '치과', date: d(1), start: '10:00', end: '11:00', priority: 'high' }),
    ev('movie', { title: '민수랑 영화', date: d(1), start: '15:00', end: '17:00', location: 'CGV', category: '개인 약속', people: ['민수'] }),
    ev('family', { title: '가족 외식', date: d(2), start: '12:00', category: '가족' }),
    ev('perf', { title: '수행평가', date: d(4), category: '공부', priority: 'high' }),
    ev('spain', { title: '스페인 여행', date: '2026-11-30', endDate: '2026-12-08', category: '취미' }),
    ev('soccer1', { title: '축구', date: d(-2), start: '18:00', category: '운동', done: true }),
    ev('soccer2', { title: '축구', date: d(-5), start: '18:00', category: '운동', done: true })
  ];
}

// ───────── 날짜 도우미 ─────────
const today = () => T.now().date;
const plus = n => T.addDays(today(), n);
const next = dow => { const t = today(); const k = (dow - T.dow(t) + 7) % 7; return T.addDays(t, k); };          // 오늘 포함 다가오는 요일
const nextWeek = dow => T.addDays(T.addDays(T.weekStart(today()), 7), (dow + 6) % 7);                          // 다음 주(월 시작)의 그 요일
const inMin = m => { const n = T.now(); const t = Math.round(n.minutes + n.s / 60 + m); return { date: T.addDays(n.date, Math.floor(t / 1440)), time: T.fromMin(t % 1440) }; };

// ───────── 결과 읽기 ─────────
function lastAi() { const m = [...document.querySelectorAll('#chat-log .msg.ai')].pop(); return m || null; }
function replyText() { const m = lastAi(); return m ? m.innerText.replace(/\s+/g, ' ') : ''; }
function allNewText(before) { return [...document.querySelectorAll('#chat-log .msg.ai')].slice(before).map(m => m.innerText).join(' ').replace(/\s+/g, ' '); }
function lastForm() {
  const forms = [...document.querySelectorAll('#chat-log [data-form]')];
  const f = forms.pop();
  if (!f) return null;
  const r = DF.ui.readForm(f.parentElement);
  return r;
}
// 새로 생긴 일정, 없으면 새로 생긴 알람 (알람은 {date, start, alarm} 모양으로 맞춰서 비교)
function asEvent(a) {
  const t = DF.alarm.nextFire(a);
  return { title: a.label, start: a.time, alarm: true, days: a.days, date: t ? new Date(t + 9 * 36e5).toISOString().slice(0, 10) : a.date };
}
const added = title => S.all().find(e => e.title === title && !seedIds.has(e.id)) ||
  (DF.alarm.list().filter(a => a.label === title).map(asEvent)[0]);
const anyNew = () => S.all().find(e => !seedIds.has(e.id)) || DF.alarm.list().map(asEvent)[0];
let seedIds = new Set();

// ───────── 판정 도우미 ─────────
const has = (s, ...words) => words.every(w => s.includes(w));
const form = exp => () => {
  const f = lastForm();
  if (!f) return 'no draft card';
  for (const [k, v] of Object.entries(exp)) {
    const got = k === 'days' ? (f.repeat.days || []).slice().sort().join(',') : k === 'freq' ? f.repeat.freq : k === 'interval' ? f.repeat.interval
      : k === 'until' ? f.repeat.until : k === 'reminders' ? f.reminders.join(',') : f[k];
    const ok = v instanceof RegExp ? v.test(String(got || '')) : String(got || '') === String(v);
    if (!ok) return `${k}: got ${JSON.stringify(got)} want ${v}`;
  }
  return true;
};
const addedAs = (title, exp) => () => {
  const e = typeof title === 'function' ? title() : added(title);
  if (!e) return `not added (${title})`;
  for (const [k, v] of Object.entries(exp || {})) if (String(e[k]) !== String(v)) return `${k}: got ${e[k]} want ${v}`;
  return true;
};
const says = (...words) => () => { const t = replyText(); return has(t, ...words) || `reply: ${t.slice(0, 140)}`; };
const saysRe = re => () => { const t = replyText(); return re.test(t) || `reply: ${t.slice(0, 140)}`; };
const picks = (...titles) => () => {
  const m = lastAi();
  const t = m ? m.innerText.replace(/\s+/g, ' ') : '';
  if (!m || !m.querySelector('.pick-list,[data-act="ok"]')) return `no confirm card: ${t.slice(0, 140)}`;
  return has(t, ...titles) || `card: ${t.slice(0, 160)}`;
};
const notConfused = () => { const t = replyText(); return !/이해하지 못했어요/.test(t) || `reply: ${t.slice(0, 120)}`; };
const all = (...fns) => () => { for (const f of fns) { const r = f(); if (r !== true) return r; } return true; };

// ───────── 예상 명령 100가지 ─────────
const CASES = [
  // 추가 (1-25)
  ['내일 오후 5시에 친구랑 축구하기', () => form({ date: plus(1), start: '17:00', title: /축구/ })()],
  ['다음 주 월요일 병원 예약 추가해 줘', () => form({ date: nextWeek(1), title: /병원/ })()],
  ['모레 오후 2시 반에 미용실', () => form({ date: plus(2), start: '14:30', title: /미용실/ })()],
  ['11월 20일 기말고사', () => form({ date: '2026-11-20', title: /기말고사/ })()],
  ['12/3 오후 4시 동아리 회의', () => form({ date: '2026-12-03', start: '16:00', title: /동아리 회의/ })()],
  ['다음주 수요일 수행평가 있어', () => form({ date: nextWeek(3), title: /^수행평가$/ })()],
  ['토요일 저녁 7시 강남역에서 친구 만나기', () => form({ date: next(6), start: '19:00', location: '강남역', title: /친구 만나기/ })()],
  ['매주 화목 오후 7시 주짓수 추가', () => form({ freq: 'weekly', days: '2,4', start: '19:00', title: /^주짓수$/ })()],
  ['매일 밤 10시에 일기 쓰기', () => form({ freq: 'daily', start: '22:00', title: /일기 쓰기/ })()],
  ['오늘 밤 11시에 자기', () => form({ date: today(), start: '23:00', title: /자기/ })()],
  ['내일 아침 8시 반에 등교', () => form({ date: plus(1), start: '08:30', title: /등교/ })()],
  ['12월 24일부터 26일까지 가족 여행', () => form({ date: '2026-12-24', endDate: '2026-12-26', title: /가족 여행/ })()],
  ['3일 뒤 오후 6시 엄마 생신', () => form({ date: plus(3), start: '18:00', title: /엄마 생신/ })()],
  ['이번 주 일요일 3시 피아노', () => form({ date: next(0), start: '15:00', title: /피아노/ })()],
  ['다음 주 금요일에 친구랑 저녁 먹기로 했어', () => form({ date: nextWeek(5), title: /저녁 먹기/ })()],
  ['다다음주 토요일 캠핑', () => form({ date: T.addDays(nextWeek(6), 7), title: /캠핑/ })()],
  ['수요일 3시 15분 상담', () => form({ date: next(3), start: '15:15', title: /상담/ })()],
  ['내일 정오에 점심 약속', () => form({ date: plus(1), start: '12:00', title: /점심 약속/ })()],
  ['15일 과제 제출', () => form({ date: '2026-11-15', title: /과제 제출/ })()],
  ['다음 달 5일 영어 시험', () => form({ date: '2026-12-05', title: /영어 시험/ })()],
  ['내일 오후 3시부터 5시까지 도서관에서 공부', () => form({ date: plus(1), start: '15:00', end: '17:00', location: '도서관', title: /공부/ })()],
  ['내일 9시 학원 보강 꼭 가야 함', () => form({ date: plus(1), start: '09:00', priority: 'high', title: /학원 보강/ })()],
  ['일요일 오전 10시 교회', () => form({ date: next(0), start: '10:00', title: /교회/ })()],
  ['다음 주 화요일 저녁에 독서실', () => form({ date: nextWeek(2), title: /독서실/ })()],
  ['내일 오후 4시 30분 피부과 30분 전에 알려줘', () => form({ date: plus(1), start: '16:30', reminders: '30', title: /^피부과$/ })()],

  // 알려 주기 (26-37)
  ['1분뒤에 씻으라고 알려줘', () => addedAs('씻기', inMinObj(1))()],
  ['30분 후에 숙제하라고 알려줘', () => addedAs('숙제하기', inMinObj(30))()],
  ['10분 있다가 라면 꺼내라고 알려줘', () => addedAs('라면 꺼내기', inMinObj(10))()],
  ['1시간 뒤에 알려줘', () => addedAs('알람', inMinObj(60))()],
  ['내일 아침 7시에 깨워줘', () => addedAs('기상', { date: plus(1), start: '07:00' })()],
  ['7시에 알람 맞춰줘', () => addedAs(anyNew, { start: '07:00', alarm: true })()],
  ['밤 10시에 약 먹으라고 알려줘', () => addedAs('약 먹기', { start: '22:00' })()],
  ['5분 뒤에 빨래 꺼내라고 해줘', () => addedAs('빨래 꺼내기', inMinObj(5))()],
  ['20분 뒤에 알림', () => addedAs('알람', inMinObj(20))()],
  ['2시간 뒤에 엄마한테 전화하라고 알려줘', () => addedAs('엄마한테 전화하기', inMinObj(120))()],
  ['내일 오후 3시에 은행 가라고 알려줘', () => addedAs('은행 가기', { date: plus(1), start: '15:00' })()],
  ['30분마다 물 마시라고 알려줘', notConfused],

  // 조회 (38-57)
  ['오늘 일정 알려줘', says('영어 공부', '주짓수')],
  ['오늘 뭐 있어?', says('영어 공부', '주짓수')],
  ['내일 뭐해?', says('치과', '민수랑 영화')],
  ['내일 일정', says('치과', '민수랑 영화')],
  ['모레 스케줄', says('가족 외식')],
  ['이번 주 일정 보여줘', says('치과', '가족 외식')],
  ['다음 주 일정', says('수행평가')],
  ['주말에 뭐 있어?', says('치과', '가족 외식')],
  ['12월 일정 알려줘', says('스페인 여행')],
  ['다음 일정 뭐야?', says('주짓수')],
  ['지금 뭐 해야 돼?', says('주짓수')],
  ['치과 언제야?', says('치과', T.fmtDate(T.addDays(T.now().date, 1)).split(' (')[0])],
  ['학원 몇 시야?', says('수학 학원', '16:00')],
  ['민수랑 약속 언제였지?', says('민수랑 영화')],
  ['스페인 여행 언제 가?', says('스페인 여행', '11월 30일')],
  ['이번 달 일정 몇 개야?', saysRe(/\d+개/)],
  ['수요일에 뭐 있어?', says('학교', '수학 학원')],
  ['11월 20일에 뭐 있어?', says('11월 20일')],
  ['어제 뭐 했어?', notConfused],
  ['오늘 남은 일정', says('주짓수')],

  // 분석 (58-67)
  ['이번 주에 가장 바쁜 날은?', says('가장 바쁜 날')],
  ['다음 주 가장 한가한 날', says('가장 여유로운 날')],
  ['이번 달에 운동 몇 번 했어?', says('운동')],
  ['이번 주 학원 몇 번 가?', saysRe(/수학 학원|학원.*\d+번/)],
  ['오늘 가장 먼저 준비할 건?', says('주짓수')],
  ['내일 빈 시간 알려줘', says('빈 시간')],
  ['오늘 몇 시에 끝나?', says('23:50')],
  ['통계 보여줘', says('이번 주 일정')],
  ['앞으로 바쁜 날 있어?', notConfused],
  ['이번 주 완료율', saysRe(/완료율|완료/)],

  // 옮기기·바꾸기 (68-79)
  ['내일 일정을 일요일로 옮겨줘', picks('치과', '민수랑 영화')],
  ['치과 일정을 다음 주 월요일로 옮겨줘', all(picks('치과'), says(T.fmtDate(nextWeek(1)).split(' (')[0]))],
  ['치과 다음 주로 미뤄줘', all(picks('치과'), says(T.fmtDate(T.addDays(plus(1), 7)).split(' (')[0]))],
  ['영화 오후 5시로 바꿔줘', all(picks('민수랑 영화'), says('17:00'))],
  ['주짓수 30분 뒤로 미뤄', all(picks('주짓수'), says('23:30'))],
  ['치과 1시간 당겨줘', all(picks('치과'), says('09:00'))],
  ['가족 외식 토요일로 변경', all(picks('가족 외식'), says(T.fmtDate(next(6)).split(' (')[0]))],
  ['영어 공부 내일로 미뤄', all(picks('영어 공부'), says('내일'))],
  ['수행평가 날짜 목요일로 바꿔줘', all(picks('수행평가'), says(T.fmtDate(T.addDays(plus(4), 2)).split(' (')[0]))],
  ['내일 치과 2시로 바꿔', all(picks('치과'), says('14:00'))],
  ['영화 장소 메가박스로 바꿔줘', all(picks('민수랑 영화'), says('메가박스'))],
  ['가족 외식 중요 일정으로 표시해 줘', all(picks('가족 외식'), says('중요'))],

  // 지우기 (80-87)
  ['치과 일정 취소해 줘', picks('치과')],
  ['내일 영화 삭제', picks('민수랑 영화')],
  ['오늘 영어 공부 안 할래', picks('영어 공부')],
  ['가족 외식 취소됐어', picks('가족 외식')],
  ['스페인 여행 지워줘', picks('스페인 여행')],
  ['오늘 학원 빠질래', picks('수학 학원')],
  ['내일 일정 다 지워줘', picks('치과', '민수랑 영화')],
  ['주짓수 일정 없애줘', picks('주짓수')],

  // 완료 (88-93)
  ['영어 공부 다 했어', picks('영어 공부')],
  ['주짓수 끝났어', picks('주짓수')],
  ['학원 다녀왔어', picks('수학 학원')],
  ['오늘 일정 다 끝냈어', picks('영어 공부', '주짓수')],
  ['숙제 완료', notConfused],
  ['학교 마쳤어', picks('학교')],

  // 대화·기타 (94-100)
  ['안녕', saysRe(/안녕/)],
  ['고마워', saysRe(/천만|별말|도움|언제든/)],
  ['뭐 할 수 있어?', says('일정')],
  ['아침 브리핑', saysRe(/일정|브리핑/)],
  ['하루 마감 시작', says('오늘 하루는 어떠셨나요')],
  ['ㅎㅇ', saysRe(/안녕/)],
  ['오늘 날씨 어때?', saysRe(/날씨|°/)],

  // 알람 (101-106): "몇 시에 ~하라고 해줘"
  ['7시에 씻으라고 해줘', () => addedAs('씻기', Object.assign(nearest(7, 0), { alarm: true }))()],
  ['10시 반에 자라고 해줘', () => addedAs('자기', nearest(10, 30))()],
  ['아침 7시 알람', () => addedAs('알람', { date: atOrNext('07:00'), start: '07:00', alarm: true })()],
  ['알람 6시 30분', () => addedAs('알람', { date: atOrNext('06:30'), start: '06:30' })()],
  ['매일 아침 7시에 일어나라고 해줘', () => addedAs('일어나기', { start: '07:00' })()],
  ['오후 3시에 약 먹으라고 해줘', () => addedAs('약 먹기', { date: atOrNext('15:00'), start: '15:00' })()],

  // 반복 일정 (107-122)
  ['격주 화요일 오후 4시 피아노', () => form({ freq: 'weekly', interval: 2, days: '2', start: '16:00', title: /^피아노$/ })()],
  ['2주마다 월수 영어 회화', () => form({ freq: 'weekly', interval: 2, days: '1,3', title: /영어 회화/ })()],
  ['3일마다 화분에 물 주기', () => form({ freq: 'daily', interval: 3, title: /물 주기/ })()],
  ['이틀마다 운동', () => form({ freq: 'daily', interval: 2, title: /^운동$/ })()],
  ['2달마다 미용실 가기', () => form({ freq: 'monthly', interval: 2, title: /미용실/ })()],
  ['매년 3월 15일 엄마 생일', () => form({ freq: 'yearly', date: '2027-03-15', title: /엄마 생일/ })()],
  ['주말마다 오전 10시 수영', () => form({ freq: 'weekly', days: '0,6', start: '10:00', title: /^수영$/ })()],
  ['12월까지 매주 화요일 피아노 추가', () => form({ freq: 'weekly', days: '2', until: '2026-12-31', title: /^피아노$/ })()],
  ['12월 20일까지 매일 아침 7시 조깅', () => form({ freq: 'daily', until: '2026-12-20', start: '07:00', title: /조깅/ })()],
  ['다음 달 1일부터 매주 목요일 오후 6시 기타 레슨', () => form({ freq: 'weekly', days: '4', date: '2026-12-03', start: '18:00', title: /기타 레슨/ })()],
  ['매주 금요일 7시 축구 10번만', () => form({ freq: 'weekly', days: '5', until: T.addDays(next(5), 63), title: /^축구$/ })()],
  ['매달 5일 용돈 받기', () => form({ freq: 'monthly', date: '2026-12-05', title: /용돈 받기/ })()],
  ['평일마다 7시 반 기상', () => form({ freq: 'weekdays', start: '07:30', title: /기상/ })()],
  ['매주 월수금 오후 5시 헬스', () => form({ freq: 'weekly', days: '1,3,5', start: '17:00', title: /헬스/ })()],
  ['매일 밤 10시 일기', () => form({ freq: 'daily', start: '22:00', title: /일기/ })()],
  ['매주 일요일 교회 추가해 줘', () => form({ freq: 'weekly', days: '0', date: next(0), title: /교회/ })()]
];
/** 오전/오후를 안 말했을 때 가장 가까운 앞으로의 시각 */
function nearest(h, m) {
  const c = [];
  [today(), plus(1)].forEach(d => [h, h + 12].forEach(hh => c.push({ date: d, start: T.fromMin(hh * 60 + m) })));
  return c.filter(x => T.epoch(x.date, x.start) > Date.now()).sort((a, b) => T.epoch(a.date, a.start) - T.epoch(b.date, b.start))[0];
}
function atOrNext(time) { return T.epoch(today(), time) > Date.now() ? today() : plus(1); }
function inMinObj(m) { const x = inMin(m); return { date: x.date, start: x.time }; }

export async function run(filter) {
  const backup = S.all();
  const chatBackup = await S.getKV('chat', []);
  const alarmBackup = DF.alarm.list();
  const clearAlarms = async () => { for (const a of DF.alarm.list()) await DF.alarm.remove(a.id); };
  seedIds = new Set(seed().map(e => e.id));
  DF.push.call = async () => { const e = new Error('no key'); e.code = 'no_key'; throw e; };
  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    if (filter && !filter.includes(i + 1)) continue;
    const [say, check] = CASES[i];
    await S.importData({ app: 'dayflow', events: seed() }, 'replace');
    await DF.chat.clear();
    await clearAlarms();
    if (location.hash !== '#/assistant') { location.hash = '#/assistant'; await new Promise(r => setTimeout(r, 300)); }
    let r;
    try { await DF.chat.handle(say); r = check(); } catch (e) { r = 'ERROR ' + e.message; }
    results.push({ n: i + 1, say, ok: r === true, why: r === true ? '' : r });
  }
  await S.importData({ app: 'dayflow', events: backup }, 'replace');
  await S.setKV('chat', chatBackup);
  await clearAlarms();
  for (const a of alarmBackup) await DF.alarm.add(a);
  const fails = results.filter(x => !x.ok);
  console.table(fails);
  return { pass: results.length - fails.length, total: results.length, fails };
}

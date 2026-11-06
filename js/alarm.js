/* DAYFLOW — 알람 (아이폰 시계 앱 알람처럼)
 * 앱이 꺼져 있어도 울리도록 푸시 서버로만 울린다: 알람 시각부터 1분 간격으로 5번 알림을 보낸다.
 * 알림을 눌러 '중단'하면 남은 알림을 취소하고, '다시 알림'을 누르면 9분 뒤에 다시 5번 보낸다.
 * 저장: kv 'alarms' = [{ id, time, label, days, date, enabled }], kv 'alarmState' = { stopped, snooze } */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store;

  const RINGS = 5;          // 한 번 울릴 때 보내는 알림 수
  const RING_GAP = 60e3;    // 알림 간격 1분
  const SNOOZE_MIN = 9;     // 다시 알림 9분 (아이폰과 같다)

  let alarms = [];
  let state = { stopped: {}, snooze: {} };
  const listeners = new Set();

  function uid() { return 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function normalize(a) {
    const days = Array.isArray(a.days) ? [...new Set(a.days.map(Number).filter(d => d >= 0 && d <= 6))].sort() : [];
    return {
      id: a.id || uid(),
      time: T.isTime(a.time) ? a.time : '07:00',
      label: String(a.label || '').trim().slice(0, 40) || '알람',
      days,
      // 반복이 없으면 한 번만: 울릴 날짜를 정해 둔다
      date: days.length ? null : (T.isDate(a.date) ? a.date : nextOnce(T.isTime(a.time) ? a.time : '07:00')),
      enabled: a.enabled !== false,
      createdAt: a.createdAt || Date.now()
    };
  }
  /** 반복 없는 알람: 오늘 그 시각이 지났으면 내일 */
  function nextOnce(time) {
    const d = T.now().date;
    return T.epoch(d, time) > Date.now() ? d : T.addDays(d, 1);
  }

  async function load() {
    alarms = (await S.getKV('alarms', [])).map(normalize);
    state = Object.assign({ stopped: {}, snooze: {} }, await S.getKV('alarmState', {}));
    // 한 번 울리는 알람은 시각이 지나면 꺼진 상태로 (아이폰처럼)
    let changed = false;
    alarms.forEach(a => { if (a.enabled && a.date && T.epoch(a.date, a.time) + RINGS * RING_GAP < Date.now()) { a.enabled = false; changed = true; } });
    pruneState();
    if (changed) await save();
  }
  function pruneState() {
    const old = Date.now() - 2 * 864e5;
    Object.keys(state.stopped).forEach(k => { if (+k.split('@')[1] < old) delete state.stopped[k]; });
    Object.keys(state.snooze).forEach(k => { if (state.snooze[k] < Date.now() - RINGS * RING_GAP) delete state.snooze[k]; });
  }
  async function save() {
    await S.setKV('alarms', alarms);
    await S.setKV('alarmState', state);
    listeners.forEach(fn => fn());
    if (DF.push) DF.push.sync();
  }

  function list() { return alarms.slice().sort((a, b) => a.time.localeCompare(b.time)); }
  function get(id) { return alarms.find(a => a.id === id) || null; }
  async function add(data) { const a = normalize(data); alarms.push(a); await save(); return a; }
  async function update(id, patch) {
    const i = alarms.findIndex(a => a.id === id);
    if (i < 0) return null;
    const merged = Object.assign({}, alarms[i], patch);
    // 반복 없는 알람을 다시 켜거나 시각을 바꾸면 다음 그 시각으로
    if (!(merged.days || []).length && (patch.enabled || patch.time || patch.days)) merged.date = nextOnce(merged.time);
    alarms[i] = normalize(merged);
    await save();
    return alarms[i];
  }
  async function remove(id) { alarms = alarms.filter(a => a.id !== id); await save(); }

  /** from~to 사이에 울릴 시각들 (epoch ms) */
  function fires(a, from, to) {
    const out = [];
    if (!a.enabled) return out;
    if (a.date) {
      const t = T.epoch(a.date, a.time);
      if (t >= from && t <= to) out.push(t);
    } else {
      for (let d = T.now().date, i = 0; i < 40; d = T.addDays(d, 1), i++) {
        if (!a.days.includes(T.dow(d))) continue;
        const t = T.epoch(d, a.time);
        if (t > to) break;
        if (t >= from) out.push(t);
      }
    }
    const sz = state.snooze[a.id];
    if (sz && sz >= from && sz <= to) out.push(sz);
    return out.sort((x, y) => x - y);
  }
  function nextFire(a) { return fires(a, Date.now(), Date.now() + 8 * 864e5)[0] || null; }

  /** 푸시 서버에 올릴 알람 알림: 울리는 시각마다 1분 간격 5번 (중단한 것은 뺀다) */
  function pushItems(days) {
    const now = Date.now(), items = [];
    alarms.forEach(a => {
      fires(a, now - RINGS * RING_GAP, now + days * 864e5).forEach(t => {
        if (state.stopped[a.id + '@' + t]) return;
        for (let k = 0; k < RINGS; k++) {
          const at = t + k * RING_GAP;
          if (at <= now) continue;
          items.push({
            at, important: true, url: `#/alarm?ring=${a.id}&at=${t}`, tag: `alarm:${a.id}:${t}:${k}`,
            title: `⏰ ${a.label}`,
            body: `${T.timeK(new Date(t + 9 * 36e5).toISOString().slice(11, 16))} 알람${k ? ` · ${k + 1}번째 알림` : ''} — 눌러서 끄기`
          });
        }
      });
    });
    return items;
  }

  /** 알림을 눌러 들어와 '중단' */
  async function stop(id, at) {
    state.stopped[id + '@' + at] = true;
    if (state.snooze[id] === +at) delete state.snooze[id];
    const a = get(id);
    if (a && a.date) a.enabled = false; // 한 번 울리는 알람은 끈다
    await save();
  }
  /** '다시 알림' — 지금부터 9분 뒤 */
  async function snooze(id, at) {
    state.stopped[id + '@' + at] = true;
    state.snooze[id] = Date.now() + SNOOZE_MIN * 6e4;
    await save();
    return state.snooze[id];
  }

  /** "평일", "주말", "매일", "월 화 목" — 아이폰 시계 앱과 같은 표기 */
  function repeatText(a) {
    const d = a.days;
    if (!d.length) return '';
    if (d.length === 7) return '매일';
    if (d.join() === '1,2,3,4,5') return '평일';
    if (d.join() === '0,6') return '주말';
    return [1, 2, 3, 4, 5, 6, 0].filter(x => d.includes(x)).map(x => T.DOW[x]).join(' ');
  }

  DF.alarm = {
    RINGS, SNOOZE_MIN, load, list, get, add, update, remove, fires, nextFire, pushItems, stop, snooze, repeatText,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };
})(window.DF = window.DF || {});

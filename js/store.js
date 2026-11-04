/* DAYFLOW — 일정 도메인 계층
 * 메모리 캐시 + IndexedDB 쓰기. 모든 변경은 저장이 끝난 뒤 'change'를 알리고,
 * 다른 탭에도 BroadcastChannel로 전파한다. */
(function (DF) {
  'use strict';
  const T = DF.time, DB = DF.db;

  const CATEGORIES = ['학교', '공부', '운동', '개인 약속', '가족', '취미', '기타'];
  const CAT_COLOR = {
    '학교': '#3e63dd', '공부': '#7b5cd6', '운동': '#2f9e6b', '개인 약속': '#d9730d',
    '가족': '#d6457a', '취미': '#0f9bb5', '기타': '#868e96'
  };
  const PRIORITY = { high: '높음', normal: '보통', low: '낮음' };
  const REPEAT = { none: '반복 안 함', daily: '매일', weekdays: '평일마다', weekly: '매주', monthly: '매달' };
  const DEFAULT_SETTINGS = {
    name: '', morningTime: '07:30', eveningTime: '21:00', city: '서울', theme: 'system',
    defaultReminder: 10, autoBriefing: true
  };

  const state = { events: new Map(), settings: { ...DEFAULT_SETTINGS }, ready: false };
  const listeners = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('dayflow') : null;

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function emit(type, detail) { listeners.forEach(fn => { try { fn(type, detail); } catch (e) { console.error(e); } }); }
  function broadcast(type) { if (bc) bc.postMessage({ type }); }

  /** 저장 전에 모든 필드를 검증·보정한다. 잘못된 값은 버리고 안전한 기본값을 쓴다. */
  function normalize(raw) {
    const today = T.now().date;
    const e = Object.assign({}, raw);
    e.id = e.id || uid();
    e.title = String(e.title || '').trim().slice(0, 120) || '제목 없는 일정';
    e.date = T.isDate(e.date) ? e.date : today;
    e.start = T.isTime(e.start) ? e.start : null;
    e.end = e.start && T.isTime(e.end) && T.toMin(e.end) > T.toMin(e.start) ? e.end : null;
    e.location = String(e.location || '').trim().slice(0, 120);
    e.description = String(e.description || '').trim().slice(0, 2000);
    e.priority = PRIORITY[e.priority] ? e.priority : 'normal';
    e.category = CATEGORIES.includes(e.category) ? e.category : '기타';
    const rp = e.repeat && typeof e.repeat === 'object' ? e.repeat : { freq: e.repeat || 'none' };
    e.repeat = { freq: REPEAT[rp.freq] ? rp.freq : 'none', until: T.isDate(rp.until) ? rp.until : null };
    // 여러 날 일정: date ~ endDate (반복 일정과 함께 쓰지 않는다, 최대 1년)
    e.endDate = e.repeat.freq === 'none' && T.isDate(e.endDate) && e.endDate > e.date && T.diff(e.date, e.endDate) <= 366 ? e.endDate : null;
    e.reminders = Array.isArray(e.reminders)
      ? [...new Set(e.reminders.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 10080))].sort((a, b) => a - b)
      : [];
    e.done = !!e.done;
    e.completions = e.completions && typeof e.completions === 'object' ? e.completions : {};
    e.skip = Array.isArray(e.skip) ? e.skip.filter(T.isDate) : [];
    e.pendingDecision = !!e.pendingDecision;
    e.people = Array.isArray(e.people) ? e.people.slice(0, 10) : [];
    e.createdAt = e.createdAt || Date.now();
    e.updatedAt = e.updatedAt || Date.now();
    return e;
  }

  async function init() {
    await DB.open();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    const [events, kv] = await Promise.all([DB.all('events'), DB.all('kv')]);
    events.forEach(e => state.events.set(e.id, normalize(e)));
    const settings = kv.find(x => x.key === 'settings');
    state.settings = Object.assign({}, DEFAULT_SETTINGS, settings ? settings.value : {});
    state.ready = true;
    await dailyBackup();
    if (bc) bc.onmessage = async msg => {
      if (msg.data && msg.data.type === 'events') {
        const fresh = await DB.all('events');
        state.events = new Map(fresh.map(e => [e.id, normalize(e)]));
        emit('change', { remote: true });
      } else if (msg.data && msg.data.type === 'settings') {
        const s = await DB.get('kv', 'settings');
        state.settings = Object.assign({}, DEFAULT_SETTINGS, s ? s.value : {});
        emit('settings', { remote: true });
      }
    };
  }

  // ───────── kv ─────────
  async function getKV(key, def) {
    const row = await DB.get('kv', key);
    return row === undefined ? def : row.value;
  }
  function setKV(key, value) { return DB.put('kv', { key, value }); }

  async function saveSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    await setKV('settings', state.settings);
    try { localStorage.setItem('dayflow:theme', JSON.stringify(state.settings.theme)); } catch (e) { /* 선택 사항 */ }
    emit('settings');
    broadcast('settings');
  }

  // ───────── 일정 CRUD ─────────
  async function add(data) {
    const ev = normalize(Object.assign({}, data, { id: uid(), createdAt: Date.now(), updatedAt: Date.now() }));
    await DB.put('events', ev);
    state.events.set(ev.id, ev);
    emit('change', { added: ev });
    broadcast('events');
    return ev;
  }
  async function update(id, patch) {
    const cur = state.events.get(id);
    if (!cur) throw new Error('일정을 찾을 수 없어요.');
    const ev = normalize(Object.assign({}, cur, patch, { id, updatedAt: Date.now() }));
    await DB.put('events', ev);
    state.events.set(id, ev);
    emit('change', { updated: ev });
    broadcast('events');
    return ev;
  }
  async function remove(id) {
    const cur = state.events.get(id);
    if (!cur) return null;
    await DB.del('events', id);
    state.events.delete(id);
    emit('change', { removed: cur });
    broadcast('events');
    return cur;
  }
  async function restore(ev) {
    const e = normalize(ev);
    await DB.put('events', e);
    state.events.set(e.id, e);
    emit('change', { restored: e });
    broadcast('events');
    return e;
  }
  function get(id) { return state.events.get(id) || null; }
  function all() { return [...state.events.values()]; }

  // ───────── 반복·여러 날 일정 펼치기 ─────────
  /** 날짜별로 따로 완료·삭제되는 일정(반복 또는 여러 날) */
  function isSeries(ev) { return ev.repeat.freq !== 'none' || !!ev.endDate; }
  function lastDate(ev) { return ev.endDate || (ev.repeat.freq === 'none' ? ev.date : ev.repeat.until); }
  function occursOn(ev, date) {
    if (date < ev.date) return false;
    if (ev.repeat.until && date > ev.repeat.until) return false;
    if (ev.skip.includes(date)) return false;
    switch (ev.repeat.freq) {
      case 'none': return date === ev.date || (!!ev.endDate && date <= ev.endDate);
      case 'daily': return true;
      case 'weekdays': { const d = T.dow(date); return d >= 1 && d <= 5; }
      case 'weekly': return T.dow(date) === T.dow(ev.date);
      case 'monthly': return T.ymd(date).d === T.ymd(ev.date).d;
      default: return false;
    }
  }
  function toOcc(ev, date) {
    return Object.assign({}, ev, {
      occDate: date,
      key: ev.id + '@' + date,
      isRepeat: isSeries(ev),
      isMulti: !!ev.endDate,
      dayIndex: ev.endDate ? T.diff(ev.date, date) + 1 : null,
      dayTotal: ev.endDate ? T.diff(ev.date, ev.endDate) + 1 : null,
      done: isSeries(ev) ? !!ev.completions[date] : ev.done
    });
  }
  function sortOcc(a, b) {
    if (a.occDate !== b.occDate) return a.occDate < b.occDate ? -1 : 1;
    const as = a.start ? T.toMin(a.start) : -1, bs = b.start ? T.toMin(b.start) : -1;
    if (as !== bs) return as - bs;
    const pr = { high: 0, normal: 1, low: 2 };
    return pr[a.priority] - pr[b.priority] || a.title.localeCompare(b.title, 'ko');
  }
  function occurrences(from, to) {
    const out = [];
    for (const ev of state.events.values()) {
      if (!isSeries(ev)) {
        if (ev.date >= from && ev.date <= to) out.push(toOcc(ev, ev.date));
        continue;
      }
      const start = ev.date > from ? ev.date : from;
      const last = lastDate(ev);
      const end = last && last < to ? last : to;
      for (let d = start; d <= end; d = T.addDays(d, 1)) if (occursOn(ev, d)) out.push(toOcc(ev, d));
    }
    return out.sort(sortOcc);
  }
  function on(date) { return occurrences(date, date); }

  // ───────── 상태 변경 ─────────
  async function setDone(occ, done) {
    const ev = get(occ.id);
    if (!ev) return;
    if (!isSeries(ev)) return update(ev.id, { done, pendingDecision: false });
    const completions = Object.assign({}, ev.completions);
    if (done) completions[occ.occDate] = true; else delete completions[occ.occDate];
    return update(ev.id, { completions });
  }
  /** 일정 하나를 다른 날짜(·시간)로 옮긴다. 반복·여러 날 일정은 그날만 빼고 단일 일정으로 복사한다. */
  async function moveOcc(occ, date, start) {
    const ev = get(occ.id);
    if (!ev) return null;
    let times = {};
    if (start !== undefined) {
      const dur = ev.start && ev.end ? T.toMin(ev.end) - T.toMin(ev.start) : null;
      times = { start, end: start && dur ? T.fromMin(T.toMin(start) + dur) : (start ? null : null) };
      if (!start) times.end = null;
    }
    if (!isSeries(ev)) return update(ev.id, Object.assign({ date, done: false, pendingDecision: false }, times));
    await update(ev.id, { skip: ev.skip.concat(occ.occDate) });
    const copy = Object.assign({}, ev, { date, endDate: null, repeat: { freq: 'none' }, done: false, completions: {}, skip: [], seriesId: ev.id }, times);
    delete copy.id;
    return add(copy);
  }
  async function skipOcc(occ) {
    const ev = get(occ.id);
    if (!ev) return;
    return update(ev.id, { skip: ev.skip.concat(occ.occDate) });
  }

  // ───────── 충돌·중복 감지 ─────────
  const DEFAULT_LEN = 60;
  function span(o) {
    const s = T.toMin(o.start);
    return [s, o.end ? T.toMin(o.end) : s + DEFAULT_LEN];
  }
  function conflicts(cand, excludeId) {
    if (!cand.start || !T.isDate(cand.date)) return [];
    const [s, e] = span(cand);
    // 여러 날 일정은 매일 같은 시간에 열리는 것으로 보고 모든 날을 확인한다 (최대 31일)
    const last = T.isDate(cand.endDate) && cand.endDate > cand.date ? cand.endDate : cand.date;
    const to = T.diff(cand.date, last) > 30 ? T.addDays(cand.date, 30) : last;
    return occurrences(cand.date, to).filter(o => {
      if (o.id === excludeId || !o.start) return false;
      const [os, oe] = span(o);
      return s < oe && os < e;
    });
  }
  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  function duplicates(cand, excludeId) {
    if (!T.isDate(cand.date)) return [];
    const t = norm(cand.title);
    return on(cand.date).filter(o => o.id !== excludeId && norm(o.title) === t);
  }
  /** date에서 duration(분)만큼 비어 있는 가장 이른 시간. 08:00~23:00 사이에서 찾는다. */
  function freeSlot(date, duration, afterMin, excludeId) {
    const busy = on(date).filter(o => o.start && o.id !== excludeId).map(span).sort((a, b) => a[0] - b[0]);
    let t = Math.max(afterMin || 0, 8 * 60);
    for (const [s, e] of busy) {
      if (s - t >= duration) break;
      if (e > t) t = e;
    }
    t = Math.ceil(t / 10) * 10;
    return t + duration <= 23 * 60 ? T.fromMin(t) : null;
  }
  function gapsOn(date, fromMin) {
    const busy = on(date).filter(o => o.start).map(o => ({ o, s: span(o)[0], e: span(o)[1] }));
    const gaps = [];
    let t = fromMin != null ? fromMin : null;
    busy.forEach(b => {
      if (t != null && b.s - t > 0) gaps.push({ from: t, to: b.s, len: b.s - t });
      t = t == null ? b.e : Math.max(t, b.e);
    });
    return gaps;
  }

  // ───────── 검색 ─────────
  function search(q, opts = {}) {
    const today = T.now().date;
    const words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all().filter(ev => {
      if (opts.category && ev.category !== opts.category) return false;
      if (opts.scope === 'past' && ev.date >= today && ev.repeat.freq === 'none') return false;
      if (opts.scope === 'future' && (ev.endDate || ev.date) < today && ev.repeat.freq === 'none') return false;
      if (opts.status === 'done' && !ev.done) return false;
      if (opts.status === 'open' && ev.done) return false;
      if (!words.length) return true;
      const hay = [ev.title, ev.location, ev.description, ev.category, ev.people.join(' ')].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // ───────── 백업·내보내기 ─────────
  async function dailyBackup() {
    const today = T.now().date;
    const last = await getKV('lastBackup', null);
    if (last === today || !state.events.size) return;
    await DB.put('backups', { id: today, createdAt: Date.now(), events: all(), settings: state.settings });
    const list = (await DB.all('backups')).sort((a, b) => (a.id < b.id ? 1 : -1));
    for (const old of list.slice(7)) await DB.del('backups', old.id);
    await setKV('lastBackup', today);
  }
  async function listBackups() {
    return (await DB.all('backups')).sort((a, b) => (a.id < b.id ? 1 : -1))
      .map(b => ({ id: b.id, count: b.events.length, createdAt: b.createdAt }));
  }
  async function restoreBackup(id) {
    const b = await DB.get('backups', id);
    if (!b) throw new Error('백업을 찾을 수 없어요.');
    await importData({ app: 'dayflow', events: b.events, settings: b.settings }, 'replace');
  }
  async function exportData() {
    const kv = await DB.all('kv');
    const journal = {};
    kv.filter(x => x.key.startsWith('journal:')).forEach(x => { journal[x.key.slice(8)] = x.value; });
    return { app: 'dayflow', version: 1, exportedAt: new Date().toISOString(), timezone: T.TZ, events: all(), settings: state.settings, journal };
  }
  /** mode: 'merge'(같은 id면 더 최근 수정본 유지) | 'replace'(전체 교체, 직전 상태는 백업) */
  async function importData(data, mode) {
    if (!data || data.app !== 'dayflow' || !Array.isArray(data.events)) throw new Error('DAYFLOW 백업 파일이 아니에요.');
    const incoming = data.events.map(normalize);
    if (mode === 'replace') {
      if (state.events.size) await DB.put('backups', { id: 'before-import-' + Date.now(), createdAt: Date.now(), events: all(), settings: state.settings });
      await DB.replaceAll('events', incoming);
      state.events = new Map(incoming.map(e => [e.id, e]));
    } else {
      const merged = incoming.filter(e => { const cur = state.events.get(e.id); return !cur || cur.updatedAt < e.updatedAt; });
      await DB.putMany('events', merged);
      merged.forEach(e => state.events.set(e.id, e));
    }
    if (data.settings && mode === 'replace') await saveSettings(data.settings);
    if (data.journal) for (const [d, v] of Object.entries(data.journal)) await setKV('journal:' + d, v);
    emit('change', { imported: true });
    broadcast('events');
    return incoming.length;
  }
  async function wipe() {
    await DB.put('backups', { id: 'before-wipe-' + Date.now(), createdAt: Date.now(), events: all(), settings: state.settings });
    await DB.replaceAll('events', []);
    state.events.clear();
    emit('change', { wiped: true });
    broadcast('events');
  }
  function toICS() {
    const esc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const dt = (d, t) => d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
    const rr = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY' };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DAYFLOW//KO', 'CALSCALE:GREGORIAN'];
    all().forEach(e => {
      lines.push('BEGIN:VEVENT', 'UID:' + e.id + '@dayflow', 'SUMMARY:' + esc(e.title));
      if (e.start) {
        lines.push(`DTSTART;TZID=Asia/Seoul:${dt(e.date, e.start)}`);
        lines.push(`DTEND;TZID=Asia/Seoul:${dt(e.date, e.end || T.fromMin(T.toMin(e.start) + 60))}`);
      } else {
        lines.push('DTSTART;VALUE=DATE:' + dt(e.date), 'DTEND;VALUE=DATE:' + dt(T.addDays(e.endDate || e.date, 1)));
      }
      if (e.endDate && e.start) lines.push('RRULE:FREQ=DAILY;UNTIL=' + dt(e.endDate) + 'T235959');
      if (e.repeat.freq !== 'none') lines.push('RRULE:' + rr[e.repeat.freq] + (e.repeat.until ? ';UNTIL=' + dt(e.repeat.until) + 'T235959' : ''));
      if (e.location) lines.push('LOCATION:' + esc(e.location));
      if (e.description) lines.push('DESCRIPTION:' + esc(e.description));
      lines.push('CATEGORIES:' + esc(e.category), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  DF.store = {
    CATEGORIES, CAT_COLOR, PRIORITY, REPEAT, DEFAULT_SETTINGS,
    get settings() { return state.settings; },
    get ready() { return state.ready; },
    init, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getKV, setKV, saveSettings,
    add, update, remove, restore, get, all, normalize, isSeries,
    occurrences, on, setDone, moveOcc, skipOcc,
    conflicts, duplicates, freeSlot, gapsOn, span, search,
    listBackups, restoreBackup, exportData, importData, wipe, toICS
  };
})(window.DF = window.DF || {});

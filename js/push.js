/* DAYFLOW — 앱을 닫아도 오는 알림 (Web Push)
 * 앞으로 30일치 알림(일정 알림, 아침 브리핑, 저녁 마감)을 미리 계산해 푸시 서버에 올려 두면,
 * 서버가 매분 확인해서 시각이 된 알림을 보낸다. 일정이 바뀔 때마다 목록을 다시 올린다.
 * 서버에는 알림 문구(일정 제목·시간·장소)만 올라가고, 나머지 일정 데이터는 기기에만 있다.
 * 따로 켜는 버튼 없이, 알림 권한만 허용되어 있으면 항상 동작한다. */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store;

  const SERVER = 'https://dayflow-push.darok.workers.dev';
  const VAPID_PUBLIC = 'BLLCxyqNBVOyKb5q1orQaRDYtnhGjzyRWbitKH-tVLAH-lbKt0FlektLmMd0hjNJPzgnyQ4hTCA9X6YwqAcwgMQ';
  const DAYS = 30;

  let cfg = null;        // { id, token, lastSync, lastCount, lastError }
  let timer = null;
  let asking = null;     // 권한 요청이 겹치지 않게

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function rand() {
    const a = crypto.getRandomValues(new Uint8Array(24));
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function keyBytes(s) {
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), c => c.charCodeAt(0));
  }
  async function load() {
    if (!cfg) cfg = await S.getKV('push', null);
    if (!cfg) { cfg = { id: rand(), token: rand() }; await S.setKV('push', cfg); }
    return cfg;
  }
  async function save(patch) { Object.assign(cfg, patch); await S.setKV('push', cfg); }

  async function registration() {
    return navigator.serviceWorker.getRegistration() || navigator.serviceWorker.register('sw.js');
  }
  async function post(path, body) {
    const res = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    return data;
  }

  /** 앞으로 30일치 알림 목록 */
  async function buildItems() {
    const n = T.now(), nowTs = Date.now();
    const to = T.addDays(n.date, DAYS - 1);
    const items = [];
    // 일정 알림
    S.occurrences(n.date, to).forEach(o => {
      if (!o.start || o.done || !o.reminders.length) return;
      const startTs = T.epoch(o.occDate, o.start);
      o.reminders.forEach(min => {
        const at = startTs - min * 6e4;
        if (at <= nowTs) return;
        const m = DF.notify.message(o, min);
        items.push({ at, tag: `${o.key}#${min}#${o.start}`, important: m.important, url: '#/today', title: m.title, body: m.body });
      });
    });
    // 아침 브리핑·저녁 마감
    const st = S.settings;
    if (st.autoBriefing) {
      for (const d of T.range(n.date, to)) {
        const mAt = T.epoch(d, st.morningTime);
        if (mAt > nowTs) {
          const occs = S.on(d);
          let body;
          if (!occs.length) body = '오늘은 등록된 일정이 없어요. 여유로운 하루예요.';
          else {
            const list = occs.slice(0, 4).map(o => `${o.start || '미정'} ${o.title}`).join(' · ');
            const imp = DF.brief.importantOf(occs)[0];
            body = `오늘 일정 ${occs.length}개: ${list}${occs.length > 4 ? ' …' : ''}${imp ? `\n가장 중요한 일정: ${imp.title}` : ''}`;
          }
          items.push({ at: mAt, tag: 'morning:' + d, title: '오늘의 브리핑', body, url: '#/today' });
        }
        const eAt = T.epoch(d, st.eveningTime);
        if (eAt > nowTs && !(d === n.date && await S.getKV('eveningDone:' + d, false))) {
          const tmr = S.on(T.addDays(d, 1));
          items.push({
            at: eAt, tag: 'evening:' + d, title: '하루 마감 시간이에요', url: '#/assistant?evening=1',
            body: `오늘을 정리하고 새 일정을 확인해 볼까요?${tmr.length ? ` 내일 일정 ${tmr.length}개, 첫 일정은 ${tmr[0].start || '시간 미정'} ${tmr[0].title}.` : ' 내일은 아직 일정이 없어요.'}`
          });
        }
      }
    }
    // 알람: 울리는 시각부터 1분 간격으로 5번
    if (DF.alarm) items.push(...DF.alarm.pushItems(DAYS));
    return items.sort((a, b) => a.at - b.at);
  }

  /** 날짜별 일정 요약 (서버가 아침 브리핑을 쓸 때 쓴다) */
  function dayEvents(date) {
    return S.on(date).map(o => ({ title: o.title, start: o.start, end: o.end, location: o.location, priority: o.priority }));
  }
  function place() {
    const city = DF.weather.CITIES[S.settings.city] ? S.settings.city : '서울';
    const [lat, lon] = DF.weather.CITIES[city];
    return { lat, lon, city };
  }
  function days() {
    const out = {}, n = T.now();
    T.range(n.date, T.addDays(n.date, DAYS - 1)).forEach(d => { out[d] = dayEvents(d); });
    return out;
  }

  async function syncNow() {
    await load();
    if (!supported() || Notification.permission !== 'granted') return null;
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
    const items = await buildItems();
    const r = await post('/sync', { id: cfg.id, token: cfg.token, subscription: sub.toJSON(), items, days: days(), loc: place(), name: S.settings.name });
    await save({ lastSync: Date.now(), lastCount: r.count, lastError: null });
    return r;
  }
  /** 일정이 바뀔 때마다 부르면 2초 뒤 한 번만 올린다 */
  function sync() {
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().catch(async e => { console.warn('푸시 동기화 실패', e); if (cfg) await save({ lastError: e.message }); }), 2000);
  }

  /** 알림 권한을 묻고(사용자 탭 안에서 불러야 한다) 바로 서버에 등록한다 */
  async function enable() {
    if (!supported()) throw new Error(isIOS() && !standalone() ? 'iPhone에서는 Safari 공유 버튼 → "홈 화면에 추가"로 설치한 DAYFLOW에서만 알림을 받을 수 있어요.' : '이 브라우저는 백그라운드 알림을 지원하지 않아요.');
    const perm = Notification.permission === 'default' ? await (asking = asking || Notification.requestPermission()) : Notification.permission;
    if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았어요. 설정 앱에서 DAYFLOW 알림을 허용해 주세요.');
    return syncNow();
  }
  async function test() {
    await load();
    await syncNow();
    return post('/test', { id: cfg.id, token: cfg.token });
  }
  /** AI 서버 호출 (이 기기의 id·token을 붙인다) */
  async function call(path, body) {
    await load();
    const res = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: cfg.id, token: cfg.token }, body)) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || data.error || 'HTTP ' + res.status); e.code = data.error; throw e; }
    return data;
  }
  /** 그날 아침 브리핑 (Claude가 쓴 글). 실패하면 null */
  async function brief(date) {
    try {
      const r = await call('/brief', { date, events: dayEvents(date), loc: place(), name: S.settings.name });
      return r.brief || null;
    } catch (e) { return null; }
  }

  async function status() {
    await load();
    return { supported: supported(), ios: isIOS(), standalone: standalone(), permission: 'Notification' in window ? Notification.permission : 'unsupported', lastSync: cfg.lastSync, lastCount: cfg.lastCount, lastError: cfg.lastError };
  }

  async function init() {
    await load();
    S.onChange(() => { if (DF.push.active) sync(); });
    if (DF.push.active) sync();
    // 아직 권한을 묻지 않았다면 첫 탭에서 한 번 묻는다 (iPhone은 탭 안에서만 물을 수 있다)
    if (supported() && Notification.permission === 'default') {
      const ask = () => {
        document.removeEventListener('click', ask, true);
        enable().then(() => DF.ui && DF.ui.toast('알림을 켰어요. 앱을 닫아도 정해진 시각에 알려 드릴게요.')).catch(() => {});
      };
      document.addEventListener('click', ask, true);
    }
    // 하루가 지나면 30일 창을 앞으로 당긴다
    setInterval(() => { if (DF.push.active && Date.now() - (cfg.lastSync || 0) > 6 * 36e5) sync(); }, 10 * 6e4);
  }

  DF.push = { init, enable, test, status, sync, buildItems, call, brief, get active() { return !!(cfg && supported() && Notification.permission === 'granted'); } };
})(window.DF = window.DF || {});

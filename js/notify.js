/* DAYFLOW — 알림과 자동 실행 스케줄러
 * 앱이 열려 있는 동안 20초마다 확인한다.
 *  - 일정 알림: 알림 시각이 지났고 아직 보내지 않은 것만 (키 단위로 기록해 중복 방지)
 *  - 아침/저녁 브리핑: 설정 시각이 지났고 오늘 아직 보여 주지 않았다면 한 번 실행
 * 앱을 늦게 열어도 놓친 브리핑을 한 번 보여 준다. */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store;

  const supported = 'Notification' in window && window.isSecureContext;
  let reg = null, handlers = {}, timer = null, ticking = false;
  const inbox = []; // 앱 안 알림 기록

  /** 일정 알림 문구 (앱 안 알림과 푸시 서버가 같이 쓴다) */
  function message(o, min) {
    if (o.alarm) return { title: `⏰ ${o.title}`, body: `${T.timeK(o.start)} 알람이에요.${o.location ? ' · ' + o.location : ''}`, important: true };
    const lead = min === 0 ? '지금 시작해요' : `${T.durK(min)} 뒤 시작`;
    return {
      title: `${o.priority === 'high' ? '[중요] ' : ''}${o.title}`,
      body: `${T.timeK(o.start)} · ${lead}${o.location ? ' · ' + o.location : ''}`,
      important: o.priority === 'high'
    };
  }

  // 앱이 열려 있을 때 알람 소리 (짧은 삐삐삐 세 번)
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.35, 0.7].forEach(t => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.3);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch (e) { /* 소리를 못 내도 알림은 그대로 */ }
  }

  function permission() { return supported ? Notification.permission : 'unsupported'; }
  async function request() {
    if (!supported) return 'unsupported';
    try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
  }

  /** 시스템 알림을 보내고, 안 되면 앱 안 알림으로 대신한다. 둘 다 tag로 중복을 막는다. */
  async function show(title, body, opts = {}) {
    const tag = opts.tag || title;
    if (!inbox.some(x => x.tag === tag)) inbox.unshift({ title, body, tag, at: Date.now(), important: !!opts.important });
    inbox.splice(30);
    if (opts.alarm && document.visibilityState === 'visible') beep();
    let system = false;
    // 푸시 서버가 같은 알림을 보내므로, 예약 알림은 앱 안에서만 보여 준다 (중복 방지)
    const viaPush = opts.scheduled && DF.push && DF.push.active;
    if (viaPush) { if (document.visibilityState === 'visible') DF.ui && DF.ui.toast(`<b>${DF.ui.esc(title)}</b><br>${DF.ui.esc(body)}`, { important: opts.important }); if (handlers.inbox) handlers.inbox(inbox); return; }
    if (supported && Notification.permission === 'granted') {
      try {
        const o = { body, tag, icon: 'icon.svg', badge: 'icon.svg', requireInteraction: !!opts.important, data: { url: opts.url || '#/today' } };
        if (reg && reg.showNotification) await reg.showNotification(title, o);
        else new Notification(title, o);
        system = true;
      } catch (e) { system = false; }
    }
    if (!system || document.visibilityState === 'visible') DF.ui && DF.ui.toast(`<b>${DF.ui.esc(title)}</b><br>${DF.ui.esc(body)}`, { important: opts.important, duration: opts.important ? 12000 : 7000 });
    if (handlers.inbox) handlers.inbox(inbox);
  }

  async function sentMap() {
    const m = await S.getKV('notified', {});
    const cutoff = Date.now() - 3 * 864e5;
    for (const k of Object.keys(m)) if (m[k] < cutoff) delete m[k];
    return m;
  }

  async function tick() {
    if (ticking || !S.ready) return;
    ticking = true;
    try {
      const n = T.now(), nowTs = Date.now();
      const sent = await sentMap();
      let changed = false;

      // 1) 일정 알림 — 오늘·내일 일정 중 알림 시각이 지난 것 (일정 시작 후엔 보내지 않음)
      const occs = S.occurrences(n.date, T.addDays(n.date, 1)).filter(o => o.start && !o.done && o.reminders.length);
      for (const o of occs) {
        const startTs = T.epoch(o.occDate, o.start);
        for (const min of o.reminders) {
          const key = `${o.key}#${min}#${o.start}`;
          const fireTs = startTs - min * 6e4;
          if (sent[key] || nowTs < fireTs || nowTs > startTs + 5 * 6e4) continue;
          sent[key] = nowTs; changed = true;
          const m = message(o, min);
          await show(m.title, m.body, { tag: key, important: m.important, alarm: o.alarm, scheduled: true });
        }
      }

      // 2) 아침 브리핑
      const st = S.settings;
      if (st.autoBriefing) {
        const mKey = 'morning:' + n.date, eKey = 'evening:' + n.date;
        const eveMin = T.toMin(st.eveningTime);
        if (!sent[mKey] && n.minutes >= T.toMin(st.morningTime) && n.minutes < eveMin) {
          sent[mKey] = nowTs; changed = true;
          const w = await DF.weather.get().catch(() => null);
          const b = DF.brief.morning(n.date, w);
          await show('오늘의 브리핑', b.empty ? b.summary : `${b.summary} ${b.important && b.important[0] ? '가장 중요한 일정: ' + b.important[0].o.title : ''}`, { tag: mKey, scheduled: true });
          if (handlers.morning) handlers.morning(b);
        }
        // 3) 저녁 마감
        if (!sent[eKey] && n.minutes >= eveMin) {
          sent[eKey] = nowTs; changed = true;
          const done = await S.getKV('eveningDone:' + n.date, false);
          if (!done) {
            await show('하루 마감 시간이에요', '오늘 하루를 정리하고 새 일정을 확인해 볼까요?', { tag: eKey, url: '#/assistant?evening=1', scheduled: true });
            if (handlers.evening) handlers.evening();
          }
        }
      }
      if (changed) await S.setKV('notified', sent);
    } catch (e) {
      console.error('스케줄러 오류', e);
    } finally {
      ticking = false;
    }
  }

  async function start(h) {
    handlers = h || {};
    if ('serviceWorker' in navigator && window.isSecureContext) {
      try {
        reg = await navigator.serviceWorker.register('sw.js');
        navigator.serviceWorker.addEventListener('message', e => {
          if (e.data && e.data.type === 'navigate' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#');
        });
      } catch (e) { console.warn('서비스 워커 등록 실패', e); }
    }
    clearInterval(timer);
    timer = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    setTimeout(tick, 1500);
  }

  DF.notify = { supported, permission, request, show, start, tick, inbox, message };
})(window.DF = window.DF || {});

/* DAYFLOW 푸시 서버 (Cloudflare Worker)
 * 앱이 닫혀 있어도 정해진 시각에 알림을 보낸다.
 *  - POST /sync         앱이 앞으로 30일치 알림 목록과 푸시 구독 정보를 올린다
 *  - POST /test         바로 테스트 알림을 보낸다
 *  - POST /unsubscribe  구독을 지운다
 *  - POST /ai           비서 대화 (Claude)
 *  - POST /brief        그날 아침 브리핑 글 (Claude)
 *  - 매분 cron           시각이 된 알림을 Web Push로 보낸다 (RFC 8291 암호화 + VAPID).
 *                       아침 브리핑 알림은 보내기 직전에 Claude가 그날 일정과 날씨로 글을 쓴다.
 * KV(PUSH)에는 기기마다 'dev:<id>' 한 줄, 기기 목록 'ids' 한 줄을 둔다. */
import * as AI from './ai.js';

const enc = new TextEncoder();
const MAX_ITEMS = 2000;
const EARLY_MS = 30 * 1000; // cron이 분 경계 직전에 돌아도 그 분의 알림은 보낸다

const b64u = {
  enc(buf) {
    let s = '';
    new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
  }
};
function concat(...parts) {
  const arrs = parts.map(p => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  arrs.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** RFC 8291 aes128gcm 암호화 */
async function encrypt(payload, p256dh, auth) {
  const uaPub = b64u.dec(p256dh), secret = b64u.dec(auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(secret, shared);
  const ikm = (await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, [1]))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), [2])));
  const head = new Uint8Array(21 + asPub.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  head.set(asPub, 21);
  return concat(head, ct);
}

let signKey = null;
async function vapid(endpoint, env) {
  if (!signKey) {
    // 공개키(65바이트 raw)에서 x, y를 꺼내고 비밀값 d와 합쳐 서명 키를 만든다
    const pub = b64u.dec(env.VAPID_PUBLIC);
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: env.VAPID_PRIVATE };
    signKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const h = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(h + '.' + c));
  return `vapid t=${h}.${c}.${b64u.enc(sig)}, k=${env.VAPID_PUBLIC}`;
}

/** 알림 한 건 보내기. 반환: HTTP 상태 코드 */
async function sendPush(sub, msg, env) {
  const body = await encrypt(JSON.stringify(msg), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapid(sub.endpoint, env),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: msg.important ? 'high' : 'normal'
    },
    body
  });
  if (res.status >= 400) console.warn('push 실패', res.status, await res.text().catch(() => ''));
  return res.status;
}

// ───────── 저장 ─────────
async function getIds(env) { return (await env.PUSH.get('ids', 'json')) || []; }
async function getDev(env, id) { return env.PUSH.get('dev:' + id, 'json'); }
async function removeDev(env, id) {
  await env.PUSH.delete('dev:' + id);
  const ids = (await getIds(env)).filter(x => x !== id);
  await env.PUSH.put('ids', JSON.stringify(ids));
}

function cleanItems(items, now) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(it => it && Number.isFinite(it.at) && it.at > now - 60e3 && it.at < now + 40 * 864e5)
    .slice(0, MAX_ITEMS)
    .map(it => ({
      at: Math.round(it.at),
      title: String(it.title || 'DAYFLOW').slice(0, 120),
      body: String(it.body || '').slice(0, 400),
      tag: String(it.tag || '').slice(0, 200),
      url: String(it.url || '#/today').slice(0, 200),
      important: !!it.important
    }))
    .sort((a, b) => a.at - b.at);
}

// ───────── HTTP ─────────
function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) });
const validId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);

// ───────── 날씨 (Open-Meteo, 키 불필요) ─────────
function wmo(code) {
  if (code === 0) return '맑음';
  if (code <= 2) return '구름 조금';
  if (code === 3) return '흐림';
  if (code === 45 || code === 48) return '안개';
  if (code >= 51 && code <= 67) return '비';
  if (code >= 71 && code <= 77) return '눈';
  if (code >= 80 && code <= 82) return '소나기';
  if (code >= 85 && code <= 86) return '눈';
  if (code >= 95) return '뇌우';
  return '';
}
async function weatherLine(loc, date) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&start_date=${date}&end_date=${date}`);
    const d = (await r.json()).daily;
    return `${loc.city || ''} ${wmo(d.weather_code[0])}, 최고 ${Math.round(d.temperature_2m_max[0])}° 최저 ${Math.round(d.temperature_2m_min[0])}°, 강수 확률 ${d.precipitation_probability_max[0]}%`.trim();
  } catch (e) { return null; }
}

// ───────── AI 사용 제한 ─────────
// 처음 쓴 기기 3대까지만 쓸 수 있고, 하루 사용량에 상한을 둔다 (API 요금 보호).
const AI_MAX_DEVICES = 3, AI_DAILY_PER_DEVICE = 150, AI_DAILY_TOTAL = 300;
const seoulDate = ts => new Date(ts + 9 * 36e5).toISOString().slice(0, 10);
async function aiGate(env, id, token) {
  if (!env.ANTHROPIC_API_KEY) return 'no_key';
  const list = (await env.PUSH.get('ai_devices', 'json')) || [];
  const mine = list.find(d => d.id === id);
  if (mine && mine.token !== token) return 'forbidden';
  if (!mine) {
    if (list.length >= AI_MAX_DEVICES) return 'device_limit';
    list.push({ id, token, at: Date.now() });
    await env.PUSH.put('ai_devices', JSON.stringify(list));
  }
  const key = 'ai_count:' + seoulDate(Date.now());
  const c = (await env.PUSH.get(key, 'json')) || { total: 0 };
  if ((c[id] || 0) >= AI_DAILY_PER_DEVICE || c.total >= AI_DAILY_TOTAL) return 'daily_limit';
  c[id] = (c[id] || 0) + 1;
  c.total++;
  await env.PUSH.put(key, JSON.stringify(c), { expirationTtl: 3 * 86400 });
  return null;
}
const GATE_MSG = {
  no_key: 'AI 키가 아직 설정되지 않았어요.', forbidden: '이 기기는 AI를 쓸 수 없어요.',
  device_limit: 'AI는 기기 3대까지만 쓸 수 있어요.', daily_limit: '오늘 AI 사용량을 다 썼어요. 내일 다시 써 주세요.'
};

function cleanDays(days) {
  const out = {};
  if (!days || typeof days !== 'object') return out;
  Object.keys(days).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 40).forEach(d => {
    out[d] = (Array.isArray(days[d]) ? days[d] : []).slice(0, 30).map(e => ({
      title: String(e.title || '').slice(0, 120), start: e.start || null, end: e.end || null,
      location: String(e.location || '').slice(0, 80), priority: e.priority === 'high' ? 'high' : 'normal'
    }));
  });
  return out;
}
function cleanLoc(loc) {
  return loc && Number.isFinite(+loc.lat) && Number.isFinite(+loc.lon) ? { lat: +loc.lat, lon: +loc.lon, city: String(loc.city || '').slice(0, 20) } : null;
}

/** 그날 아침 브리핑 (한 번 만든 글은 3일 동안 저장해 두고 다시 쓴다) */
async function getBrief(env, id, src, date) {
  const key = `brief:${id}:${date}`;
  const saved = await env.PUSH.get(key, 'json');
  if (saved) return saved;
  if (!env.ANTHROPIC_API_KEY || !src || !src.days || !src.days[date]) return null;
  const dow = '일월화수목금토'[new Date(date + 'T00:00:00Z').getUTCDay()];
  const brief = await AI.morningBrief(env, { date, dow, events: src.days[date], weather: await weatherLine(src.loc, date), name: src.name });
  if (brief) await env.PUSH.put(key, JSON.stringify(brief), { expirationTtl: 3 * 86400 });
  return brief;
}

async function handle(req, env) {
  const h = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ ok: true, service: 'dayflow-push', ai: !!env.ANTHROPIC_API_KEY }, 200, h);
  const path = new URL(req.url).pathname;
  let data;
  try { data = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400, h); }
  if (!validId(data.id) || !validId(data.token)) return json({ error: 'bad id' }, 400, h);
  const dev = await getDev(env, data.id);
  if (dev && dev.token !== data.token) return json({ error: 'forbidden' }, 403, h);
  const now = Date.now();

  if (path === '/sync') {
    const sub = data.subscription;
    const okEndpoint = sub && typeof sub.endpoint === 'string' &&
      (/^https:\/\//.test(sub.endpoint) || (env.DEV_ALLOW_LOCAL === '1' && /^http:\/\/(localhost|127\.0\.0\.1):/.test(sub.endpoint))); // 로컬 테스트용
    if (!okEndpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json({ error: 'bad subscription' }, 400, h);
    }
    const rec = {
      token: data.token,
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      items: cleanItems(data.items, now),
      days: cleanDays(data.days),
      loc: cleanLoc(data.loc),
      name: String(data.name || '').slice(0, 20),
      cursor: dev ? dev.cursor || now : now,
      sent: dev && Array.isArray(dev.sent) ? dev.sent.filter(k => k.at > now - 120e3) : [],
      updatedAt: now
    };
    await env.PUSH.put('dev:' + data.id, JSON.stringify(rec));
    const ids = await getIds(env);
    if (!ids.includes(data.id)) { ids.push(data.id); await env.PUSH.put('ids', JSON.stringify(ids)); }
    return json({ ok: true, count: rec.items.length, next: rec.items.find(i => i.at > now) || null }, 200, h);
  }
  if (path === '/test') {
    if (!dev) return json({ error: 'not subscribed' }, 404, h);
    const status = await sendPush(dev.subscription, { title: 'DAYFLOW 테스트 알림', body: '앱을 닫아도 이렇게 알림이 와요.', tag: 'test-' + now, url: '#/settings' }, env);
    if (status === 404 || status === 410) await removeDev(env, data.id);
    return json({ ok: status < 300, status }, 200, h);
  }
  if (path === '/unsubscribe') {
    if (dev) await removeDev(env, data.id);
    return json({ ok: true }, 200, h);
  }
  if (path === '/ai') {
    const gate = await aiGate(env, data.id, data.token);
    if (gate) return json({ error: gate, message: GATE_MSG[gate] }, gate === 'no_key' ? 503 : 429, h);
    try {
      const r = await AI.chat(env, { history: data.history, context: data.context, message: data.message });
      return json({ ok: true, text: r.text, actions: r.actions }, 200, h);
    } catch (e) {
      console.error('AI 실패', e);
      return json({ error: 'ai_failed', message: 'AI가 응답하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, 502, h);
    }
  }
  if (path === '/brief') {
    const date = String(data.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'bad date' }, 400, h);
    const saved = await env.PUSH.get(`brief:${data.id}:${date}`, 'json');
    if (saved) return json({ ok: true, brief: saved }, 200, h);
    const gate = await aiGate(env, data.id, data.token);
    if (gate) return json({ error: gate, message: GATE_MSG[gate] }, gate === 'no_key' ? 503 : 429, h);
    // 앱이 그날 일정을 직접 보낸다 (알림을 허용하지 않은 기기도 쓸 수 있게)
    const src = { days: cleanDays({ [date]: data.events || [] }), loc: cleanLoc(data.loc), name: String(data.name || '').slice(0, 20) };
    try {
      const brief = await getBrief(env, data.id, src, date);
      return json({ ok: !!brief, brief }, 200, h);
    } catch (e) {
      console.error('브리핑 실패', e);
      return json({ error: 'ai_failed', message: 'AI 브리핑을 만들지 못했어요.' }, 502, h);
    }
  }
  return json({ error: 'not found' }, 404, h);
}

// ───────── 매분 실행 ─────────
async function tick(env) {
  const now = Date.now();
  for (const id of await getIds(env)) {
    const dev = await getDev(env, id);
    if (!dev) continue;
    // 보낸 알림을 'sent'에 남겨, 동기화가 cron과 엇갈려도 두 번 보내거나 빠뜨리지 않는다
    const sent = new Set((dev.sent || []).map(k => k.key));
    const keyOf = it => it.tag + '@' + it.at;
    const due = dev.items.filter(it => it.at > (dev.cursor || 0) - 120e3 && it.at <= now + EARLY_MS && !sent.has(keyOf(it)));
    if (!due.length) continue;
    let gone = false;
    for (const it of due) {
      let msg = it;
      if (it.tag.startsWith('morning:')) {
        const date = it.tag.slice(8);
        try {
          const b = await getBrief(env, id, dev, date);
          if (b && b.summary) msg = Object.assign({}, it, { body: b.summary, url: '#/today?brief=' + date });
        } catch (e) { console.warn('AI 브리핑 실패, 기본 문구로 보냄', e); }
      }
      const status = await sendPush(dev.subscription, msg, env);
      if (status === 404 || status === 410) { gone = true; break; }
      sent.add(keyOf(it));
    }
    if (gone) { await removeDev(env, id); continue; }
    // 그사이 동기화로 기록이 바뀌었을 수 있으니 다시 읽고 합친다
    const latest = (await getDev(env, id)) || dev;
    latest.cursor = now;
    latest.sent = [...sent].map(key => ({ key, at: +key.split('@').pop() })).filter(k => k.at > now - 120e3);
    latest.items = latest.items.filter(it => it.at > now - 120e3);
    await env.PUSH.put('dev:' + id, JSON.stringify(latest));
  }
}

export default {
  fetch: (req, env) => handle(req, env).catch(e => json({ error: String(e && e.message || e) }, 500, cors(req, env))),
  scheduled: (event, env, ctx) => ctx.waitUntil(tick(env))
};

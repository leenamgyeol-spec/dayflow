/* DAYFLOW 푸시 서버 (Cloudflare Worker)
 * 앱이 닫혀 있어도 정해진 시각에 알림을 보낸다.
 *  - POST /sync         앱이 앞으로 30일치 알림 목록과 푸시 구독 정보를 올린다
 *  - POST /test         바로 테스트 알림을 보낸다
 *  - POST /unsubscribe  구독을 지운다
 *  - 매분 cron           시각이 된 알림을 Web Push로 보낸다 (RFC 8291 암호화 + VAPID)
 * KV(PUSH)에는 기기마다 'dev:<id>' 한 줄, 기기 목록 'ids' 한 줄만 둔다. */

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

async function handle(req, env) {
  const h = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return json({ ok: true, service: 'dayflow-push'}, 200, h);
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
      cursor: dev ? Math.max(dev.cursor || 0, now - EARLY_MS) : now,
      updatedAt: now
    };
    await env.PUSH.put('dev:' + data.id, JSON.stringify(rec));
    const ids = await getIds(env);
    if (!ids.includes(data.id)) { ids.push(data.id); await env.PUSH.put('ids', JSON.stringify(ids)); }
    return json({ ok: true, count: rec.items.length, next: rec.items.find(i => i.at > rec.cursor) || null }, 200, h);
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
  return json({ error: 'not found' }, 404, h);
}

// ───────── 매분 실행 ─────────
async function tick(env) {
  const now = Date.now();
  for (const id of await getIds(env)) {
    const dev = await getDev(env, id);
    if (!dev) continue;
    const due = dev.items.filter(it => it.at > dev.cursor && it.at <= now + EARLY_MS);
    if (!due.length) continue;
    let gone = false;
    for (const it of due) {
      const status = await sendPush(dev.subscription, it, env);
      if (status === 404 || status === 410) { gone = true; break; }
    }
    if (gone) { await removeDev(env, id); continue; }
    dev.cursor = now + EARLY_MS;
    dev.items = dev.items.filter(it => it.at > dev.cursor);
    await env.PUSH.put('dev:' + id, JSON.stringify(dev));
  }
}

export default {
  fetch: (req, env) => handle(req, env).catch(e => json({ error: String(e && e.message || e) }, 500, cors(req, env))),
  scheduled: (event, env, ctx) => ctx.waitUntil(tick(env))
};

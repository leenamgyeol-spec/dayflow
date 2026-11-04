/* DAYFLOW — 영구 저장소 (IndexedDB)
 * 저장소: events(일정), kv(설정·기록), backups(하루 1회 자동 스냅샷)
 * IndexedDB를 쓸 수 없는 환경에서는 localStorage로 대체한다. */
(function (DF) {
  'use strict';

  const NAME = 'dayflow', VERSION = 1;
  const KEY = { events: 'id', kv: 'key', backups: 'id' };
  let db = null, fallback = false;

  function open() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) { fallback = true; return resolve(); }
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { fallback = true; return resolve(); }
      req.onupgradeneeded = () => {
        const d = req.result;
        Object.keys(KEY).forEach(name => {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: KEY[name] });
        });
      };
      req.onsuccess = () => {
        db = req.result;
        db.onversionchange = () => db.close();
        resolve();
      };
      req.onerror = () => { console.warn('IndexedDB 열기 실패, localStorage로 대체합니다.', req.error); fallback = true; resolve(); };
    });
  }

  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    });
  }

  // localStorage 대체 경로
  const lsKey = store => 'dayflow:db:' + store;
  function lsRead(store) { try { return JSON.parse(localStorage.getItem(lsKey(store)) || '{}'); } catch (e) { return {}; } }
  function lsWrite(store, obj) { localStorage.setItem(lsKey(store), JSON.stringify(obj)); }

  const api = {
    open,
    get usingFallback() { return fallback; },

    all(store) {
      if (fallback) return Promise.resolve(Object.values(lsRead(store)));
      return tx(store, 'readonly', s => s.getAll());
    },
    get(store, key) {
      if (fallback) return Promise.resolve(lsRead(store)[key]);
      return tx(store, 'readonly', s => s.get(key));
    },
    put(store, value) {
      if (fallback) { const o = lsRead(store); o[value[KEY[store]]] = value; lsWrite(store, o); return Promise.resolve(); }
      return tx(store, 'readwrite', s => { s.put(value); });
    },
    putMany(store, values) {
      if (fallback) { const o = lsRead(store); values.forEach(v => { o[v[KEY[store]]] = v; }); lsWrite(store, o); return Promise.resolve(); }
      return tx(store, 'readwrite', s => { values.forEach(v => s.put(v)); });
    },
    del(store, key) {
      if (fallback) { const o = lsRead(store); delete o[key]; lsWrite(store, o); return Promise.resolve(); }
      return tx(store, 'readwrite', s => { s.delete(key); });
    },
    /** 저장소 전체 교체 — 하나의 트랜잭션이라 중간에 실패하면 기존 데이터가 그대로 남는다. */
    replaceAll(store, values) {
      if (fallback) { const o = {}; values.forEach(v => { o[v[KEY[store]]] = v; }); lsWrite(store, o); return Promise.resolve(); }
      return tx(store, 'readwrite', s => { s.clear(); values.forEach(v => s.put(v)); });
    }
  };

  DF.db = api;
})(window.DF = window.DF || {});

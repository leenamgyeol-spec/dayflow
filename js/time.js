/* DAYFLOW — 날짜·시간 유틸리티
 * 모든 날짜는 'YYYY-MM-DD', 시간은 'HH:MM' 문자열로 다룬다.
 * 기기 시간대와 상관없이 항상 한국 시간(Asia/Seoul, UTC+9, 서머타임 없음) 기준으로 계산한다. */
(function (DF) {
  'use strict';

  const TZ = 'Asia/Seoul';
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const DOW_LONG = DOW.map(d => d + '요일');
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  const pad = n => String(n).padStart(2, '0');

  function now() {
    const p = {};
    fmt.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    const h = Number(p.hour) % 24, m = Number(p.minute);
    const date = `${p.year}-${p.month}-${p.day}`;
    return { date, h, m, s: Number(p.second), minutes: h * 60 + m, time: `${pad(h)}:${pad(m)}`, dow: dow(date) };
  }

  function ymd(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
  function utc(s) { const { y, m, d } = ymd(s); return Date.UTC(y, m - 1, d); }
  function fromUTC(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  function make(y, m, d) { return fromUTC(Date.UTC(y, m - 1, d)); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addDays(s, n) { return fromUTC(utc(s) + n * 864e5); }
  function addMonths(s, n) {
    const { y, m, d } = ymd(s);
    const first = make(y, m + n, 1), f = ymd(first);
    return make(f.y, f.m, Math.min(d, daysInMonth(f.y, f.m)));
  }
  function dow(s) { return new Date(utc(s)).getUTCDay(); }
  function diff(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
  function weekStart(s) { return addDays(s, -((dow(s) + 6) % 7)); } // 월요일 시작 ("이번 주/다음 주" 해석용)
  function weekStartSun(s) { return addDays(s, -dow(s)); } // 일요일 시작 (화면 표시용)
  function monthStart(s) { const { y, m } = ymd(s); return make(y, m, 1); }
  function monthEnd(s) { const { y, m } = ymd(s); return make(y, m, daysInMonth(y, m)); }
  function range(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }

  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const { y, m, d } = ymd(s);
    return make(y, m, d) === s;
  }
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
  function fromMin(n) { n = Math.max(0, Math.min(23 * 60 + 59, Math.round(n))); return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; }
  /** 한국 시간 기준 날짜+시간 → 실제 epoch(ms) */
  function epoch(date, time) { return utc(date) + toMin(time || '00:00') * 6e4 - 9 * 36e5; }

  function fmtDate(s, withDow = true) {
    const { m, d } = ymd(s);
    return `${m}월 ${d}일` + (withDow ? ` (${DOW[dow(s)]})` : '');
  }
  function fmtDateLong(s) {
    const { y, m, d } = ymd(s);
    return `${y}년 ${m}월 ${d}일 ${DOW_LONG[dow(s)]}`;
  }
  /** '17:30' → '오후 5시 30분' */
  function timeK(t) {
    if (!t) return '시간 미정';
    const [h, m] = t.split(':').map(Number);
    if (h === 12 && m === 0) return '정오';
    if (h === 0 && m === 0) return '자정';
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
  }
  function durK(min) {
    min = Math.round(min);
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return `${m}분`;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  function rel(s, today) {
    const n = diff(today || now().date, s);
    return { '-2': '그제', '-1': '어제', 0: '오늘', 1: '내일', 2: '모레' }[n] || null;
  }
  function relLabel(s, today) {
    const r = rel(s, today);
    return r ? `${r} · ${fmtDate(s)}` : fmtDate(s);
  }

  DF.time = {
    TZ, DOW, DOW_LONG, pad, now, ymd, utc, make, daysInMonth, addDays, addMonths, dow, diff,
    weekStart, weekStartSun, monthStart, monthEnd, range, isDate, isTime, toMin, fromMin, epoch,
    fmtDate, fmtDateLong, timeK, durK, rel, relLabel
  };
})(window.DF = window.DF || {});

/* DAYFLOW — 날씨 (Open-Meteo, API 키 불필요)
 * 30분 동안 캐시하고, 실패하면 마지막으로 받은 값을 보여 준다. */
(function (DF) {
  'use strict';

  const CITIES = {
    '서울': [37.5665, 126.978], '부산': [35.1796, 129.0756], '인천': [37.4563, 126.7052], '대구': [35.8714, 128.6014],
    '대전': [36.3504, 127.3845], '광주': [35.1595, 126.8526], '울산': [35.5384, 129.3114], '세종': [36.48, 127.289],
    '수원': [37.2636, 127.0286], '성남': [37.4201, 127.1262], '고양': [37.6584, 126.832], '용인': [37.2411, 127.1776],
    '춘천': [37.8813, 127.7298], '청주': [36.6424, 127.489], '전주': [35.8242, 127.148], '창원': [35.2279, 128.6811],
    '포항': [36.019, 129.3435], '제주': [33.4996, 126.5312]
  };
  // WMO 날씨 코드 → [설명, 아이콘]
  function describe(code) {
    if (code === 0) return ['맑음', 'sun'];
    if (code <= 2) return ['구름 조금', 'cloudSun'];
    if (code === 3) return ['흐림', 'cloud'];
    if (code === 45 || code === 48) return ['안개', 'cloud'];
    if (code >= 51 && code <= 57) return ['이슬비', 'rain'];
    if (code >= 61 && code <= 67) return ['비', 'rain'];
    if (code >= 71 && code <= 77) return ['눈', 'snow'];
    if (code >= 80 && code <= 82) return ['소나기', 'rain'];
    if (code >= 85 && code <= 86) return ['눈', 'snow'];
    if (code >= 95) return ['뇌우', 'storm'];
    return ['알 수 없음', 'cloud'];
  }

  let memo = null;
  async function get(force) {
    const city = CITIES[DF.store.settings.city] ? DF.store.settings.city : '서울';
    if (!force && memo && memo.city === city && Date.now() - memo.at < 30 * 6e4) return memo;
    const cached = await DF.store.getKV('weather', null);
    if (!force && cached && cached.city === city && Date.now() - cached.at < 30 * 6e4) return (memo = cached);
    const [lat, lon] = CITIES[city];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,precipitation' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=Asia%2FSeoul&forecast_days=3';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const days = j.daily.time.map((d, i) => ({
        date: d, code: j.daily.weather_code[i], max: Math.round(j.daily.temperature_2m_max[i]),
        min: Math.round(j.daily.temperature_2m_min[i]), rain: j.daily.precipitation_probability_max[i]
      }));
      memo = {
        city, at: Date.now(), ok: true,
        temp: Math.round(j.current.temperature_2m), feels: Math.round(j.current.apparent_temperature),
        code: j.current.weather_code, days
      };
      await DF.store.setKV('weather', memo);
      return memo;
    } catch (e) {
      console.warn('날씨를 불러오지 못했어요.', e);
      if (cached && cached.city === city) return (memo = Object.assign({}, cached, { stale: true }));
      return { city, ok: false };
    }
  }
  function forDate(w, date) { return w && w.ok ? w.days.find(d => d.date === date) || null : null; }

  DF.weather = { CITIES, describe, get, forDate };
})(window.DF = window.DF || {});

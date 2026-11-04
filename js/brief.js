/* DAYFLOW — 브리핑 엔진
 * 저장된 일정만 근거로 분석한다. 일정이 없으면 없는 대로 말하고, 새 일정을 지어내지 않는다. */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store, josa = DF.nlp.josa;

  const QUOTES = [
    '한 번에 하나씩 하면 생각보다 많은 걸 끝낼 수 있어요.',
    '계획은 완벽하지 않아도 괜찮아요. 시작할 수 있으면 충분합니다.',
    '중간에 쉬는 시간도 일정의 일부예요.',
    '급한 일보다 중요한 일을 먼저 챙겨 보세요.',
    '물 한 잔 마시고 시작해 볼까요?',
    '끝낸 일은 체크하고, 못 한 일은 내일로 넘기면 됩니다.',
    '오늘 할 일을 줄이는 것도 좋은 계획이에요.',
    '어려운 일은 집중이 잘 되는 시간에 두는 게 좋아요.',
    '조금 일찍 출발하면 하루가 덜 바빠집니다.',
    '잘 쉬어야 다음 일정도 잘 해낼 수 있어요.',
    '작은 일 하나를 먼저 끝내면 나머지가 수월해져요.',
    '오늘 하루도 무리하지 말고 하나씩 해 봐요.',
    '준비물은 전날 챙겨 두면 아침이 여유로워요.',
    '집중이 안 될 땐 10분만 해 보자는 마음으로 시작해 보세요.',
    '해야 할 일을 적어 두면 머리가 한결 가벼워져요.',
    '이동하는 시간도 계획에 넣어 두면 덜 쫓기게 돼요.',
    '오늘 잘한 일 하나쯤은 스스로 인정해 주세요.',
    '하루를 마무리할 때 내일 첫 일정만 확인해도 충분해요.',
    '바쁜 날일수록 식사는 거르지 마세요.',
    '계획대로 안 되는 날도 있어요. 다시 조정하면 됩니다.',
    '가장 하기 싫은 일을 먼저 끝내 보는 것도 방법이에요.',
    '틈나는 시간에 짧게라도 몸을 움직여 보세요.',
    '중요한 약속은 시간을 한 번 더 확인해 두면 좋아요.',
    '오늘의 목표는 어제보다 조금 더 정리된 하루예요.'
  ];
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  function quote(date) { return QUOTES[hash(date) % QUOTES.length]; }

  // 일정 내용 → 준비할 것
  const PREP = [
    [/수영/, '수영복과 수건'],
    [/축구|풋살|농구|배드민턴|테니스|탁구|야구|러닝|달리기|조깅|마라톤|헬스|운동|PT|요가|필라테스|클라이밍/i, '운동복과 물'],
    [/주짓수|태권도|합기도|유도|복싱/, '도복과 물'],
    [/시험|고사|모의고사|퀴즈/, '시험 범위 복습과 필기구'],
    [/발표|프레젠테이션|PT자료/, '발표 자료 최종 점검'],
    [/면접/, '이력서와 예상 질문 정리'],
    [/병원|치과|진료|검진/, '신분증 (필요하면 진료 기록)'],
    [/과제|숙제|레포트|리포트|제출/, '제출물 최종 확인'],
    [/학원|과외|수업|강의|학교/, '교재와 필기구'],
    [/여행|캠핑/, '짐과 교통편 확인'],
    [/생일|선물/, '선물 준비'],
    [/비행기|기차|KTX|SRT|버스\s*예매/i, '표와 출발 시간 확인']
  ];
  function prepFor(o) {
    const text = o.title + ' ' + o.description;
    const hit = PREP.find(([re]) => re.test(text));
    return hit ? hit[1] : null;
  }

  function score(o) {
    let s = 0;
    if (o.priority === 'high') s += 10;
    if (o.priority === 'low') s -= 5;
    if (/시험|고사|면접|발표|마감|제출|병원|치과|예약/.test(o.title)) s += 4;
    if (o.start) s += 2;
    if (o.location) s += 1;
    if (o.reminders.length) s += 1;
    return s;
  }
  function importantOf(occs) {
    const open = occs.filter(o => !o.done);
    if (!open.length) return [];
    // 이미 끝난 일정보다 아직 남은 일정을 앞에 둔다
    const nowMin = T.now().minutes, today = T.now().date;
    const ahead = o => (o.occDate !== today || !o.start || S.span(o)[1] > nowMin ? 0 : 1);
    const high = open.filter(o => o.priority === 'high').sort((a, b) => ahead(a) - ahead(b));
    if (high.length) return high;
    const best = open.slice().sort((a, b) => score(b) - score(a))[0];
    return score(best) > 2 ? [best] : [];
  }
  function reasonOf(o) {
    if (o.priority === 'high') return '중요도가 높은 일정이에요';
    if (/시험|고사|면접|발표|마감|제출/.test(o.title)) return '놓치면 안 되는 일정이에요';
    if (/병원|치과|예약/.test(o.title)) return '예약된 일정이라 시간을 꼭 지켜야 해요';
    return '시간과 장소가 정해진 일정이에요';
  }
  const qj = (t, pair) => '‘' + t + '’' + josa(t, pair).slice(t.length);
  const when = o => (o.start ? T.timeK(o.start) : '시간 미정');

  /** 하루 분석: 빈 시간, 겹침, 빠듯한 이동 */
  function analyze(date, occs, nowMin) {
    const timed = occs.filter(o => o.start);
    const overlaps = [], tight = [], free = [];
    for (let i = 0; i < timed.length - 1; i++) {
      const a = timed[i], b = timed[i + 1];
      const [, ae] = S.span(a), [bs] = S.span(b);
      const gap = bs - ae;
      if (gap < 0) overlaps.push([a, b]);
      else if (gap < 30 && a.location && b.location && a.location !== b.location) tight.push([a, b, gap]);
      else if (gap >= 60) free.push({ from: ae, to: bs, len: gap, after: a, before: b });
    }
    if (timed.length) {
      const lastEnd = Math.max(...timed.map(o => S.span(o)[1]));
      if (lastEnd <= 21 * 60) free.push({ from: lastEnd, to: 22 * 60, len: 22 * 60 - lastEnd, after: timed[timed.length - 1], evening: true });
    }
    const first = timed.find(o => !o.done && (nowMin == null || S.span(o)[1] > nowMin));
    return { timed, untimed: occs.filter(o => !o.start), overlaps, tight, free, first };
  }

  /** 아침 브리핑 데이터 + 텍스트 */
  function morning(date, weather) {
    const n = T.now();
    const occs = S.on(date);
    const isToday = date === n.date;
    const wDay = DF.weather.forDate(weather, date);
    const greet = isToday ? (n.h < 11 ? '좋은 아침입니다!' : n.h < 18 ? '오늘의 브리핑이에요.' : '오늘 하루를 정리해 볼게요.') : `${T.fmtDate(date)} 브리핑이에요.`;
    const out = { date, greet, occs, quote: quote(date), weather: wDay, sections: {} };
    const lines = [greet];

    if (wDay) {
      const [desc] = DF.weather.describe(wDay.code);
      let w = `날씨는 ${desc}, 최고 ${wDay.max}° / 최저 ${wDay.min}°예요.`;
      if (wDay.rain >= 50) w += ` 비 올 확률이 ${wDay.rain}%라 우산을 챙기세요.`;
      out.weatherLine = w;
      lines.push(w);
    }

    if (!occs.length) {
      out.empty = true;
      out.summary = '오늘은 등록된 일정이 없어요. 여유로운 하루예요.';
      lines.push(out.summary, '하고 싶은 일이 생기면 바로 추가해 주세요.', out.quote);
      out.text = lines.join('\n');
      return out;
    }

    const a = analyze(date, occs, isToday ? n.minutes : null);
    out.analysis = a;
    out.summary = `오늘은 총 ${occs.length}개의 일정이 있어요.`;
    lines.push(out.summary);
    occs.forEach(o => lines.push(`${o.start || '미정'} ${o.title}${o.location ? ` (${o.location})` : ''}`));

    // ② 가장 중요한 일정
    out.important = importantOf(occs).map(o => ({ o, reason: reasonOf(o) }));
    if (out.important.length) {
      const top = out.important[0].o;
      lines.push(`오늘 가장 중요한 일정은 ${when(top)} ${qj(top.title, '이에요/예요')}.`);
    }

    // ③ 시간 관리 분석
    const time = [];
    a.overlaps.forEach(([x, y]) => time.push({ kind: 'warn', text: `${qj(x.title, '과/와')} ‘${y.title}’ 시간이 겹쳐요. 하나를 옮길지 확인해 주세요.` }));
    a.tight.forEach(([x, y, gap]) => time.push({ kind: 'warn', text: `‘${x.title}’(${x.location})에서 ‘${y.title}’(${y.location})까지 ${gap ? gap + '분' : '쉬는 시간 없이'} 이동해야 해요. 조금 일찍 나서는 게 좋아요.` }));
    a.free.filter(f => !f.evening).forEach(f => time.push({ kind: 'info', text: `‘${f.after.title}’ 후 ${T.fromMin(f.from)}~${T.fromMin(f.to)} 사이에 약 ${T.durK(f.len)}의 여유가 있어요.` }));
    if (a.first && isToday) {
      const left = T.toMin(a.first.start) - n.minutes;
      if (left > 0 && left <= 180) time.push({ kind: 'info', text: `다음 일정 ‘${a.first.title}’까지 ${T.durK(left)} 남았어요.` });
    }
    if (!time.length && a.timed.length > 1) time.push({ kind: 'info', text: '일정 사이에 겹치거나 빠듯한 부분은 없어요.' });
    out.sections.time = time;
    time.forEach(t => lines.push(t.text));

    // ④ 하루 계획 제안
    const plan = [];
    if (a.first) plan.push(`가장 먼저 ${when(a.first)} ‘${a.first.title}’ 준비부터 시작하세요.`);
    const bigFree = a.free.slice().sort((x, y) => y.len - x.len)[0];
    a.untimed.filter(o => !o.done).forEach((o, i) => {
      const slot = a.free[i] || bigFree;
      const topic = josa(o.title, '은/는').slice(o.title.length);
      if (slot) plan.push(`시간이 정해지지 않은 ‘${o.title}’${topic} ‘${slot.after.title}’ 이후${slot.evening ? ' 저녁 시간' : `(${T.fromMin(slot.from)}~)`}에 하면 좋겠어요.`);
      else plan.push(`‘${o.title}’도 잊지 말고 시간을 정해 두세요.`);
    });
    const rest = a.free.find(f => !f.evening && f.len >= 90);
    if (rest) plan.push(`${T.fromMin(rest.from)} 이후에 잠깐 쉬어 가면 좋아요.`);
    else if (a.timed.length >= 4) plan.push('일정이 촘촘해요. 이동하면서 짧게라도 쉬는 시간을 챙기세요.');
    const preps = [...new Set(occs.filter(o => !o.done).map(o => { const p = prepFor(o); return p ? `${o.title}: ${p}` : null; }).filter(Boolean))];
    if (wDay && wDay.rain >= 50) preps.push('우산');
    out.sections.plan = plan;
    out.sections.prep = preps;
    plan.forEach(p => lines.push(p));
    if (preps.length) lines.push('미리 준비할 것: ' + preps.join(', '));

    lines.push(out.quote);
    out.text = lines.join('\n');
    return out;
  }

  /** 대시보드 상단 'AI의 한마디' — 오늘 상황을 한 줄로 */
  function dailyLine(date) {
    const n = T.now();
    const occs = S.on(date);
    const open = occs.filter(o => !o.done);
    if (!occs.length) return { line: '오늘은 등록된 일정이 없어요. 여유롭게 보내도 좋은 날이에요.', quote: quote(date) };
    if (!open.length) return { line: `오늘 일정 ${occs.length}개를 모두 마쳤어요. 수고 많았어요.`, quote: quote(date) };
    const next = open.find(o => o.start && S.span(o)[1] > n.minutes);
    const imp = importantOf(occs)[0];
    let line = `오늘 남은 일정은 ${open.length}개예요.`;
    if (next) {
      const left = T.toMin(next.start) - n.minutes;
      line += left > 0 ? ` 다음은 ${T.timeK(next.start)} ‘${next.title}’${left <= 120 ? `(${T.durK(left)} 뒤)` : ''}이에요.` : ` 지금은 ‘${next.title}’ 시간이에요.`;
    }
    if (imp && (!next || imp.id !== next.id)) line += ` 가장 중요한 건 ${qj(imp.title, '이에요/예요')}.`;
    return { line, quote: quote(date) };
  }

  /** 저녁 마감용: 내일 요약 */
  function tomorrow(date, weather) {
    const occs = S.on(date);
    const wDay = DF.weather.forDate(weather, date);
    const preps = [...new Set(occs.map(o => { const p = prepFor(o); return p ? `${o.title}: ${p}` : null; }).filter(Boolean))];
    if (wDay && wDay.rain >= 50) preps.push(`우산 (비 올 확률 ${wDay.rain}%)`);
    const first = occs.find(o => o.start);
    return { date, occs, preps, first, weather: wDay };
  }

  /** 미래 예측: 바쁜 날, 몰린 기간, 미리 준비할 일정 */
  function forecast(days = 21) {
    const today = T.now().date;
    const end = T.addDays(today, days - 1);
    const occs = S.occurrences(today, end);
    const byDay = T.range(today, end).map(d => {
      const list = occs.filter(o => o.occDate === d);
      const mins = list.filter(o => o.start).reduce((s, o) => s + (S.span(o)[1] - S.span(o)[0]), 0);
      return { date: d, count: list.length, mins, high: list.filter(o => o.priority === 'high').length };
    });
    const avg = byDay.reduce((s, d) => s + d.count, 0) / byDay.length || 0;
    const busy = byDay.filter(d => d.count >= Math.max(3, Math.ceil(avg * 1.5))).sort((a, b) => b.count - a.count);
    const clusters = [];
    let run = [];
    byDay.forEach(d => {
      if (d.count >= Math.max(2, Math.ceil(avg))) run.push(d);
      else { if (run.length >= 3) clusters.push(run); run = []; }
    });
    if (run.length >= 3) clusters.push(run);
    const prepare = occs.filter(o => !o.done && o.occDate > today && T.diff(today, o.occDate) <= 14 &&
      (o.priority === 'high' || /시험|고사|발표|면접|마감|제출|여행/.test(o.title)))
      .slice(0, 8).map(o => ({ o, dday: T.diff(today, o.occDate), prep: prepFor(o) }));
    return { byDay, avg, busy, clusters, prepare };
  }

  /** 통계 */
  function stats() {
    const n = T.now(), today = n.date;
    const ws = T.weekStart(today), ms = T.monthStart(today);
    const week = S.occurrences(ws, T.addDays(ws, 6));
    const month = S.occurrences(ms, T.monthEnd(today));
    const catMins = {};
    S.CATEGORIES.forEach(c => { catMins[c] = 0; });
    month.forEach(o => { catMins[o.category] += o.start ? S.span(o)[1] - S.span(o)[0] : 0; });
    const past = S.occurrences(T.addDays(today, -29), today);
    const done = past.filter(o => o.done).length;
    const dowCount = [0, 0, 0, 0, 0, 0, 0];
    S.occurrences(T.addDays(today, -55), today).forEach(o => { dowCount[T.dow(o.occDate)]++; });
    const maxDow = Math.max(...dowCount);
    return {
      weekCount: week.length, weekDone: week.filter(o => o.done).length,
      monthCount: month.length, monthDone: month.filter(o => o.done).length,
      catMins, rate: past.length ? Math.round((done / past.length) * 100) : null, pastCount: past.length, pastDone: done,
      dowCount, busiestDow: maxDow ? dowCount.indexOf(maxDow) : null
    };
  }

  DF.brief = { morning, dailyLine, tomorrow, forecast, stats, analyze, prepFor, importantOf, quote };
})(window.DF = window.DF || {});

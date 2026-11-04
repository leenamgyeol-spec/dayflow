/* DAYFLOW — 공용 UI 컴포넌트: 아이콘, 토스트, 모달, 일정 폼, 저장 전 충돌 확인 */
(function (DF) {
  'use strict';
  const T = DF.time, S = DF.store;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    chart: '<path d="M3 3v18h18M7 16v-5M12 16V8M17 16v-3"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    spark: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
    cloudSun: '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4M15.9 12.7A4 4 0 0 0 8.4 9.6"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
    rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2M16 14v6M8 14v6M12 16v6"/>',
    snow: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
    storm: '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9M13 11l-4 6h6l-4 6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    send: '<path d="m22 2-7 20-4-9-9-4ZM22 2 11 13"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    sunrise: '<path d="M12 2v6M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4M22 22H2M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0"/>',
    moonset: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M2 22h20"/>'
  };
  function icon(name, size = 18, cls = '') {
    return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  // ───────── 토스트 ─────────
  function toast(html, opts = {}) {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (opts.important ? ' toast-important' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="toast-body">${html}</div>` + (opts.action ? `<button class="toast-btn">${esc(opts.action)}</button>` : '') +
      `<button class="toast-x" aria-label="닫기">${icon('x', 14)}</button>`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 180); };
    el.querySelector('.toast-x').onclick = close;
    if (opts.action) el.querySelector('.toast-btn').onclick = () => { opts.onAction(); close(); };
    root.appendChild(el);
    setTimeout(close, opts.duration || 4500);
  }

  // ───────── 모달 ─────────
  let modalStack = [];
  function modal(html, opts = {}) {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${opts.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    root.appendChild(wrap);
    document.body.classList.add('modal-open');
    const prevFocus = document.activeElement;
    const api = {
      el: wrap.querySelector('.modal'),
      close(result) {
        if (!wrap.isConnected) return;
        wrap.remove();
        modalStack = modalStack.filter(m => m !== api);
        if (!modalStack.length) document.body.classList.remove('modal-open');
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        if (opts.onClose) opts.onClose(result);
      }
    };
    modalStack.push(api);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) api.close(); });
    api.el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => api.close()));
    const first = api.el.querySelector('[autofocus], input, select, textarea, button');
    setTimeout(() => first && first.focus(), 30);
    return api;
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
  });

  /** 선택지 대화상자: choices = [{id, label, kind}] → 선택한 id (닫으면 null) */
  function choose(title, bodyHtml, choices) {
    return new Promise(resolve => {
      let picked = null;
      const m = modal(`
        <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot stack-mobile">${choices.map(c => `<button class="btn ${c.kind || ''}" data-choice="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>`,
      { onClose: () => resolve(picked) });
      m.el.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => { picked = b.dataset.choice; m.close(); }));
    });
  }
  function confirmBox(title, bodyHtml, okLabel = '확인', danger = false) {
    return choose(title, bodyHtml, [{ id: 'cancel', label: '취소', kind: 'ghost' }, { id: 'ok', label: okLabel, kind: danger ? 'danger' : 'primary' }]).then(v => v === 'ok');
  }

  // ───────── 일정 표시 ─────────
  const catDot = c => `<span class="cat-dot" style="--c:${S.CAT_COLOR[c] || '#868e96'}"></span>`;
  function timeLabel(o) {
    if (!o.start) return '<span class="muted">미정</span>';
    return `${o.start}${o.end ? `<span class="t-end">–${o.end}</span>` : ''}`;
  }
  function metaLine(o, showDate) {
    const parts = [];
    if (showDate) parts.push(esc(T.relLabel(o.occDate || o.date)));
    if (o.endDate) parts.push(`${icon('calendar', 13)}${esc(T.fmtDate(o.date, false))}~${esc(T.fmtDate(o.endDate, false))}${o.dayIndex ? ` · ${o.dayIndex}/${o.dayTotal}일째` : ''}`);
    if (o.location) parts.push(`${icon('pin', 13)}${esc(o.location)}`);
    if (o.repeat && o.repeat.freq !== 'none') parts.push(`${icon('repeat', 13)}${S.REPEAT[o.repeat.freq]}`);
    if (o.reminders && o.reminders.length) parts.push(`${icon('bell', 13)}${o.reminders.map(m => (m ? T.durK(m) + ' 전' : '정시')).join(', ')}`);
    parts.push(`${catDot(o.category)}${esc(o.category)}`);
    return parts.map(p => `<span>${p}</span>`).join('');
  }
  function occRow(o, opts = {}) {
    return `<div class="ev ${o.done ? 'is-done' : ''} ${o.priority === 'high' ? 'is-high' : ''} ${opts.now ? 'is-now' : ''}" data-occ="${esc(o.key)}">
      <button class="check ${o.done ? 'on' : ''}" data-act="toggle" aria-label="${o.done ? '완료 취소' : '완료로 표시'}">${icon('check', 14)}</button>
      <div class="ev-time">${timeLabel(o)}</div>
      <button class="ev-main" data-act="open">
        <span class="ev-title">${o.priority === 'high' ? `<span class="badge-high">중요</span>` : ''}${esc(o.title)}</span>
        <span class="ev-meta">${metaLine(o, opts.showDate)}</span>
      </button>
    </div>`;
  }

  // ───────── 일정 폼 (상세 입력 / 미리보기 공용) ─────────
  const REMINDER_OPTS = [[0, '정시'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [1440, '하루 전']];
  function formHtml(d, opts = {}) {
    d = Object.assign({ title: '', date: T.now().date, start: '', end: '', location: '', description: '', category: '기타', priority: 'normal', repeat: { freq: 'none' }, reminders: [] }, d);
    const rem = d.reminders || [];
    const custom = rem.filter(m => !REMINDER_OPTS.some(([v]) => v === m));
    return `<div class="form" data-form>
      <label class="field full"><span>일정 제목</span><input name="title" required maxlength="120" value="${esc(d.title)}" placeholder="예: 수학 학원"></label>
      <label class="field"><span>날짜 (시작일)</span><input type="date" name="date" required value="${esc(d.date || '')}"></label>
      <label class="field"><span>끝나는 날 <em class="muted">여러 날 일정일 때</em></span><input type="date" name="endDate" value="${esc(d.endDate || '')}" min="${esc(d.date || '')}"></label>
      <div class="field two full"><label><span>시작</span><input type="time" name="start" value="${esc(d.start || '')}"></label><label><span>종료</span><input type="time" name="end" value="${esc(d.end || '')}"></label></div>
      <label class="field full"><span>장소</span><input name="location" maxlength="120" value="${esc(d.location)}" placeholder="선택"></label>
      <label class="field"><span>카테고리</span><select name="category">${S.CATEGORIES.map(c => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>중요도</span><select name="priority">${Object.entries(S.PRIORITY).map(([k, v]) => `<option value="${k}" ${k === d.priority ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>반복</span><select name="repeat">${Object.entries(S.REPEAT).map(([k, v]) => `<option value="${k}" ${k === (d.repeat && d.repeat.freq) ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>반복 종료일</span><input type="date" name="until" value="${esc((d.repeat && d.repeat.until) || '')}"></label>
      <div class="field full"><span>알림</span><div class="chips" data-reminders>
        ${REMINDER_OPTS.map(([v, l]) => `<label class="chip-check"><input type="checkbox" value="${v}" ${rem.includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        <label class="chip-input"><input type="number" min="1" max="10080" name="customRem" placeholder="직접(분)" value="${custom[0] || ''}"><span>분 전</span></label>
      </div></div>
      ${opts.compact ? '' : `<label class="field full"><span>상세 설명</span><textarea name="description" rows="3" maxlength="2000" placeholder="메모, 준비물 등">${esc(d.description)}</textarea></label>`}
      ${opts.showDone ? `<label class="field full check-line"><input type="checkbox" name="done" ${d.done ? 'checked' : ''}> 완료한 일정</label>` : ''}
    </div>`;
  }
  function readForm(root) {
    const f = root.querySelector('[data-form]');
    const v = n => { const el = f.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; };
    const reminders = [...f.querySelectorAll('[data-reminders] input[type=checkbox]:checked')].map(i => +i.value);
    const custom = parseInt(v('customRem'), 10);
    if (custom > 0) reminders.push(custom);
    const doneEl = f.querySelector('[name="done"]');
    const out = {
      title: v('title'), date: v('date'), endDate: v('endDate') && v('endDate') !== v('date') ? v('endDate') : null, start: v('start') || null, end: v('end') || null, location: v('location'),
      category: v('category'), priority: v('priority'), repeat: { freq: v('repeat'), until: v('until') || null }, reminders
    };
    const desc = f.querySelector('[name="description"]');
    if (desc) out.description = desc.value.trim();
    if (doneEl) out.done = doneEl.checked;
    return out;
  }
  function validate(d) {
    if (!d.title) return '일정 제목을 입력해 주세요.';
    if (!T.isDate(d.date)) return '날짜를 확인해 주세요.';
    if (d.end && !d.start) return '종료 시간만 있을 수는 없어요. 시작 시간을 입력해 주세요.';
    if (d.start && d.end && T.toMin(d.end) <= T.toMin(d.start)) return '종료 시간이 시작 시간보다 늦어야 해요.';
    if (d.repeat && d.repeat.until && d.repeat.until < d.date) return '반복 종료일이 시작 날짜보다 빨라요.';
    if (d.endDate && !T.isDate(d.endDate)) return '끝나는 날을 확인해 주세요.';
    if (d.endDate && d.endDate < d.date) return '끝나는 날이 시작일보다 빨라요.';
    if (d.endDate && T.diff(d.date, d.endDate) > 366) return '여러 날 일정은 1년까지만 만들 수 있어요.';
    if (d.endDate && d.repeat && d.repeat.freq !== 'none') return '여러 날 일정은 반복으로 설정할 수 없어요. 반복을 끄거나 끝나는 날을 비워 주세요.';
    return null;
  }

  /** 저장 전에 중복·시간 충돌을 확인하고 사용자가 해결 방법을 고르게 한다.
   * 반환: 저장된 일정 | null(취소) | 'edit'(다시 수정) */
  async function saveWithChecks(draft, existingId) {
    const err = validate(draft);
    if (err) { toast(esc(err)); return 'edit'; }
    const dup = S.duplicates(draft, existingId);
    if (dup.length && !existingId) {
      const v = await choose('같은 일정이 이미 있어요', `<p>${esc(T.fmtDate(draft.date))}에 같은 제목의 일정이 이미 있어요.</p>${dup.map(o => occRow(o)).join('')}<p class="muted">그래도 추가할까요?</p>`,
        [{ id: 'cancel', label: '추가하지 않기', kind: 'ghost' }, { id: 'edit', label: '다시 수정', kind: 'ghost' }, { id: 'ok', label: '그래도 추가', kind: 'primary' }]);
      if (v === 'edit') return 'edit';
      if (v !== 'ok') return null;
    }
    const conf = S.conflicts(draft, existingId);
    if (conf.length) {
      const dur = draft.end ? T.toMin(draft.end) - T.toMin(draft.start) : 60;
      const slot = S.freeSlot(draft.date, dur, T.toMin(draft.start), existingId);
      const v = await choose('시간이 겹치는 일정이 있어요',
        `<p><b>${esc(draft.title)}</b> (${esc(draft.start)}${draft.end ? '–' + esc(draft.end) : ''})과 겹치는 일정:</p>${conf.map(o => occRow(o)).join('')}
         <p class="muted">어떻게 할까요?${slot ? ` 가장 가까운 빈 시간은 <b>${slot}</b>이에요.` : ''}</p>`,
        [{ id: 'cancel', label: '취소', kind: 'ghost' }, { id: 'edit', label: '시간 직접 수정', kind: 'ghost' }]
          .concat(slot ? [{ id: 'slot', label: `${slot}에 저장`, kind: '' }] : [])
          .concat([{ id: 'ok', label: '겹쳐도 저장', kind: 'primary' }]));
      if (v === 'edit') return 'edit';
      if (v === 'slot') {
        draft = Object.assign({}, draft, { start: slot, end: draft.end ? T.fromMin(T.toMin(slot) + dur) : null });
      } else if (v !== 'ok') return null;
    }
    try {
      const ev = existingId ? await S.update(existingId, draft) : await S.add(draft);
      return ev;
    } catch (e) {
      console.error(e);
      toast('저장하지 못했어요. 다시 시도해 주세요. (' + esc(e.message) + ')', { important: true });
      return null;
    }
  }

  /** 일정 상세/편집 모달. occ가 없으면 새 일정. */
  function openEvent(occ, preset) {
    const ev = occ ? S.get(occ.id) : null;
    const data = ev ? Object.assign({}, ev, { done: occ.done }) : Object.assign({ reminders: [S.settings.defaultReminder].filter(x => x != null && x !== '' && x >= 0) }, preset);
    const isRepeat = ev && S.isSeries(ev);
    const kind = ev && ev.endDate ? '여러 날 일정' : '반복 일정';
    const m = modal(`
      <div class="modal-head"><h2>${ev ? '일정 수정' : '새 일정'}</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
      <div class="modal-body">${isRepeat ? `<p class="note">${icon('repeat', 14)} ${kind}이에요. 수정하면 모든 날에 적용되고, 완료 체크는 ${esc(T.fmtDate(occ.occDate))}에만 적용돼요.</p>` : ''}${formHtml(data, { showDone: !!ev })}</div>
      <div class="modal-foot">
        ${ev ? `<button class="btn ghost danger-text" data-del>${icon('trash', 16)} 삭제</button>` : ''}
        <span class="grow"></span>
        <button class="btn ghost" data-close>취소</button>
        <button class="btn primary" data-save>${ev ? '저장' : '추가'}</button>
      </div>`, { wide: true });
    m.el.querySelector('[data-save]').addEventListener('click', async () => {
      const d = readForm(m.el);
      const done = d.done; delete d.done;
      if (isRepeat) delete d.done;
      const r = await saveWithChecks(d, ev && ev.id);
      if (r === 'edit' || r === null) { if (r === null) m.close(); return; }
      if (ev && done !== undefined && done !== occ.done) await S.setDone(Object.assign({}, occ, { id: r.id }), done);
      m.close();
      toast(ev ? '일정을 수정했어요.' : `‘${esc(r.title)}’ 일정을 추가했어요.`);
    });
    const del = m.el.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => { m.close(); await deleteOcc(occ); });
    return m;
  }

  async function deleteOcc(occ) {
    const ev = S.get(occ.id);
    if (!ev) return;
    if (S.isSeries(ev)) {
      const kind = ev.endDate ? '여러 날 일정' : '반복 일정';
      const v = await choose(`${kind} 삭제`, `<p>‘${esc(ev.title)}’${DF.nlp.josa(ev.title, '은/는').slice(ev.title.length)} ${kind}이에요. 어떻게 삭제할까요?</p>`,
        [{ id: 'cancel', label: '취소', kind: 'ghost' }, { id: 'one', label: `${T.fmtDate(occ.occDate)}만 삭제` }, { id: 'all', label: ev.endDate ? '전체 기간 삭제' : '모든 반복 삭제', kind: 'danger' }]);
      if (v === 'one') {
        const before = Object.assign({}, ev);
        await S.skipOcc(occ);
        toast('그날 일정만 삭제했어요.', { action: '되돌리기', onAction: () => S.restore(before) });
        return;
      }
      if (v !== 'all') return;
    } else if (!(await confirmBox('일정 삭제', `<p>‘${esc(ev.title)}’ 일정을 삭제할까요?</p>`, '삭제', true))) return;
    const removed = await S.remove(ev.id);
    toast('일정을 삭제했어요.', { action: '되돌리기', onAction: () => S.restore(removed), duration: 8000 });
  }

  DF.ui = { esc, icon, toast, modal, choose, confirmBox, occRow, catDot, metaLine, formHtml, readForm, validate, saveWithChecks, openEvent, deleteOcc };
})(window.DF = window.DF || {});

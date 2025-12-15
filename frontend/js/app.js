import { api, clearToken, fmtDate, openModal, closeModal, qs, qsa, escapeHtml, initCommon, initNavToggle, toast, setToken } from '/js/common.js';

initCommon();

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let me = null;
let events = [];
let currentEvent = null;  // Событие, к которому прикреплён и по которому оцениваем
let criteria = [];
let currentTarget = null;
let currentTargetName = null;

// ==================== УТИЛИТЫ ====================

function normalizeGroupValue(el) {
  if (!el) return '';
  const v = (el.value || '').replace(/\s+/g, '');
  if (v !== el.value) el.value = v;
  return v;
}

function showTab(key) {
  qsa('.tabbtn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  ['events', 'eval', 'results', 'profile'].forEach(k => {
    const sec = qs(`#tab-${k}`);
    if (sec) sec.style.display = k === key ? '' : 'none';
  });
}

// ==================== ЗАГРУЗКА ДАННЫХ ====================

async function loadMe() {
  me = await api('/api/me');
  qs('#meLine').textContent = `${me.full_name} · ${me.group} · @${me.nickname}`;
  qs('#pFull').textContent = me.full_name;
  qs('#pGroup').textContent = me.group;
  qs('#pNick').textContent = me.nickname;
  qs('#pCreated').textContent = fmtDate(me.created_at);
  if (qs('#editFull')) qs('#editFull').value = me.full_name;
  if (qs('#editGroup')) qs('#editGroup').value = me.group;
  if (qs('#editNick')) qs('#editNick').value = me.nickname;
}

async function loadEvents() {
  const status = qs('#eventsStatus');
  status.textContent = 'Загрузка...';
  try {
    events = await api('/api/events?active_only=false');
    renderEventsGrid();
    updateCurrentEvent();
    status.textContent = `Событий: ${events.length}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

function renderEventsGrid() {
  const grid = qs('#eventsGrid');
  const searchInput = qs('#eventsSearch');
  const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  
  // Фильтруем по поиску
  let filtered = events;
  if (searchQuery) {
    filtered = events.filter(e => 
      e.name.toLowerCase().includes(searchQuery) || 
      (e.description || '').toLowerCase().includes(searchQuery)
    );
  }
  
  // Разделяем на активные и неактивные
  const active = filtered.filter(e => e.is_active).sort((a, b) => {
    if (a.is_joined && !b.is_joined) return -1;
    if (!a.is_joined && b.is_joined) return 1;
    return 0;
  });
  
  const inactive = filtered.filter(e => !e.is_active).sort((a, b) => {
    if (a.is_joined && !b.is_joined) return -1;
    if (!a.is_joined && b.is_joined) return 1;
    return 0;
  });
  
  if (!filtered.length) {
    grid.innerHTML = '<p class="muted">Нет событий, соответствующих поиску</p>';
    return;
  }
  
  const renderCard = (e) => `
    <div class="event-card ${e.is_joined ? 'joined' : ''} ${!e.is_active ? 'inactive' : ''}">
      <div class="event-card-header">
        <h3>${escapeHtml(e.name)}</h3>
        ${!e.is_active ? '<span class="badge muted">Неактивно</span>' : ''}
        ${e.is_joined ? '<span class="badge success">Вы участник</span>' : ''}
      </div>
      <p class="muted">${escapeHtml(e.description || 'Без описания')}</p>
      <div class="event-card-footer">
        <span class="muted">👥 ${e.participants_count} участников</span>
        ${e.is_active ? (e.is_joined 
          ? `<button class="btn danger" data-leave="${e.id}">Открепиться</button>`
          : `<button class="btn primary" data-join="${e.id}">Прикрепиться</button>`
        ) : ''}
      </div>
    </div>
  `;
  
  let html = '';
  
  // Активные события
  if (active.length) {
    html += `<div class="events-section-title">✅ Активные события</div>`;
    html += `<div class="events-section">${active.map(renderCard).join('')}</div>`;
  }
  
  // Разделитель и неактивные события
  if (inactive.length) {
    if (active.length) {
      html += `<div class="events-divider"></div>`;
    }
    html += `<div class="events-section-title muted">📦 Архив (неактивные)</div>`;
    html += `<div class="events-section">${inactive.map(renderCard).join('')}</div>`;
  }
  
  grid.innerHTML = html;
  
  qsa('button[data-join]', grid).forEach(btn => {
    btn.addEventListener('click', () => confirmAction(
      'Прикрепиться к событию?',
      `Вы будете добавлены как участник события "${events.find(e => e.id === +btn.dataset.join)?.name}"`,
      () => joinEvent(+btn.dataset.join)
    ));
  });
  
  qsa('button[data-leave]', grid).forEach(btn => {
    btn.addEventListener('click', () => confirmAction(
      'Открепиться от события?',
      `Вы будете удалены из списка участников события "${events.find(e => e.id === +btn.dataset.leave)?.name}"`,
      () => leaveEvent(+btn.dataset.leave)
    ));
  });
}

function updateCurrentEvent() {
  // Получаем события, к которым прикреплён пользователь
  const joinedEvents = events.filter(e => e.is_active && e.is_joined);
  
  const evalNotActive = qs('#evalNotActive');
  const evalContent = qs('#evalContent');
  const evalSelect = qs('#evalEvent');
  
  if (joinedEvents.length > 0) {
    evalNotActive.style.display = 'none';
    evalContent.style.display = '';
    
    // Заполняем селект событий
    evalSelect.innerHTML = joinedEvents.map(e => 
      `<option value="${e.id}">${escapeHtml(e.name)}</option>`
    ).join('');
    
    // Устанавливаем текущее событие
    if (!currentEvent || !joinedEvents.find(e => e.id === currentEvent.id)) {
      currentEvent = joinedEvents[0];
    }
    evalSelect.value = currentEvent.id;
  } else {
    evalNotActive.style.display = '';
    evalContent.style.display = 'none';
    currentEvent = null;
  }
  
  // Обновляем селект событий в результатах
  updateResultsEventSelect();
}

// Только активные события, к которым прикреплён юзер
function getResultsEvents() {
  return events.filter(e => e.is_joined && e.is_active);
}

function updateResultsEventSelect() {
  const input = qs('#resultsEventSearch');
  const hidden = qs('#resultsEvent');
  const available = getResultsEvents();
  
  renderResultsEventDropdown('');
  
  // Пытаемся восстановить выбранное
  const prevId = +hidden.value || currentEvent?.id;
  if (prevId && available.some(e => e.id === prevId)) {
    const evt = available.find(e => e.id === prevId);
    hidden.value = prevId;
    input.value = evt.name;
    input.classList.add('has-value');
  } else if (available.length === 1) {
    hidden.value = available[0].id;
    input.value = available[0].name;
    input.classList.add('has-value');
  } else {
    hidden.value = '';
    input.value = '';
    input.classList.remove('has-value');
  }
}

function renderResultsEventDropdown(filter) {
  const dropdown = qs('#resultsEventDropdown');
  const hidden = qs('#resultsEvent');
  const currentVal = +hidden.value || null;
  const available = getResultsEvents();
  
  const filtered = available.filter(e =>
    !filter || e.name.toLowerCase().includes(filter.toLowerCase())
  );
  
  if (!available.length) {
    dropdown.innerHTML = '<div class="searchable-no-results">Нет активных событий</div>';
    return;
  }
  if (!filtered.length) {
    dropdown.innerHTML = '<div class="searchable-no-results">Ничего не найдено</div>';
    return;
  }
  
  dropdown.innerHTML = filtered.map(e => `
    <div class="searchable-option${e.id === currentVal ? ' selected' : ''}" data-id="${e.id}">
      ${escapeHtml(e.name)}
    </div>
  `).join('');
  
  qsa('.searchable-option', dropdown).forEach(opt => {
    opt.addEventListener('click', () => selectResultsEvent(+opt.dataset.id));
  });
}

function selectResultsEvent(eventId) {
  const input = qs('#resultsEventSearch');
  const hidden = qs('#resultsEvent');
  const dropdown = qs('#resultsEventDropdown');
  
  const evt = getResultsEvents().find(e => e.id === eventId);
  if (evt) {
    hidden.value = eventId;
    input.value = evt.name;
    input.classList.add('has-value');
    dropdown.classList.remove('open');
    loadResults();
  }
}

function initResultsEventSelect() {
  const input = qs('#resultsEventSearch');
  const dropdown = qs('#resultsEventDropdown');
  const hidden = qs('#resultsEvent');
  
  if (!input || !dropdown) return;
  
  let savedValue = '';
  
  input.addEventListener('focus', () => {
    savedValue = input.value;
    input.value = '';
    renderResultsEventDropdown('');
    dropdown.classList.add('open');
  });
  
  input.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.classList.remove('open');
      if (!hidden.value) {
        input.value = savedValue;
        if (savedValue) input.classList.add('has-value');
      } else {
        const evt = getResultsEvents().find(e => e.id === +hidden.value);
        if (evt) input.value = evt.name;
      }
    }, 150);
  });
  
  input.addEventListener('input', () => {
    renderResultsEventDropdown(input.value);
    dropdown.classList.add('open');
  });
}

async function joinEvent(eventId) {
  try {
    await api(`/api/events/${eventId}/join`, { method: 'POST' });
    toast('Вы прикреплены к событию!', 'success');
    await loadEvents();
    await loadCriteria();
    await loadStudents();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function leaveEvent(eventId) {
  try {
    await api(`/api/events/${eventId}/leave`, { method: 'POST' });
    toast('Вы откреплены от события', 'success');
    await loadEvents();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadCriteria() {
  if (!currentEvent) { criteria = []; return; }
  criteria = await api(`/api/events/${currentEvent.id}/criteria`);
}

async function loadStudents() {
  if (!currentEvent) return;
  
  const status = qs('#evalStatus');
  status.textContent = '...';
  try {
    const q = qs('#studentQ').value.trim();
    const group = normalizeGroupValue(qs('#studentGroup'));
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (group) params.set('group', group);
    
    // Получаем участников текущего события
    const participants = await api(`/api/events/${currentEvent.id}/participants`);
    
    // Фильтруем по поиску
    let filtered = participants;
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(p => 
        p.full_name.toLowerCase().includes(ql) || p.nickname.toLowerCase().includes(ql)
      );
    }
    if (group) {
      const gl = group.toLowerCase();
      filtered = filtered.filter(p => p.group.replace(/\s+/g, '').toLowerCase().includes(gl));
    }

    const body = qs('#studentsBody');
    body.innerHTML = filtered.map(p => `
      <tr>
        <td>${escapeHtml(p.full_name)} <span class="muted">@${escapeHtml(p.nickname)}</span></td>
        <td>${escapeHtml(p.group)}</td>
        <td><button class="btn" data-open="${p.user_id}">Оценить</button></td>
      </tr>
    `).join('') || `<tr><td colspan="3" class="muted">Нет участников</td></tr>`;

    qsa('button[data-open]', body).forEach(btn => {
      btn.addEventListener('click', () => openStudentModal(+btn.dataset.open));
    });

    status.textContent = `Участников: ${filtered.length}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

// ==================== МОДАЛКА ОЦЕНКИ ====================

function buildScoreInputs() {
  const wrap = document.createElement('div');
  wrap.className = 'score-inputs';
  
  criteria.forEach(c => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <label title="${escapeHtml(c.description || '')}">${escapeHtml(c.name)}</label>
      <div class="score-input-wrap">
        <input type="number" step="1" min="0" max="${Math.floor(c.max_score)}" 
               placeholder="0" data-cid="${c.id}" data-max="${Math.floor(c.max_score)}" />
        <span class="muted">/ ${Math.floor(c.max_score)}</span>
      </div>
    `;
    wrap.appendChild(row);
  });
  return wrap;
}

async function openStudentModal(targetId, targetName = null) {
  currentTarget = targetId;
  currentTargetName = targetName;
  qs('#mBody').innerHTML = '';
  qs('#mStatus').textContent = '...';
  qs('#mAddStatus').textContent = '';
  qs('#mComment').value = '';
  openModal('studentModal');

  try {
    if (targetId) {
      const participant = (await api(`/api/events/${currentEvent.id}/participants`)).find(p => p.user_id === targetId);
      qs('#mTitle').textContent = participant?.full_name || `Участник #${targetId}`;
    } else {
      qs('#mTitle').textContent = targetName || 'Внешний участник';
    }
    qs('#mSub').textContent = 'Поставьте оценку по каждому критерию';

    // Загружаем предыдущие оценки
    let evals = [];
    if (targetId) {
      evals = await api(`/api/students/${targetId}/evaluations`);
    }

    // Header
    qs('#mHead').innerHTML = `
      <tr>
        <th>Оценщик</th>
        ${criteria.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}
        <th>Итого</th>
      </tr>
    `;

    // Rows
    const rows = evals.map(e => {
      const byCid = {};
      (e.scores || []).forEach(s => { byCid[String(s.criterion_id)] = s; });
      let sum = 0;
      const cells = criteria.map(c => {
        const s = byCid[String(c.id)];
        const val = s ? Math.round(s.score) : null;
        if (val !== null) sum += val;
        return `<td>${val === null ? '<span class="muted">—</span>' : val}</td>`;
      }).join('');
      // Убираем "Оценка от ..." из комментария
      let comment = (e.comment || '').slice(0, 40);
      if (comment.startsWith('Оценка от ') || comment.startsWith('(seed)')) {
        comment = '';
      }
      return `
        <tr>
          <td>
            ${escapeHtml(e.rater_full_name)}<br>
            <span class="muted">${fmtDate(e.created_at)}${comment ? ` · ${escapeHtml(comment)}` : ''}</span>
          </td>
          ${cells}
          <td><b>${sum}</b></td>
        </tr>
      `;
    });

    qs('#mBody').innerHTML = rows.join('') || `<tr><td colspan="${criteria.length + 2}" class="muted">Оценок пока нет</td></tr>`;
    qs('#mStatus').textContent = rows.length ? `Оценок: ${rows.length}` : '';

    // Form
    const form = qs('#mForm');
    form.innerHTML = '';
    form.appendChild(buildScoreInputs());

    // Pre-fill my scores
    const mine = evals.find(e => e.rater_id === me?.id);
    if (mine?.scores) {
      const map = {};
      mine.scores.forEach(s => { map[String(s.criterion_id)] = s; });
      qsa('#mForm input[type="number"]').forEach(inp => {
        const s = map[inp.dataset.cid];
        inp.value = s ? String(Math.round(s.score)) : '';
      });
      qs('#mComment').value = mine.comment || '';
      qs('#mSubmit').textContent = 'Обновить оценку';
    } else {
      qs('#mSubmit').textContent = 'Отправить оценку';
    }
  } catch (e) {
    qs('#mStatus').textContent = e.message;
  }
}

async function submitEvaluation() {
  const status = qs('#mAddStatus');
  status.textContent = '...';
  try {
    const scores = [];
    qsa('#mForm input[type="number"]').forEach(inp => {
      const v = inp.value.trim();
      if (!v) return;
      const n = Number(v);
      if (!Number.isInteger(n)) throw new Error('Оценка должна быть целым числом');
      const max = +inp.dataset.max;
      if (n > max) throw new Error(`Оценка не может превышать ${max}`);
      if (n < 0) throw new Error('Оценка не может быть отрицательной');
      scores.push({ criterion_id: +inp.dataset.cid, score: n });
    });
    if (!scores.length) throw new Error('Введите хотя бы одну оценку');

    const comment = qs('#mComment').value;
    
    if (currentTarget) {
      await api(`/api/students/${currentTarget}/evaluate`, { 
        method: 'POST', 
        body: { event_id: currentEvent.id, comment, scores } 
      });
    } else if (currentTargetName && currentEvent) {
      await api(`/api/events/${currentEvent.id}/evaluate`, { 
        method: 'POST', 
        body: { target_name: currentTargetName, comment, scores } 
      });
    } else {
      throw new Error('Выберите участника');
    }
    
    status.textContent = 'Готово!';
    toast('Оценка сохранена!', 'success');
    
    if (currentTarget) {
      await openStudentModal(currentTarget);
    } else {
      closeModal('studentModal');
    }
  } catch (e) {
    status.textContent = e.message;
    toast(e.message, 'error');
  }
}

// ==================== РЕЗУЛЬТАТЫ ====================

async function loadResults() {
  const status = qs('#resultsStatus');
  status.textContent = '...';
  
  const eventId = qs('#resultsEvent').value;
  if (!eventId) {
    qs('#resultsHead').innerHTML = '';
    qs('#resultsBody').innerHTML = '<tr><td class="muted">Выберите событие</td></tr>';
    status.textContent = '';
    return;
  }
  
  try {
    const q = qs('#resultsQ').value.trim();
    const group = normalizeGroupValue(qs('#resultsGroup'));
    const sort = qs('#resultsSort').value;
    const order = qs('#resultsOrder').value;

    const params = new URLSearchParams({ event_id: eventId });
    if (q) params.set('q', q);
    if (group) params.set('group', group);
    if (sort) params.set('sort', sort);
    if (order) params.set('order', order);

    const rows = await api(`/api/results?${params.toString()}`);
    const criteriaKeys = rows.length ? Object.keys(rows[0].criteria) : [];
    
    qs('#resultsHead').innerHTML = `
      <tr>
        <th>Участник</th>
        <th>Группа</th>
        ${criteriaKeys.map(k => `<th>${escapeHtml(k)}</th>`).join('')}
        <th>Сред. ИТОГО</th>
        <th>Оценщиков</th>
        <th></th>
      </tr>
    `;

    qs('#resultsBody').innerHTML = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.display_name || r.student_full_name)}</td>
        <td>${escapeHtml(r.group || '—')}</td>
        ${criteriaKeys.map(k => {
          const v = r.criteria[k];
          return `<td class="muted">${v === null ? '' : Number(v).toFixed(1)}</td>`;
        }).join('')}
        <td><b>${r.overall_mean === null ? '' : Number(r.overall_mean).toFixed(1)}</b></td>
        <td class="muted">${r.raters_count}</td>
        <td><button class="btn" data-detail="${encodeURIComponent(r.normalized_name)}">📋</button></td>
      </tr>
    `).join('') || `<tr><td colspan="6" class="muted">Нет данных</td></tr>`;

    qsa('button[data-detail]').forEach(btn => {
      btn.addEventListener('click', () => openDetailModal(decodeURIComponent(btn.dataset.detail), eventId));
    });

    status.textContent = `Строк: ${rows.length}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

async function openDetailModal(normalizedName, eventId) {
  qs('#dBody').innerHTML = '<tr><td class="muted">Загрузка...</td></tr>';
  openModal('detailModal');
  
  try {
    const params = new URLSearchParams({ normalized_name: normalizedName, event_id: eventId });
    const details = await api(`/api/results/detail?${params.toString()}`);
    
    qs('#dSub').textContent = `Оценки для: ${normalizedName}`;
    
    if (!details.length) {
      qs('#dHead').innerHTML = '';
      qs('#dBody').innerHTML = '<tr><td class="muted">Нет оценок</td></tr>';
      return;
    }
    
    const allCriteria = new Set();
    details.forEach(d => Object.keys(d.scores).forEach(k => allCriteria.add(k)));
    const criteriaList = Array.from(allCriteria);
    
    qs('#dHead').innerHTML = `
      <tr>
        <th>Оценщик</th>
        ${criteriaList.map(k => `<th>${escapeHtml(k)}</th>`).join('')}
        <th>Итого</th>
        <th>Комментарий</th>
        <th>Дата</th>
      </tr>
    `;
    
    qs('#dBody').innerHTML = details.map(d => `
      <tr>
        <td>${escapeHtml(d.rater_full_name)}</td>
        ${criteriaList.map(k => `<td>${d.scores[k] ?? '—'}</td>`).join('')}
        <td><b>${Math.round(d.total_score)}</b></td>
        <td class="muted">${escapeHtml((d.comment || '').slice(0, 30))}</td>
        <td class="muted">${fmtDate(d.created_at)}</td>
      </tr>
    `).join('');
  } catch (e) {
    qs('#dBody').innerHTML = `<tr><td class="muted">Ошибка: ${escapeHtml(e.message)}</td></tr>`;
  }
}

// ==================== ПРОФИЛЬ ====================

async function updateProfile() {
  const status = qs('#profileStatus');
  status.textContent = '...';
  try {
    const full_name = (qs('#editFull')?.value || '').trim();
    const group = normalizeGroupValue(qs('#editGroup'));
    const nickname = (qs('#editNick')?.value || '').trim();

    const body = {};
    if (full_name && full_name !== me.full_name) body.full_name = full_name;
    if (group && group !== me.group) body.group = group;
    if (nickname && nickname !== me.nickname) body.nickname = nickname;

    if (!Object.keys(body).length) {
      status.textContent = 'Без изменений';
      return;
    }

    const res = await api('/api/me', { method: 'PATCH', body });
    if (res.access_token) setToken(res.access_token);
    if (res.user) {
      me = res.user;
      qs('#meLine').textContent = `${me.full_name} · ${me.group} · @${me.nickname}`;
      qs('#pFull').textContent = me.full_name;
      qs('#pGroup').textContent = me.group;
      qs('#pNick').textContent = me.nickname;
    }
    status.textContent = 'Сохранено';
    toast('Профиль обновлён', 'success');
  } catch (e) {
    status.textContent = e.message;
    toast(e.message, 'error');
  }
}

async function changePassword() {
  const status = qs('#passStatus');
  status.textContent = '...';
  try {
    const old_password = qs('#oldPass').value;
    const new_password = qs('#newPass').value;
    await api('/api/me/password', { method: 'POST', body: { old_password, new_password } });
    status.textContent = 'Пароль изменён';
    toast('Пароль изменён!', 'success');
    qs('#oldPass').value = '';
    qs('#newPass').value = '';
  } catch (e) {
    status.textContent = e.message;
    toast(e.message, 'error');
  }
}

// ==================== ПОДТВЕРЖДЕНИЕ ====================

let confirmCallback = null;

function confirmAction(title, text, callback) {
  qs('#confirmTitle').textContent = title;
  qs('#confirmText').textContent = text;
  confirmCallback = callback;
  openModal('confirmModal');
}

// ==================== БИНДИНГИ ====================

function bindUi() {
  // Nav toggle
  initNavToggle();
  const nav = document.getElementById('mainNav');
  nav?.querySelectorAll('button').forEach(el => el.addEventListener('click', () => nav.classList.remove('open')));

  // Tabs
  qsa('button[data-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      showTab(btn.dataset.tab);
      if (btn.dataset.tab === 'results') await loadResults();
      if (btn.dataset.tab === 'eval') {
        await loadCriteria();
        await loadStudents();
      }
    });
  });

  // Logout
  qs('#logout').addEventListener('click', () => {
    clearToken();
    location.href = '/login.html';
  });

  // Event selector on Eval tab
  qs('#evalEvent')?.addEventListener('change', async () => {
    const eventId = +qs('#evalEvent').value;
    currentEvent = events.find(e => e.id === eventId) || null;
    await loadCriteria();
    await loadStudents();
  });

  // Events search
  qs('#eventsSearch')?.addEventListener('input', debounce(renderEventsGrid));

  // Students
  qs('#reloadStudents').addEventListener('click', loadStudents);
  qs('#studentQ').addEventListener('input', debounce(loadStudents));
  qs('#studentGroup').addEventListener('input', debounce(() => {
    normalizeGroupValue(qs('#studentGroup'));
    loadStudents();
  }));

  // External participant
  qs('#openExternalModal').addEventListener('click', () => {
    const name = qs('#externalName').value.trim();
    if (!name) { toast('Введите ФИО участника', 'error'); return; }
    if (!currentEvent) { toast('Нет активного события', 'error'); return; }
    openStudentModal(null, name);
  });

  // Results - searchable event select
  initResultsEventSelect();
  qs('#resultsQ').addEventListener('input', debounce(loadResults));
  qs('#resultsGroup').addEventListener('input', debounce(() => {
    normalizeGroupValue(qs('#resultsGroup'));
    loadResults();
  }));
  qs('#resultsSort').addEventListener('change', loadResults);
  qs('#resultsOrder').addEventListener('change', loadResults);

  // Profile
  qs('#saveProfile').addEventListener('click', updateProfile);
  qs('#changePass').addEventListener('click', changePassword);

  // Modals
  qs('#mClose').addEventListener('click', () => closeModal('studentModal'));
  qs('#mSubmit').addEventListener('click', submitEvaluation);
  qs('#dClose').addEventListener('click', () => closeModal('detailModal'));
  
  // Confirm modal
  qs('#confirmClose').addEventListener('click', () => closeModal('confirmModal'));
  qs('#confirmCancel').addEventListener('click', () => closeModal('confirmModal'));
  qs('#confirmOk').addEventListener('click', async () => {
    closeModal('confirmModal');
    if (confirmCallback) {
      await confirmCallback();
      confirmCallback = null;
    }
  });
}

// ==================== BOOTSTRAP ====================

async function bootstrap() {
  try {
    await loadMe();
  } catch {
    location.href = '/login.html';
    return;
  }
  bindUi();
  await loadEvents();
  await loadCriteria();
  showTab('events');
}

bootstrap();

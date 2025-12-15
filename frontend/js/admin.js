import { api, qs, qsa, openModal, closeModal, escapeHtml, fmtDate, initCommon, initNavToggle, toast } from '/js/common.js';

initCommon();

// ==================== AUTH ====================
const BASIC_KEY = 'sep.admin.basic';
function setBasic(b64) { sessionStorage.setItem(BASIC_KEY, b64); }
function getBasic() { return sessionStorage.getItem(BASIC_KEY) || ''; }
function clearBasic() { sessionStorage.removeItem(BASIC_KEY); }
function b64(user, pass) { return btoa(`${user}:${pass}`); }

async function adminReq(path, opts = {}) {
  return api(path, { ...opts, auth: 'admin', basic: getBasic() });
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ==================== STATE ====================
let events = [];
let currentEventId = null;
let criteria = [];
let users = [];
let evalsViewMode = 'detail'; // 'detail' или 'report'
let criteriaCache = {}; // Cache criteria by event_id
let eventsSearch = '';
let eventsSort = 'id-desc';

// ==================== TABS ====================
function showTab(key) {
  qsa('.tabbtn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  ['events', 'criteria', 'users', 'evals'].forEach(k => {
    const sec = qs(`#tab-${k}`);
    if (sec) sec.style.display = k === key ? '' : 'none';
  });
  
  // Скрываем/показываем глобальную панель выбора события
  const globalBar = qs('#globalEventBar');
  if (globalBar) {
    globalBar.style.display = key === 'events' ? 'none' : '';
  }
}

function requireEvent() {
  if (!currentEventId) {
    toast('Сначала выберите событие', 'error');
    return false;
  }
  return true;
}

// ==================== СОБЫТИЯ ====================
async function loadEvents() {
  const status = qs('#eventsStatus');
  status.textContent = '...';
  try {
    events = await adminReq('/api/admin/events');
    renderEventsTable();
    updateGlobalEventSelect();
    status.textContent = `Всего: ${events.length}`;
    qs('#globalEventStatus').textContent = '';
  } catch (e) {
    status.textContent = e.message;
  }
}

function renderEventsTable() {
  const body = qs('#eventsBody');
  
  // Фильтрация по поиску
  let filtered = events;
  if (eventsSearch) {
    const q = eventsSearch.toLowerCase();
    filtered = events.filter(e => 
      e.name.toLowerCase().includes(q) || 
      (e.description || '').toLowerCase().includes(q)
    );
  }
  
  // Сортировка
  filtered = [...filtered].sort((a, b) => {
    switch(eventsSort) {
      case 'id-asc': return a.id - b.id;
      case 'id-desc': return b.id - a.id;
      case 'name-asc': return a.name.localeCompare(b.name, 'ru');
      case 'name-desc': return b.name.localeCompare(a.name, 'ru');
      default: return b.id - a.id;
    }
  });
  
  body.innerHTML = filtered.map(e => `
    <tr>
      <td>${e.id}</td>
      <td>${escapeHtml(e.name)}</td>
      <td class="muted">${escapeHtml((e.description || '').slice(0, 40))}</td>
      <td>${e.is_active ? '✅' : '❌'}</td>
      <td class="muted">${e.participants_count ?? '—'}</td>
      <td class="muted">${fmtDate(e.created_at)}</td>
      <td>
        <button class="btn" data-crit="${e.id}" title="Критерии">📋</button>
        <button class="btn" data-edit="${e.id}" title="Редактировать">✏️</button>
        <button class="btn danger" data-del="${e.id}" title="Удалить">🗑</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="muted">Нет событий</td></tr>';
  
  // Кнопка критериев - переход на вкладку критериев с выбранным событием
  qsa('button[data-crit]', body).forEach(btn => btn.addEventListener('click', () => {
    const eventId = +btn.dataset.crit;
    selectEvent(eventId);
    showTab('criteria');
    qs('.tabbtn[data-tab="criteria"]').click();
  }));
  qsa('button[data-edit]', body).forEach(btn => btn.addEventListener('click', () => openEventModal(+btn.dataset.edit)));
  qsa('button[data-del]', body).forEach(btn => btn.addEventListener('click', () => deleteEvent(+btn.dataset.del)));
}

function updateGlobalEventSelect() {
  const input = qs('#globalEventSearch');
  const hidden = qs('#globalEvent');
  const dropdown = qs('#eventDropdown');
  const prev = currentEventId;
  
  // Заполняем dropdown
  renderEventDropdown('');
  
  // Восстанавливаем выбранное значение
  if (prev && events.some(e => e.id === prev)) {
    const evt = events.find(e => e.id === prev);
    hidden.value = prev;
    input.value = evt.name;
    input.classList.add('has-value');
  } else if (events.length === 1) {
    hidden.value = events[0].id;
    input.value = events[0].name;
    input.classList.add('has-value');
    currentEventId = events[0].id;
  } else {
    input.value = '';
    input.classList.remove('has-value');
  }
}

function renderEventDropdown(filter) {
  const dropdown = qs('#eventDropdown');
  const hidden = qs('#globalEvent');
  const currentVal = +hidden.value || null;
  
  const filtered = events.filter(e => 
    !filter || e.name.toLowerCase().includes(filter.toLowerCase())
  );
  
  if (filtered.length === 0) {
    dropdown.innerHTML = '<div class="searchable-no-results">Ничего не найдено</div>';
    return;
  }
  
  dropdown.innerHTML = filtered.map(e => `
    <div class="searchable-option${e.id === currentVal ? ' selected' : ''}" data-id="${e.id}">
      ${escapeHtml(e.name)}${e.is_active ? '' : '<span class="option-badge">неактивно</span>'}
    </div>
  `).join('');
  
  // Клики по опциям
  qsa('.searchable-option', dropdown).forEach(opt => {
    opt.addEventListener('click', () => selectEvent(+opt.dataset.id));
  });
}

function selectEvent(eventId) {
  const input = qs('#globalEventSearch');
  const hidden = qs('#globalEvent');
  const dropdown = qs('#eventDropdown');
  
  const evt = events.find(e => e.id === eventId);
  if (evt) {
    hidden.value = eventId;
    input.value = evt.name;
    input.classList.add('has-value');
    currentEventId = eventId;
    dropdown.classList.remove('open');
    
    // Обновляем данные на текущей вкладке
    const activeTab = qs('.tabbtn.active[data-tab]')?.dataset.tab;
    if (activeTab === 'criteria') loadCriteria();
    if (activeTab === 'evals') loadEvals();
  }
}

function initSearchableEventSelect() {
  const input = qs('#globalEventSearch');
  const dropdown = qs('#eventDropdown');
  const hidden = qs('#globalEvent');
  
  if (!input || !dropdown) return;
  
  let savedValue = '';
  
  // Открытие при фокусе - очищаем ввод для удобного поиска
  input.addEventListener('focus', () => {
    savedValue = input.value;
    if (input.value) {
      input.value = '';
      input.classList.remove('has-value');
    }
    renderEventDropdown('');
    dropdown.classList.add('open');
  });
  
  // Фильтрация при вводе
  input.addEventListener('input', () => {
    renderEventDropdown(input.value);
    dropdown.classList.add('open');
  });
  
  // При потере фокуса - восстанавливаем если ничего не выбрано
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!input.value && savedValue && currentEventId) {
        const evt = events.find(e => e.id === currentEventId);
        if (evt) {
          input.value = evt.name;
          input.classList.add('has-value');
        }
      }
    }, 200);
  });
  
  // Закрытие при клике вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-select')) {
      dropdown.classList.remove('open');
      // Восстанавливаем значение если пусто
      if (!input.value && currentEventId) {
        const evt = events.find(e => e.id === currentEventId);
        if (evt) {
          input.value = evt.name;
          input.classList.add('has-value');
        }
      }
    }
  });
  
  // Навигация клавишами
  input.addEventListener('keydown', (e) => {
    const opts = qsa('.searchable-option', dropdown);
    const highlighted = qs('.searchable-option.highlighted', dropdown);
    let idx = Array.from(opts).indexOf(highlighted);
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < opts.length - 1) idx++;
      else idx = 0;
      opts.forEach((o, i) => o.classList.toggle('highlighted', i === idx));
      opts[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) idx--;
      else idx = opts.length - 1;
      opts.forEach((o, i) => o.classList.toggle('highlighted', i === idx));
      opts[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const toSelect = highlighted || opts[0];
      if (toSelect) selectEvent(+toSelect.dataset.id);
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('open');
      input.blur();
    }
  });
}

let editingEventId = null;

function openEventModal(id = null) {
  editingEventId = id;
  qs('#eTitle').textContent = id ? '📅 Редактировать событие' : '📅 Новое событие';
  qs('#eStatus').textContent = '';
  
  if (id) {
    const e = events.find(x => x.id === id);
    qs('#eName').value = e?.name || '';
    qs('#eDesc').value = e?.description || '';
    qs('#eActive').checked = e?.is_active ?? true;
  } else {
    qs('#eName').value = '';
    qs('#eDesc').value = '';
    qs('#eActive').checked = true;
  }
  openModal('eventModal');
}

async function saveEvent() {
  const status = qs('#eStatus');
  status.textContent = '...';
  try {
    const body = {
      name: qs('#eName').value.trim(),
      description: qs('#eDesc').value.trim(),
      is_active: qs('#eActive').checked
    };
    if (!body.name) throw new Error('Название обязательно');
    
    if (editingEventId) {
      await adminReq(`/api/admin/events/${editingEventId}`, { method: 'PATCH', body });
    } else {
      await adminReq('/api/admin/events', { method: 'POST', body });
    }
    closeModal('eventModal');
    toast('Сохранено!', 'success');
    await loadEvents();
  } catch (e) {
    status.textContent = e.message;
  }
}

async function deleteEvent(id) {
  if (!confirm('Удалить событие? Все связанные критерии и оценки будут удалены!')) return;
  try {
    await adminReq(`/api/admin/events/${id}`, { method: 'DELETE' });
    toast('Удалено', 'success');
    if (currentEventId === id) currentEventId = null;
    await loadEvents();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ==================== КРИТЕРИИ ====================
async function loadCriteria() {
  if (!requireEvent()) {
    qs('#critBody').innerHTML = '<tr><td colspan="6" class="muted">Выберите событие</td></tr>';
    return;
  }
  
  const status = qs('#critStatus');
  status.textContent = '...';
  try {
    criteria = await adminReq(`/api/admin/criteria?event_id=${currentEventId}`);
    renderCriteriaTable();
    status.textContent = `Всего: ${criteria.length}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

function renderCriteriaTable() {
  const body = qs('#critBody');
  body.innerHTML = criteria.map(c => `
    <tr>
      <td>${c.id}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${Math.floor(c.max_score)}</td>
      <td class="muted">${escapeHtml((c.description || '').slice(0, 40))}</td>
      <td>${c.active ? '✅' : '❌'}</td>
      <td>
        <button class="btn" data-edit="${c.id}">✏️</button>
        <button class="btn danger" data-del="${c.id}">🗑</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="muted">Нет критериев</td></tr>';
  
  qsa('button[data-edit]', body).forEach(btn => btn.addEventListener('click', () => openCritModal(+btn.dataset.edit)));
  qsa('button[data-del]', body).forEach(btn => btn.addEventListener('click', () => deleteCrit(+btn.dataset.del)));
}

let editingCritId = null;

function openCritModal(id = null) {
  if (!requireEvent()) return;
  editingCritId = id;
  qs('#cTitle').textContent = id ? 'Редактировать критерий' : 'Новый критерий';
  qs('#cStatus').textContent = '';
  
  if (id) {
    const c = criteria.find(x => x.id === id);
    qs('#cName').value = c?.name || '';
    qs('#cMax').value = c ? Math.floor(c.max_score) : 10;
    qs('#cDesc').value = c?.description || '';
    qs('#cActive').checked = c?.active ?? true;
  } else {
    qs('#cName').value = '';
    qs('#cMax').value = 10;
    qs('#cDesc').value = '';
    qs('#cActive').checked = true;
  }
  openModal('critModal');
}

async function saveCrit() {
  const status = qs('#cStatus');
  status.textContent = '...';
  try {
    const body = {
      event_id: currentEventId,
      name: qs('#cName').value.trim(),
      max_score: +qs('#cMax').value,
      description: qs('#cDesc').value.trim(),
      active: qs('#cActive').checked
    };
    if (!body.name) throw new Error('Название обязательно');
    if (!body.max_score || body.max_score < 1) throw new Error('Макс.балл >= 1');
    
    if (editingCritId) {
      await adminReq(`/api/admin/criteria/${editingCritId}`, { method: 'PATCH', body });
    } else {
      await adminReq('/api/admin/criteria', { method: 'POST', body });
    }
    invalidateCriteriaCache(currentEventId);
    closeModal('critModal');
    toast('Сохранено!', 'success');
    await loadCriteria();
  } catch (e) {
    status.textContent = e.message;
  }
}

async function deleteCrit(id) {
  if (!confirm('Удалить критерий?')) return;
  try {
    await adminReq(`/api/admin/criteria/${id}`, { method: 'DELETE' });
    invalidateCriteriaCache(currentEventId);
    toast('Удалено', 'success');
    await loadCriteria();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ==================== ПОЛЬЗОВАТЕЛИ ====================
async function loadUsers() {
  const status = qs('#usersStatus');
  status.textContent = '...';
  try {
    const q = qs('#userQ').value.trim();
    const group = qs('#userGroup').value.replace(/\s+/g, '');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (group) params.set('group', group);
    
    const res = await adminReq(`/api/admin/users?${params.toString()}`);
    users = res.items || [];
    renderUsersTable();
    status.textContent = `Всего: ${res.total}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

function renderUsersTable() {
  const body = qs('#usersBody');
  body.innerHTML = users.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${escapeHtml(u.full_name)}</td>
      <td>${escapeHtml(u.group)}</td>
      <td>@${escapeHtml(u.nickname)}</td>
      <td>${u.is_active ? '✅' : '❌'}</td>
      <td>
        <button class="btn" data-edit="${u.id}">✏️</button>
        <button class="btn" data-reset="${u.id}">🔑</button>
        <button class="btn danger" data-del="${u.id}">🗑</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="muted">Нет пользователей</td></tr>';
  
  qsa('button[data-edit]', body).forEach(btn => btn.addEventListener('click', () => openUserModal(+btn.dataset.edit)));
  qsa('button[data-reset]', body).forEach(btn => btn.addEventListener('click', () => resetPassword(+btn.dataset.reset)));
  qsa('button[data-del]', body).forEach(btn => btn.addEventListener('click', () => deleteUser(+btn.dataset.del)));
}

let editingUserId = null;

function openUserModal(id = null) {
  editingUserId = id;
  
  if (id) {
    const u = users.find(x => x.id === id);
    qs('#uTitle').textContent = '👤 Редактировать пользователя';
    qs('#uFull').value = u?.full_name || '';
    qs('#uGrp').value = u?.group || '';
    qs('#uNick').value = u?.nickname || '';
    qs('#uActive').checked = u?.is_active ?? true;
    qs('#uPassGroup').style.display = 'none';
    qs('#uResetPass').style.display = '';
  } else {
    qs('#uTitle').textContent = '👤 Новый пользователь';
    qs('#uFull').value = '';
    qs('#uGrp').value = '';
    qs('#uNick').value = '';
    qs('#uPass').value = '';
    qs('#uActive').checked = true;
    qs('#uPassGroup').style.display = '';
    qs('#uResetPass').style.display = 'none';
  }
  qs('#uStatus').textContent = '';
  openModal('userModal');
}

async function saveUser() {
  const status = qs('#uStatus');
  status.textContent = '...';
  try {
    const body = {
      full_name: qs('#uFull').value.trim(),
      group: qs('#uGrp').value.replace(/\s+/g, ''),
      nickname: qs('#uNick').value.trim(),
      is_active: qs('#uActive').checked
    };
    
    if (!body.full_name) throw new Error('ФИО обязательно');
    if (!body.nickname) throw new Error('Никнейм обязателен');
    
    if (editingUserId) {
      await adminReq(`/api/admin/users/${editingUserId}`, { method: 'PATCH', body });
    } else {
      body.password = qs('#uPass').value;
      if (!body.password || body.password.length < 6) throw new Error('Пароль минимум 6 символов');
      await adminReq('/api/admin/users', { method: 'POST', body });
    }
    closeModal('userModal');
    toast('Сохранено!', 'success');
    await loadUsers();
  } catch (e) {
    status.textContent = e.message;
  }
}

async function resetPassword(id) {
  const np = prompt('Введите новый пароль (мин. 6 символов):');
  if (!np || np.length < 6) {
    if (np) toast('Пароль должен быть минимум 6 символов', 'error');
    return;
  }
  try {
    await adminReq(`/api/admin/users/${id}/reset-password?new_password=${encodeURIComponent(np)}`, { method: 'POST' });
    toast('Пароль сброшен', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Удалить пользователя?')) return;
  try {
    await adminReq(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast('Удалено', 'success');
    await loadUsers();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ==================== ОЦЕНКИ ====================

// Получение критериев с кэшированием
async function getCachedCriteria(eventId) {
  if (!criteriaCache[eventId]) {
    criteriaCache[eventId] = await adminReq(`/api/admin/criteria?event_id=${eventId}`);
  }
  return criteriaCache[eventId];
}

// Очистка кэша критериев при изменении
function invalidateCriteriaCache(eventId) {
  if (eventId) {
    delete criteriaCache[eventId];
  } else {
    criteriaCache = {};
  }
}

async function loadEvals() {
  if (!requireEvent()) {
    qs('#evalsHead').innerHTML = '';
    qs('#evalsBody').innerHTML = '<tr><td class="muted">Выберите событие</td></tr>';
    return;
  }
  
  const status = qs('#evalsStatus');
  status.textContent = '...';
  
  try {
    const q = qs('#evalQ').value.trim().toLowerCase();
    const groupFilter = qs('#evalGroup').value.trim().toLowerCase();
    const params = new URLSearchParams();
    params.set('event_id', currentEventId);
    
    // Загружаем параллельно
    const [evals, eventCriteria] = await Promise.all([
      adminReq(`/api/admin/evaluations?${params.toString()}`),
      getCachedCriteria(currentEventId)
    ]);
    
    // Фильтрация по поиску и группе
    let filtered = evals;
    if (q) {
      filtered = filtered.filter(e => {
        const targetName = e.target_full_name || e.target_name || '';
        const raterName = e.rater_full_name || '';
        return targetName.toLowerCase().includes(q) || raterName.toLowerCase().includes(q);
      });
    }
    if (groupFilter) {
      filtered = filtered.filter(e => {
        const group = (e.target_group || '').toLowerCase();
        return group.includes(groupFilter);
      });
    }
    
    if (evalsViewMode === 'report') {
      renderEvalsReport(filtered, eventCriteria, status, groupFilter);
    } else {
      renderEvalsDetail(filtered, eventCriteria, status);
    }
  } catch (e) {
    status.textContent = e.message;
    qs('#evalsBody').innerHTML = `<tr><td class="muted">Ошибка: ${escapeHtml(e.message)}</td></tr>`;
  }
}

// Детальный режим - каждая оценка отдельно
function renderEvalsDetail(filtered, eventCriteria, status) {
  qs('#evalsHead').innerHTML = `
    <tr>
      <th>Оцениваемый</th>
      <th>Оценщик</th>
      ${eventCriteria.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}
      <th>Комментарий</th>
      <th>Дата</th>
      <th></th>
    </tr>
  `;
  
  qs('#evalsBody').innerHTML = filtered.map(e => {
    const scoreMap = {};
    (e.scores || []).forEach(s => { scoreMap[s.criterion_id] = s.score; });
    
    const targetName = e.target_full_name || e.target_name || '—';
    const raterName = e.rater_full_name || '—';
    
    // Убираем "Оценка от ..." из комментария
    let comment = (e.comment || '').slice(0, 30);
    if (comment.startsWith('Оценка от ') || comment.startsWith('(seed)')) {
      comment = '';
    }
    
    return `
      <tr>
        <td>${escapeHtml(targetName)}</td>
        <td>${escapeHtml(raterName)}</td>
        ${eventCriteria.map(c => {
          const v = scoreMap[c.id];
          return `<td>${v !== undefined ? Math.round(v) : '—'}</td>`;
        }).join('')}
        <td class="muted">${escapeHtml(comment)}</td>
        <td class="muted">${fmtDate(e.created_at)}</td>
        <td><button class="btn danger" data-deleval="${e.id}">🗑</button></td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="${eventCriteria.length + 5}" class="muted">Нет оценок</td></tr>`;
  
  qsa('button[data-deleval]', qs('#evalsBody')).forEach(btn => {
    btn.addEventListener('click', () => deleteEval(+btn.dataset.deleval));
  });
  
  status.textContent = `Всего: ${filtered.length}`;
}

// Режим отчёта - агрегированные данные по участникам
function renderEvalsReport(evals, eventCriteria, status, groupFilter = '') {
  // Группируем оценки по оцениваемому (target)
  const byTarget = {};
  
  evals.forEach(e => {
    const targetId = e.target_user_id || e.target_name || 'external';
    const targetName = e.target_full_name || e.target_name || 'Внешний';
    const targetGroup = e.target_group || '—';
    
    if (!byTarget[targetId]) {
      byTarget[targetId] = {
        name: targetName,
        group: targetGroup,
        scores: {}, // criterion_id -> [scores]
        raters: new Set(),
        evalIds: []
      };
    }
    
    byTarget[targetId].raters.add(e.rater_user_id || e.id);
    byTarget[targetId].evalIds.push(e.id);
    
    (e.scores || []).forEach(s => {
      if (!byTarget[targetId].scores[s.criterion_id]) {
        byTarget[targetId].scores[s.criterion_id] = [];
      }
      byTarget[targetId].scores[s.criterion_id].push(s.score);
    });
  });
  
  // Вычисляем средние
  const report = Object.entries(byTarget).map(([id, data]) => {
    const avgScores = {};
    let totalSum = 0;
    let totalCount = 0;
    let maxPossible = 0;
    
    eventCriteria.forEach(c => {
      const scores = data.scores[c.id] || [];
      if (scores.length > 0) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        avgScores[c.id] = avg;
        totalSum += avg;
        totalCount++;
        maxPossible += c.max_score;
      }
    });
    
    // Общая средняя оценка (в процентах от максимума)
    const overallPercent = maxPossible > 0 ? (totalSum / maxPossible) * 100 : 0;
    
    return {
      id,
      name: data.name,
      group: data.group,
      avgScores,
      ratersCount: data.raters.size,
      overallPercent,
      evalIds: data.evalIds
    };
  });
  
  // Сортируем по средней оценке (убывание)
  report.sort((a, b) => b.overallPercent - a.overallPercent);
  
  // Определяем цвет по проценту
  function getScoreClass(percent) {
    if (percent >= 90) return 'score-90';
    if (percent >= 85) return 'score-85';
    if (percent >= 75) return 'score-75';
    if (percent >= 70) return 'score-70';
    if (percent >= 65) return 'score-65';
    if (percent >= 60) return 'score-60';
    return 'score-bad';
  }
  
  qs('#evalsHead').innerHTML = `
    <tr>
      <th>#</th>
      <th>Участник</th>
      <th>Группа</th>
      ${eventCriteria.map(c => `<th title="${escapeHtml(c.name)} (макс. ${c.max_score})">${escapeHtml(c.name.slice(0, 15))}</th>`).join('')}
      <th>Средняя %</th>
      <th>Оценщиков</th>
      <th></th>
    </tr>
  `;
  
  qs('#evalsBody').innerHTML = report.map((r, idx) => {
    const scoreClass = getScoreClass(r.overallPercent);
    
    return `
      <tr>
        <td class="muted">${idx + 1}</td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td class="muted">${escapeHtml(r.group)}</td>
        ${eventCriteria.map(c => {
          const v = r.avgScores[c.id];
          if (v === undefined) return '<td class="muted">—</td>';
          const cellPercent = (v / c.max_score) * 100;
          const cellClass = getScoreClass(cellPercent);
          return `<td class="${cellClass}">${v.toFixed(1)}</td>`;
        }).join('')}
        <td class="${scoreClass}"><strong>${r.overallPercent.toFixed(1)}%</strong></td>
        <td class="muted">${r.ratersCount}</td>
        <td><button class="btn" data-details="${r.id}" title="Подробнее">🔍</button></td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="${eventCriteria.length + 6}" class="muted">Нет данных</td></tr>`;
  
  // Кнопка подробнее - переключаем в детальный режим с фильтром по имени
  qsa('button[data-details]', qs('#evalsBody')).forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.details;
      const targetData = report.find(r => r.id === targetId);
      if (targetData) {
        // Устанавливаем фильтр по имени и переключаем в детальный режим
        qs('#evalQ').value = targetData.name;
        evalsViewMode = 'detail';
        qsa('.view-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'detail'));
        loadEvals();
      }
    });
  });
  
  status.textContent = `Участников: ${report.length}, оценок: ${evals.length}`;
}

async function deleteEval(id) {
  if (!confirm('Удалить оценку?')) return;
  try {
    await adminReq(`/api/admin/evaluations/${id}`, { method: 'DELETE' });
    toast('Удалено', 'success');
    await loadEvals();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function purgeAllEvals() {
  if (!requireEvent()) return;
  if (!confirm('Удалить ВСЕ оценки для этого события? Это действие необратимо!')) return;
  
  try {
    await adminReq(`/api/admin/evaluations?event_id=${currentEventId}`, { method: 'DELETE' });
    toast('Все оценки удалены', 'success');
    await loadEvals();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function exportExcel() {
  if (!requireEvent()) return;
  try {
    const params = new URLSearchParams({ event_id: currentEventId });
    
    // Параллельная загрузка
    const [evals, eventCriteria] = await Promise.all([
      adminReq(`/api/admin/evaluations?${params.toString()}`),
      getCachedCriteria(currentEventId)
    ]);
    
    if (!evals.length) {
      toast('Нет данных для экспорта', 'error');
      return;
    }
    
    let csvContent;
    const BOM = '\uFEFF';
    
    if (evalsViewMode === 'report') {
      // Экспорт в режиме отчёта (агрегированные данные)
      const byTarget = {};
      evals.forEach(e => {
        const targetId = e.target_user_id || e.target_name || 'external';
        const targetName = e.target_full_name || e.target_name || 'Внешний';
        const targetGroup = e.target_group || '—';
        
        if (!byTarget[targetId]) {
          byTarget[targetId] = { name: targetName, group: targetGroup, scores: {}, raters: new Set() };
        }
        byTarget[targetId].raters.add(e.rater_user_id || e.id);
        (e.scores || []).forEach(s => {
          if (!byTarget[targetId].scores[s.criterion_id]) byTarget[targetId].scores[s.criterion_id] = [];
          byTarget[targetId].scores[s.criterion_id].push(s.score);
        });
      });
      
      const headers = ['#', 'Участник', 'Группа', ...eventCriteria.map(c => c.name), 'Средняя %', 'Оценщиков'];
      const rows = Object.values(byTarget).map((data, idx) => {
        const avgScores = {};
        let totalSum = 0, maxPossible = 0;
        eventCriteria.forEach(c => {
          const scores = data.scores[c.id] || [];
          if (scores.length) {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            avgScores[c.id] = avg;
            totalSum += avg;
            maxPossible += c.max_score;
          }
        });
        const overallPercent = maxPossible > 0 ? (totalSum / maxPossible) * 100 : 0;
        
        return [
          idx + 1, data.name, data.group,
          ...eventCriteria.map(c => avgScores[c.id] !== undefined ? avgScores[c.id].toFixed(1) : ''),
          overallPercent.toFixed(1) + '%', data.raters.size
        ];
      });
      
      csvContent = BOM + [headers.join(';'), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))].join('\n');
    } else {
      // Экспорт детально
      const headers = ['Оцениваемый', 'Группа', 'Оценщик', ...eventCriteria.map(c => c.name), 'Комментарий', 'Дата'];
      const rows = evals.map(e => {
        const scoreMap = {};
        (e.scores || []).forEach(s => { scoreMap[s.criterion_id] = s.score; });
        
        return [
          e.target_full_name || e.target_name || '—',
          e.target_group || '—',
          e.rater_full_name || '—',
          ...eventCriteria.map(c => scoreMap[c.id] !== undefined ? Math.round(scoreMap[c.id]) : ''),
          e.comment || '',
          new Date(e.created_at).toLocaleString('ru-RU')
        ];
      });
      
      csvContent = BOM + [headers.join(';'), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))].join('\n');
    }
    
    const filename = evalsViewMode === 'report' 
      ? `отчёт_событие_${currentEventId}.xls` 
      : `оценки_событие_${currentEventId}.xls`;
    
    const blob = new Blob([csvContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    toast('Экспорт завершён', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ==================== БИНДИНГИ ====================
function bindUi() {
  // Nav toggle (инициализируем здесь после показа adminApp)
  initNavToggle();
  const nav = document.getElementById('adminNav');
  nav?.querySelectorAll('button').forEach(el => el.addEventListener('click', () => nav.classList.remove('open')));

  // Tabs
  qsa('button[data-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      showTab(btn.dataset.tab);
      if (btn.dataset.tab === 'events') await loadEvents();
      if (btn.dataset.tab === 'criteria') await loadCriteria();
      if (btn.dataset.tab === 'users') await loadUsers();
      if (btn.dataset.tab === 'evals') await loadEvals();
    });
  });

  // Инициализация searchable dropdown для событий
  initSearchableEventSelect();

  // Logout
  qs('#logout').addEventListener('click', () => {
    clearBasic();
    location.reload();
  });

  // События - поиск и сортировка
  qs('#eventQ')?.addEventListener('input', debounce(() => {
    eventsSearch = qs('#eventQ').value.trim();
    renderEventsTable();
  }));
  qs('#eventSort')?.addEventListener('change', () => {
    eventsSort = qs('#eventSort').value;
    renderEventsTable();
  });
  qs('#addEvent').addEventListener('click', () => openEventModal());
  qs('#eSave').addEventListener('click', saveEvent);
  qs('#eClose').addEventListener('click', () => closeModal('eventModal'));
  qs('#eCancel').addEventListener('click', () => closeModal('eventModal'));

  // Критерии
  qs('#addCrit').addEventListener('click', () => openCritModal());
  qs('#cSave').addEventListener('click', saveCrit);
  qs('#cClose').addEventListener('click', () => closeModal('critModal'));
  qs('#cCancel').addEventListener('click', () => closeModal('critModal'));

  // Пользователи
  qs('#userQ').addEventListener('input', debounce(loadUsers));
  qs('#userGroup').addEventListener('input', debounce(loadUsers));
  qs('#reloadUsers').addEventListener('click', loadUsers);
  qs('#addUser').addEventListener('click', () => openUserModal());
  qs('#uSave').addEventListener('click', saveUser);
  qs('#uClose').addEventListener('click', () => closeModal('userModal'));
  qs('#uCancel').addEventListener('click', () => closeModal('userModal'));
  qs('#uResetPass').addEventListener('click', () => {
    if (editingUserId) resetPassword(editingUserId);
  });

  // Оценки
  qs('#evalQ').addEventListener('input', debounce(loadEvals));
  qs('#evalGroup')?.addEventListener('input', debounce(loadEvals));
  qs('#reloadEvals').addEventListener('click', loadEvals);
  qs('#exportExcel').addEventListener('click', exportExcel);
  qs('#purgeEvals').addEventListener('click', purgeAllEvals);
  
  // Переключение режимов отображения оценок
  qsa('.view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.view-btn[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      evalsViewMode = btn.dataset.view;
      loadEvals();
    });
  });
}

// ==================== AUTH ====================
function bindAuth() {
  qs('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = qs('#authStatus');
    status.textContent = 'Вход...';
    
    const login = qs('#aLogin').value.trim();
    const pass = qs('#aPass').value;
    
    try {
      setBasic(b64(login, pass));
      // Проверяем авторизацию
      await adminReq('/api/admin/users');
      
      qs('#authPanel').style.display = 'none';
      qs('#adminApp').style.display = '';
      status.textContent = '';
      toast('Добро пожаловать!', 'success');
      
      await loadEvents();
      showTab('events');
    } catch (err) {
      clearBasic();
      status.textContent = err.message;
      toast(err.message, 'error');
    }
  });
}

function tryRestoreSession() {
  const b = getBasic();
  if (!b) return false;
  
  // Пробуем восстановить сессию
  adminReq('/api/admin/users')
    .then(() => {
      qs('#authPanel').style.display = 'none';
      qs('#adminApp').style.display = '';
      loadEvents();
      showTab('events');
    })
    .catch(() => {
      clearBasic();
    });
  
  return !!b;
}

// ==================== BOOTSTRAP ====================
bindAuth();
bindUi();
tryRestoreSession();

// Password toggle для формы авторизации
const toggleAdminPass = qs('#toggleAdminPass');
const aPassInput = qs('#aPass');
if (toggleAdminPass && aPassInput) {
  toggleAdminPass.addEventListener('click', () => {
    const isPassword = aPassInput.type === 'password';
    aPassInput.type = isPassword ? 'text' : 'password';
    toggleAdminPass.textContent = isPassword ? '◉' : '○';
  });
}

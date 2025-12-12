import { api, qs, qsa, openModal, closeModal, escapeHtml, fmtDate, initCommon, toast } from '/js/common.js';

// Initialize theme, nav toggle, etc.
initCommon();

const BASIC_KEY = 'sep.admin.basic';

function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function setupNoAutofill(inputEl) {
  if (!inputEl) return;
  inputEl.readOnly = true;
  inputEl.addEventListener('focus', () => { inputEl.readOnly = false; }, { once: true });
  setTimeout(() => { if (inputEl.readOnly) inputEl.value = ''; }, 0);
}

function setBasic(b64) { sessionStorage.setItem(BASIC_KEY, b64); }
function getBasic() { return sessionStorage.getItem(BASIC_KEY) || ''; }
function clearBasic() { sessionStorage.removeItem(BASIC_KEY); }
function b64(user, pass) { return btoa(`${user}:${pass}`); }

function showAdminTab(key) {
  qsa('button[data-atab]').forEach(b => b.classList.toggle('active', b.dataset.atab === key));
  qs('#a-users').style.display = key === 'users' ? '' : 'none';
  qs('#a-criteria').style.display = key === 'criteria' ? '' : 'none';
  qs('#a-evals').style.display = key === 'evals' ? '' : 'none';
  qs('#a-audit').style.display = key === 'audit' ? '' : 'none';
}

async function adminReq(path, opts = {}) {
  return api(path, { ...opts, auth: 'admin', basic: getBasic() });
}

function modal(title, html) {
  qs('#amTitle').textContent = title;
  qs('#amBody').innerHTML = html;
  openModal('adminModal');
}

function bindModalClose() {
  qs('#amClose').addEventListener('click', () => closeModal('adminModal'));
}

let usersCache = [];
let criteriaCache = [];

function parseInputId(val) {
  const num = parseInt((val || '').split(/\s+/)[0], 10);
  return Number.isNaN(num) ? null : num;
}

function userOption(u) {
  return `<option value="${u.id} · ${escapeHtml(u.full_name)} (@${escapeHtml(u.nickname)})"></option>`;
}

async function loadUsers() {
  const status = qs('#uStatus');
  status.textContent = '...';
  try {
    const params = new URLSearchParams();
    const q = qs('#uQ').value.trim();
    const group = qs('#uGroup').value.trim();
    if (q) params.set('q', q);
    if (group) params.set('group', group);

    const res = await adminReq(`/api/admin/users?${params.toString()}`);
    usersCache = res.items || [];

    const body = qs('#uBody');
    body.innerHTML = usersCache.map(u => `
      <tr>
        <td>${u.id}</td>
        <td><span class="inline" data-u="nick" data-id="${u.id}">${escapeHtml(u.nickname)}</span></td>
        <td><span class="inline" data-u="full" data-id="${u.id}">${escapeHtml(u.full_name)}</span></td>
        <td><span class="inline" data-u="group" data-id="${u.id}">${escapeHtml(u.group)}</span></td>
        <td><input type="checkbox" data-u="active" data-id="${u.id}" ${u.is_active ? 'checked' : ''} /></td>
        <td>
          <button class="btn" data-reset="${u.id}">Сброс пароля</button>
          <button class="btn danger" data-del="${u.id}">Удалить</button>
        </td>
      </tr>
    `).join('');

    qsa('span.inline', body).forEach(el => el.addEventListener('click', () => startInlineUserEdit(el)));
    qsa('input[type="checkbox"][data-u="active"]', body).forEach(el => el.addEventListener('change', () => patchUser(el.dataset.id, { is_active: el.checked })));
    qsa('button[data-reset]', body).forEach(btn => btn.addEventListener('click', () => resetPassword(btn.dataset.reset)));
    qsa('button[data-del]', body).forEach(btn => btn.addEventListener('click', () => deleteUser(btn.dataset.del)));

    await fillUserSelects();
    status.textContent = `Пользователей: ${res.total}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

function startInlineUserEdit(span) {
  const field = span.dataset.u;
  const id = span.dataset.id;
  const old = span.textContent;
  span.classList.add('editing');
  span.innerHTML = `<input style="width:100%" value="${escapeHtml(old)}" />`;
  const inp = span.querySelector('input');
  inp.focus();
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') inp.blur();
    if (ev.key === 'Escape') { span.textContent = old; span.classList.remove('editing'); }
  });
  inp.addEventListener('blur', async () => {
    const val = inp.value.trim();
    span.classList.remove('editing');
    span.textContent = val;
    const patch = {};
    if (field === 'nick') patch.nickname = val;
    if (field === 'full') patch.full_name = val;
    if (field === 'group') patch.group = val;
    await patchUser(id, patch);
  });
}

async function patchUser(id, patch) {
  try { await adminReq(`/api/admin/users/${id}`, { method: 'PATCH', body: patch }); }
  catch (e) { alert(e.message); }
}

async function resetPassword(id) {
  const np = prompt('Новый пароль (мин 6 символов):');
  if (!np) return;
  try {
    await adminReq(`/api/admin/users/${id}/reset-password?new_password=${encodeURIComponent(np)}`, { method: 'POST' });
    alert('Пароль сброшен');
  } catch (e) { alert(e.message); }
}

async function deleteUser(id) {
  if (!confirm('Удалить пользователя?')) return;
  try {
    await adminReq(`/api/admin/users/${id}`, { method: 'DELETE' });
    await loadUsers();
  } catch (e) { alert(e.message); }
}

async function fillUserSelects() {
  const targetList = qs('#eTargetList');
  const raterList = qs('#eRaterList');
  const options = usersCache.map(userOption).join('');
  targetList.innerHTML = options;
  raterList.innerHTML = options;
}

async function loadCriteria() {
  const status = qs('#cStatus');
  status.textContent = '...';
  try {
    const items = await adminReq('/api/admin/criteria');
    criteriaCache = items;

    qs('#cBody').innerHTML = items.map(c => `
      <tr>
        <td>${c.id}</td>
        <td><span class="inline" data-c="name" data-id="${c.id}">${escapeHtml(c.name)}</span></td>
        <td><span class="inline" data-c="desc" data-id="${c.id}">${escapeHtml(c.description || '')}</span></td>
        <td><span class="inline" data-c="max" data-id="${c.id}">${Number(c.max_score).toFixed(2)}</span></td>
        <td><input type="checkbox" data-c="active" data-id="${c.id}" ${c.active ? 'checked' : ''} /></td>
        <td>
          <button class="btn" data-cedit="${c.id}">Редактировать</button>
          <button class="btn danger" data-cdel="${c.id}">Удалить</button>
        </td>
      </tr>
    `).join('');

    qsa('span.inline[data-c]', qs('#cBody')).forEach(el => el.addEventListener('click', () => startInlineCriterionEdit(el)));
    qsa('input[type="checkbox"][data-c="active"]', qs('#cBody')).forEach(el => el.addEventListener('change', () => patchCriterion(el.dataset.id, { active: el.checked })));
    qsa('button[data-cedit]', qs('#cBody')).forEach(btn => btn.addEventListener('click', () => openEditCriterion(btn.dataset.cedit)));
    qsa('button[data-cdel]').forEach(btn => btn.addEventListener('click', () => deleteCriterion(btn.dataset.cdel)));

    const critOpts = criteriaCache.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    qs('#eCrit').innerHTML = `<option value="">Критерий: любой</option>${critOpts}`;

    status.textContent = `Критериев: ${items.length}`;
  } catch (e) { status.textContent = e.message; }
}

function openEditCriterion(id) {
  const cid = Number(id);
  const c = criteriaCache.find(x => Number(x.id) === cid);
  if (!c) { alert('Критерий не найден (обновите список)'); return; }

  modal('Редактировать критерий', `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1;min-width:320px">
          <div class="muted" style="margin:0 0 6px 2px;display:flex;justify-content:space-between;gap:10px">
            <span>Название</span>
            <span id="ecNameCount">0/120</span>
          </div>
          <textarea id="ecName" rows="2" maxlength="120" placeholder="Название критерия (до 120 символов)" style="width:100%"></textarea>
        </div>
        <div style="width:180px;min-width:160px">
          <div class="muted" style="margin:0 0 6px 2px">Макс. балл</div>
          <input id="ecMax" type="number" step="1" min="0" placeholder="Макс. балл" style="width:100%" />
        </div>
      </div>

      <div>
        <div class="muted" style="margin:0 0 6px 2px;display:flex;justify-content:space-between;gap:10px">
          <span>Описание (необязательно)</span>
          <span id="ecDescCount">0/500</span>
        </div>
        <textarea id="ecDesc" rows="3" maxlength="500" placeholder="Коротко поясните, что именно оценивается (до 500 символов)" style="width:100%"></textarea>
      </div>

      <div class="row" style="justify-content:space-between">
        <label class="muted"><input id="ecActive" type="checkbox" /> активен</label>
        <button class="btn primary" id="ecSave">Сохранить</button>
      </div>
    </div>
  `);

  qs('#ecName').value = String(c.name || '');
  qs('#ecDesc').value = String(c.description || '');
  qs('#ecMax').value = String(c.max_score ?? '');
  qs('#ecActive').checked = !!c.active;

  const updateCount = (el, out, max) => { out.textContent = `${(el.value || '').length}/${max}`; };
  const nameEl = qs('#ecName');
  const descEl = qs('#ecDesc');
  const nameCount = qs('#ecNameCount');
  const descCount = qs('#ecDescCount');
  updateCount(nameEl, nameCount, 120);
  updateCount(descEl, descCount, 500);
  nameEl.addEventListener('input', () => updateCount(nameEl, nameCount, 120));
  descEl.addEventListener('input', () => updateCount(descEl, descCount, 500));
  nameEl.focus();

  qs('#ecSave').addEventListener('click', async () => {
    try {
      const name = qs('#ecName').value.trim();
      if (name.length < 2 || name.length > 120) { alert('Название критерия: 2-120 символов'); return; }
      const description = qs('#ecDesc').value.trim();
      if (description.length > 500) { alert('Описание до 500 символов'); return; }
      const maxScore = Number(qs('#ecMax').value || '10');
      if (!Number.isFinite(maxScore) || maxScore < 0) { alert('Макс. балл должен быть числом >= 0'); return; }

      await patchCriterion(cid, { name, description, max_score: maxScore, active: qs('#ecActive').checked });
      closeModal('adminModal');
      await loadCriteria();
      await loadEvals();
    } catch (e) { alert(e.message); }
  });
}

function startInlineCriterionEdit(span) {
  const field = span.dataset.c;
  const id = span.dataset.id;
  const old = span.textContent;
  span.classList.add('editing');
  const maxLen = field === 'name' ? 120 : (field === 'desc' ? 500 : null);
  const extra = maxLen ? ` maxlength="${maxLen}"` : '';
  span.innerHTML = `<input style="width:100%" value="${escapeHtml(old)}"${extra} />`;
  const inp = span.querySelector('input');
  inp.focus();
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') inp.blur();
    if (ev.key === 'Escape') { span.textContent = old; span.classList.remove('editing'); }
  });
  inp.addEventListener('blur', async () => {
    const val = inp.value.trim();
    span.classList.remove('editing');
    span.textContent = val;
    const patch = {};
    if (field === 'name') patch.name = val;
    if (field === 'desc') patch.description = val;
    if (field === 'max') patch.max_score = parseFloat(val);
    await patchCriterion(id, patch);
  });
}

async function patchCriterion(id, patch) {
  try {
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (n.length < 2 || n.length > 120) { alert('Название: 2-120 символов'); return; }
      patch.name = n;
    }
    if (patch.description !== undefined && patch.description !== null) {
      const d = String(patch.description).trim();
      if (d.length > 500) { alert('Описание до 500 символов'); return; }
      patch.description = d;
    }
    if (patch.max_score !== undefined) {
      const ms = Number(patch.max_score);
      if (!Number.isFinite(ms) || ms < 0) { alert('Макс. балл должен быть числом >= 0'); return; }
      patch.max_score = ms;
    }
    await adminReq(`/api/admin/criteria/${id}`, { method: 'PATCH', body: patch });
  } catch (e) { alert(e.message); }
}

async function deleteCriterion(id) {
  if (!confirm('Удалить критерий?')) return;
  try {
    await adminReq(`/api/admin/criteria/${id}`, { method: 'DELETE' });
    await loadCriteria();
    await loadEvals();
  } catch (e) { alert(e.message); }
}

async function purgeAllEvaluations() {
  if (!confirm('Удалить ВСЕ оценки? Это действие необратимо.')) return;
  const status = qs('#eStatus');
  status.textContent = '...';
  try {
    const res = await adminReq('/api/admin/evaluations', { method: 'DELETE' });
    status.textContent = `Удалено: оценок ${res.scores_deleted ?? 0}, оцениваний ${res.evaluations_deleted ?? 0}`;
    await loadEvals();
  } catch (e) { status.textContent = e.message; }
}

function buildEvalQueryString() {
  const params = new URLSearchParams();
  const target_id = parseInputId(qs('#eTarget').value);
  const rater_id = parseInputId(qs('#eRater').value);
  const criterion_id = qs('#eCrit').value;
  const anomaly_only = qs('#eAnom').checked;
  if (target_id !== null) params.set('target_id', String(target_id));
  if (rater_id !== null) params.set('rater_id', String(rater_id));
  if (criterion_id) params.set('criterion_id', criterion_id);
  if (anomaly_only) params.set('anomaly_only', 'true');
  return params.toString();
}

async function loadEvals() {
  const status = qs('#eStatus');
  status.textContent = '...';
  try {
    const qsParams = buildEvalQueryString();
    const res = await adminReq(`/api/admin/evaluations?${qsParams}`);
    const items = res.items || [];

    qs('#eBody').innerHTML = items.map(it => {
      const cls = it.is_anomaly ? 'anomaly' : '';
      const delta = (it.delta === null || it.delta === undefined) ? '' : (it.delta > 0 ? `+${it.delta.toFixed(2)}` : it.delta.toFixed(2));
      const z = (it.z === null || it.z === undefined) ? '' : it.z.toFixed(2);
      return `
        <tr class="${cls}">
          <td>${escapeHtml(it.target)}</td>
          <td>${escapeHtml(it.rater)}</td>
          <td>${escapeHtml(it.criterion)}</td>
          <td>
            <span class="inline" data-sid="${it.score_id}" data-max="${it.max_score}">${Number(it.score).toFixed(2)}</span>
            <span class="muted">/ ${it.max_score}</span>
          </td>
          <td class="muted">${it.mean === null || it.mean === undefined ? '' : Number(it.mean).toFixed(2)}</td>
          <td class="muted">${escapeHtml(delta)}</td>
          <td class="muted">${escapeHtml(z)}</td>
          <td><span class="inline" data-eid="${it.evaluation_id}">${escapeHtml(it.comment || '')}</span></td>
          <td><button class="btn danger" data-sdel="${it.score_id}">Удалить балл</button></td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="9" class="muted">Нет данных</td></tr>`;

    qsa('span.inline[data-sid]').forEach(el => el.addEventListener('click', () => startInlineScore(el)));
    qsa('span.inline[data-eid]').forEach(el => el.addEventListener('click', () => startInlineComment(el)));
    qsa('button[data-sdel]').forEach(btn => btn.addEventListener('click', () => deleteScore(btn.dataset.sdel)));

    status.textContent = `Строк: ${items.length}`;
  } catch (e) { status.textContent = e.message; }
}

function startInlineScore(span) {
  const sid = span.dataset.sid;
  const old = span.textContent;
  span.classList.add('editing');
  span.innerHTML = `<input type="number" step="0.5" style="width:110px" value="${escapeHtml(old)}" />`;
  const inp = span.querySelector('input');
  inp.focus();
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { span.textContent = old; span.classList.remove('editing'); } });
  inp.addEventListener('blur', async () => {
    const v = parseFloat(inp.value);
    span.classList.remove('editing');
    span.textContent = Number.isFinite(v) ? v.toFixed(2) : old;
    try {
      await adminReq(`/api/admin/evaluation-scores/${sid}`, { method: 'PATCH', body: { score: v } });
      await loadEvals();
    } catch (e) { alert(e.message); }
  });
}

function startInlineComment(span) {
  const eid = span.dataset.eid;
  const old = span.textContent;
  span.classList.add('editing');
  span.innerHTML = `<input style="width:100%" value="${escapeHtml(old)}" />`;
  const inp = span.querySelector('input');
  inp.focus();
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { span.textContent = old; span.classList.remove('editing'); } });
  inp.addEventListener('blur', async () => {
    const val = inp.value.trim();
    span.classList.remove('editing');
    span.textContent = val;
    try { await adminReq(`/api/admin/evaluations/${eid}`, { method: 'PATCH', body: { comment: val } }); }
    catch (e) { alert(e.message); }
  });
}

async function deleteScore(sid) {
  if (!confirm('Удалить этот балл?')) return;
  try {
    await adminReq(`/api/admin/evaluation-scores/${sid}`, { method: 'DELETE' });
    await loadEvals();
  } catch (e) { alert(e.message); }
}

async function loadAudit() {
  const status = qs('#lStatus');
  status.textContent = '...';
  try {
    const res = await adminReq('/api/admin/audit-logs');
    const items = res.items || [];
    qs('#lBody').innerHTML = items.map(a => `
      <tr>
        <td class="muted">${fmtDate(a.created_at)}</td>
        <td>${escapeHtml(a.action)}</td>
        <td>${escapeHtml(a.entity_type)}</td>
        <td>${a.entity_id ?? ''}</td>
        <td class="muted">${escapeHtml((a.before_json || '').slice(0, 120))}${(a.before_json||'').length>120?'…':''}</td>
        <td class="muted">${escapeHtml((a.after_json || '').slice(0, 120))}${(a.after_json||'').length>120?'…':''}</td>
        <td class="muted">${escapeHtml(a.ip || '')}</td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="muted">Нет логов</td></tr>`;
    status.textContent = `Логов: ${items.length}`;
  } catch (e) { status.textContent = e.message; }
}

async function triggerDownload(url, filename) {
  const res = await fetch(url, { headers: { Authorization: `Basic ${getBasic()}` } });
  if (!res.ok) { throw new Error('Не удалось скачать файл'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function exportEvalsCsv() {
  try {
    const qsParams = buildEvalQueryString();
    await triggerDownload(`/api/admin/evaluations/export/csv?${qsParams}`, 'evaluations.csv');
  } catch (e) { alert(e.message); }
}

async function exportEvalsXlsx() {
  try {
    const qsParams = buildEvalQueryString();
    await triggerDownload(`/api/admin/evaluations/export/xlsx?${qsParams}`, 'evaluations.xlsx');
  } catch (e) { alert(e.message); }
}

function bindUi() {
  const navToggle = qs('#navToggle');
  const nav = document.querySelector('.nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => nav.classList.toggle('open'));
    nav.querySelectorAll('a,button').forEach(el => el.addEventListener('click', () => nav.classList.remove('open')));
  }

  bindModalClose();
  setupNoAutofill(qs('#uGroup'));
  setupNoAutofill(qs('#eTarget'));
  setupNoAutofill(qs('#eRater'));

  qs('#aEnter').addEventListener('click', async () => {
    const login = qs('#aLogin').value.trim();
    const pass = qs('#aPass').value;
    const status = qs('#aStatus');
    status.textContent = 'Вход...';
    try {
      setBasic(b64(login, pass));
      await adminReq('/api/admin/users');
      qs('#adminAuthPanel').style.display = 'none';
      qs('#adminApp').style.display = '';
      status.textContent = '';
      toast('Добро пожаловать, администратор!', 'success');
      await loadUsers();
      await loadCriteria();
      await loadEvals();
    } catch (e) {
      clearBasic();
      status.textContent = e.message;
      toast(e.message, 'error');
    }
  });

  qs('#aLogout').addEventListener('click', () => { clearBasic(); location.reload(); });

  qsa('button[data-atab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.atab;
      showAdminTab(key);
      if (key === 'users') await loadUsers();
      if (key === 'criteria') await loadCriteria();
      if (key === 'evals') await loadEvals();
      if (key === 'audit') await loadAudit();
    });
  });

  qs('#uReload')?.addEventListener('click', loadUsers);
  qs('#cReload')?.addEventListener('click', loadCriteria);
  qs('#eReload')?.addEventListener('click', loadEvals);
  qs('#lReload')?.addEventListener('click', loadAudit);

  qs('#uQ').addEventListener('input', debounce(loadUsers, 300));
  qs('#uGroup').addEventListener('input', debounce(loadUsers, 300));
  qs('#eTarget').addEventListener('input', debounce(loadEvals, 300));
  qs('#eRater').addEventListener('input', debounce(loadEvals, 300));
  qs('#eCrit').addEventListener('change', loadEvals);
  qs('#eAnom').addEventListener('change', loadEvals);

  qs('#ePurgeAll').addEventListener('click', purgeAllEvaluations);
  qs('#eExportCsv').addEventListener('click', exportEvalsCsv);
  qs('#eExportXlsx').addEventListener('click', exportEvalsXlsx);

  qs('#uAdd').addEventListener('click', () => {
    modal('Добавить пользователя', `
      <div class="row">
        <input id="nuNick" placeholder="Никнейм" style="flex:1" />
        <input id="nuFull" placeholder="ФИО" style="flex:1" />
      </div>
      <div class="row" style="margin-top:10px;">
        <input id="nuGroup" placeholder="Группа" style="flex:1" />
        <input id="nuPass" type="password" placeholder="Пароль" style="flex:1" />
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="btn primary" id="nuCreate">Создать</button>
      </div>
    `);
    qs('#nuCreate').addEventListener('click', async () => {
      try {
        await adminReq('/api/admin/users', {
          method: 'POST',
          body: {
            nickname: qs('#nuNick').value.trim(),
            full_name: qs('#nuFull').value.trim(),
            group: qs('#nuGroup').value.trim(),
            password: qs('#nuPass').value,
          },
        });
        closeModal('adminModal');
        await loadUsers();
      } catch (e) { alert(e.message); }
    });
  });

  qs('#cAdd').addEventListener('click', () => {
    modal('Добавить критерий', `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="row" style="align-items:flex-start">
          <div style="flex:1;min-width:320px">
            <div class="muted" style="margin:0 0 6px 2px;display:flex;justify-content:space-between;gap:10px">
              <span>Название</span>
              <span id="ncNameCount">0/120</span>
            </div>
            <textarea id="ncName" rows="2" maxlength="120" placeholder="Название критерия (до 120 символов)" style="width:100%"></textarea>
          </div>
          <div style="width:180px;min-width:160px">
            <div class="muted" style="margin:0 0 6px 2px">Макс. балл</div>
            <input id="ncMax" type="number" step="1" min="0" value="10" placeholder="Макс. балл" style="width:100%" />
          </div>
        </div>

        <div>
          <div class="muted" style="margin:0 0 6px 2px;display:flex;justify-content:space-between;gap:10px">
            <span>Описание (необязательно)</span>
            <span id="ncDescCount">0/500</span>
          </div>
          <textarea id="ncDesc" rows="3" maxlength="500" placeholder="Коротко поясните, что именно оценивается (до 500 символов)" style="width:100%"></textarea>
        </div>

        <div class="row" style="justify-content:space-between">
          <label class="muted"><input id="ncActive" type="checkbox" checked /> активен</label>
          <button class="btn primary" id="ncCreate">Создать</button>
        </div>
      </div>
    `);

    const updateCount = (el, out, max) => { out.textContent = `${(el.value || '').length}/${max}`; };
    const nameEl = qs('#ncName');
    const descEl = qs('#ncDesc');
    const nameCount = qs('#ncNameCount');
    const descCount = qs('#ncDescCount');
    updateCount(nameEl, nameCount, 120);
    updateCount(descEl, descCount, 500);
    nameEl.addEventListener('input', () => updateCount(nameEl, nameCount, 120));
    descEl.addEventListener('input', () => updateCount(descEl, descCount, 500));
    nameEl.focus();

    qs('#ncCreate').addEventListener('click', async () => {
      try {
        const name = qs('#ncName').value.trim();
        if (name.length < 2 || name.length > 120) { alert('Название критерия должно быть 2-120 символов'); return; }
        const description = qs('#ncDesc').value.trim();
        if (description.length > 500) { alert('Описание до 500 символов'); return; }
        let maxScore = parseFloat(qs('#ncMax').value || '10');
        if (!Number.isFinite(maxScore)) maxScore = 10;
        if (maxScore < 0) { alert('Макс. балл должен быть >= 0'); return; }

        await adminReq('/api/admin/criteria', { method: 'POST', body: { name, description, max_score: maxScore, active: qs('#ncActive').checked } });
        closeModal('adminModal');
        await loadCriteria();
      } catch (e) { alert(e.message); }
    });
  });
}

function tryRestoreSession() {
  const b = getBasic();
  if (!b) return;
  qs('#adminAuthPanel').style.display = 'none';
  qs('#adminApp').style.display = '';
  loadUsers();
  loadCriteria();
  loadEvals();
}

bindUi();
tryRestoreSession();

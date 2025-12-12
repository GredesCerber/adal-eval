import { api, clearToken, fmtDate, openModal, closeModal, qs, qsa, escapeHtml } from '/js/common.js';

let me = null;
let criteria = [];
let currentTarget = null;

function setupNoAutofill(inputEl) {
  if (!inputEl) return;
  // Some browsers ignore autocomplete=off and may inject saved username into unrelated inputs.
  // Keeping the field readonly until user interaction usually prevents that behavior.
  inputEl.readOnly = true;
  inputEl.addEventListener('focus', () => {
    inputEl.readOnly = false;
  }, { once: true });
  // Clear possible injected value after initial paint.
  setTimeout(() => {
    if (inputEl.readOnly) inputEl.value = '';
  }, 0);
}

function showTab(key) {
  qsa('.tabbtn').forEach(b => {
    if (b.dataset.tab) b.classList.toggle('active', b.dataset.tab === key);
  });
  qs('#tab-eval').style.display = key === 'eval' ? '' : 'none';
  qs('#tab-results').style.display = key === 'results' ? '' : 'none';
  qs('#tab-profile').style.display = key === 'profile' ? '' : 'none';
}

async function loadMe() {
  me = await api('/api/me');
  qs('#meLine').textContent = `${me.full_name} · ${me.group} · @${me.nickname}`;
  qs('#pFull').textContent = me.full_name;
  qs('#pGroup').textContent = me.group;
  qs('#pNick').textContent = me.nickname;
  qs('#pCreated').textContent = fmtDate(me.created_at);
}

async function loadCriteria() {
  criteria = await api('/api/criteria');
}

async function loadStudents() {
  const status = qs('#evalStatus');
  status.textContent = '...';
  try {
    const q = qs('#studentQ').value.trim();
    const group = qs('#studentGroup').value.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (group) params.set('group', group);
    const students = await api(`/api/students?${params.toString()}`);

    const body = qs('#studentsBody');
    body.innerHTML = students.map(s => {
      return `
        <tr>
          <td>${escapeHtml(s.full_name)} <span class="muted">@${escapeHtml(s.nickname)}</span></td>
          <td>${escapeHtml(s.group)}</td>
          <td>
            <button class="btn" data-open="${s.id}">Подробнее</button>
          </td>
        </tr>
      `;
    }).join('');

    qsa('button[data-open]', body).forEach(btn => {
      btn.addEventListener('click', () => openStudentModal(parseInt(btn.dataset.open, 10)));
    });

    status.textContent = `Студентов: ${students.length}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

function buildScoreInputs() {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.style.flexWrap = 'wrap';
  criteria.forEach(c => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.min = '0';
    input.max = String(Math.floor(Number(c.max_score)));
    input.placeholder = `${c.name}`;
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.dataset.criterionId = c.id;
    input.dataset.maxScore = String(Math.floor(Number(c.max_score)));
    input.style.width = '220px';
    wrap.appendChild(input);
  });
  return wrap;
}

function scoreClass(score, maxScore) {
  const max = Number(maxScore) || 0;
  const val = Number(score);
  if (!max || isNaN(val)) return 'scorepill';
  const pct = (val / max) * 100;
  if (pct >= 90) return 'scorepill score-90';
  if (pct >= 70) return 'scorepill score-70';
  if (pct >= 60) return 'scorepill score-60';
  if (pct >= 50) return 'scorepill score-50';
  return 'scorepill score-bad';
}

async function openStudentModal(targetId) {
  currentTarget = targetId;
  qs('#mBody').innerHTML = '';
  qs('#mStatus').textContent = '...';
  qs('#mAddStatus').textContent = '';
  qs('#mComment').value = '';

  openModal('studentModal');

  try {
    // Reuse students list in DOM: find by id
    const rowBtn = document.querySelector(`button[data-open="${targetId}"]`);
    const tr = rowBtn ? rowBtn.closest('tr') : null;
    qs('#mTitle').textContent = tr ? tr.children[0].innerText : `№ ${targetId}`;
    qs('#mSub').textContent = 'поставьте оценку и при необходимости измените её позже';

    const evals = await api(`/api/students/${targetId}/evaluations`);

    // Header: Оценщик + критерии + итого
    const head = `
      <tr>
        <th>Оценщик</th>
        ${criteria.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}
        <th>Итого</th>
      </tr>
    `;
    qs('#mHead').innerHTML = head;

    const rows = evals.map(e => {
      const byCid = {};
      (e.scores || []).forEach(s => { byCid[String(s.criterion_id)] = s; });

      let sum = 0;
      let sumMax = 0;
      const cells = criteria.map(c => {
        const s = byCid[String(c.id)];
        const maxScore = Math.floor(Number(c.max_score));
        sumMax += maxScore;
        const val = s ? Math.round(Number(s.score)) : null;
        if (val !== null && !isNaN(val)) sum += val;
        const cls = val === null ? 'muted' : '';
        const pill = val === null ? `<span class="muted">—</span>` : `<span class="${scoreClass(val, maxScore)}" title="${val}/${maxScore}">${val}</span>`;
        return `<td class="${cls}">${pill}</td>`;
      }).join('');

      const totalPill = sumMax ? `<span class="${scoreClass(sum, sumMax)}" title="${sum}/${sumMax}">${sum}</span>` : `<span class="muted">—</span>`;
      const comment = (e.comment || '').trim();
      const meta = comment ? ` • ${escapeHtml(comment.slice(0, 60))}${comment.length > 60 ? '…' : ''}` : '';

      return `
        <tr>
          <td>
            <div>${escapeHtml(e.rater_full_name)}</div>
            <div class="muted" title="${escapeHtml(comment)}">${fmtDate(e.created_at)}${meta}</div>
          </td>
          ${cells}
          <td>${totalPill}</td>
        </tr>
      `;
    });

    qs('#mBody').innerHTML = rows.join('') || `<tr><td colspan="${criteria.length + 2}" class="muted">Оценок пока нет</td></tr>`;
    qs('#mStatus').textContent = rows.length ? `Оценок: ${rows.length}` : 'Оценок пока нет';

    // Build inputs + prefill with my previous evaluation (if any)
    const form = qs('#mForm');
    form.innerHTML = '';
    form.appendChild(buildScoreInputs());

    const mine = (evals || []).find(e => Number(e.rater_id) === Number(me?.id));
    if (mine && mine.scores) {
      const map = {};
      mine.scores.forEach(s => { map[String(s.criterion_id)] = s; });
      qsa('#mForm input[type="number"]').forEach(inp => {
        const s = map[String(inp.dataset.criterionId)];
        inp.value = s ? String(Math.round(Number(s.score))) : '';
      });
      qs('#mComment').value = mine.comment || '';
      qs('#mSubmit').textContent = 'Сохранить изменения';
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
      scores.push({ criterion_id: parseInt(inp.dataset.criterionId, 10), score: parseInt(v, 10) });
    });
    if (!scores.length) throw new Error('Введите хотя бы один балл');

    const comment = qs('#mComment').value;
    await api(`/api/students/${currentTarget}/evaluate`, { method: 'POST', body: { comment, scores } });
    status.textContent = 'Готово';

    // refresh modal list and results
    await openStudentModal(currentTarget);
    await loadResults();
  } catch (e) {
    status.textContent = e.message;
  }
}

async function loadResults() {
  const status = qs('#resultsStatus');
  status.textContent = '...';
  try {
    const q = qs('#resultsQ').value.trim();
    const group = qs('#resultsGroup').value.trim();
    const sort = qs('#resultsSort').value;
    const order = qs('#resultsOrder').value;

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (group) params.set('group', group);
    if (sort) params.set('sort', sort);
    if (order) params.set('order', order);

    const rows = await api(`/api/results?${params.toString()}`);

    // header from first row criteria keys
    const criteriaKeys = rows.length ? Object.keys(rows[0].criteria) : [];
    qs('#resultsHead').innerHTML = `
      <tr>
        <th>Студент</th>
        <th>Группа</th>
        ${criteriaKeys.map(k => `<th>${escapeHtml(k)}</th>`).join('')}
        <th>Среднее</th>
        <th>Детали</th>
      </tr>
    `;

    qs('#resultsBody').innerHTML = rows.map(r => {
      return `
        <tr>
          <td>${escapeHtml(r.student_full_name)}</td>
          <td>${escapeHtml(r.group)}</td>
          ${criteriaKeys.map(k => {
            const v = r.criteria[k];
            return `<td class="muted">${v === null || v === undefined ? '' : Number(v).toFixed(2)}</td>`;
          }).join('')}
          <td><b>${r.overall_mean === null || r.overall_mean === undefined ? '' : Number(r.overall_mean).toFixed(2)}</b></td>
          <td><button class="btn" data-open2="${r.student_id}">Детали</button></td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="6" class="muted">Нет данных</td></tr>`;

    qsa('button[data-open2]').forEach(btn => {
      btn.addEventListener('click', () => openStudentModal(parseInt(btn.dataset.open2, 10)));
    });

    status.textContent = `Строк: ${rows.length}`;
  } catch (e) {
    status.textContent = e.message;
  }
}

async function changePassword() {
  const status = qs('#passStatus');
  status.textContent = '...';
  try {
    const old_password = qs('#oldPass').value;
    const new_password = qs('#newPass').value;
    await api('/api/me/password', { method: 'POST', body: { old_password, new_password } });
    status.textContent = 'Готово';
    qs('#oldPass').value = '';
    qs('#newPass').value = '';
  } catch (e) {
    status.textContent = e.message;
  }
}

function bindUi() {
  qsa('button[data-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      showTab(btn.dataset.tab);
      if (btn.dataset.tab === 'results') await loadResults();
    });
  });

  setupNoAutofill(qs('#studentGroup'));
  setupNoAutofill(qs('#resultsGroup'));

  qs('#logout').addEventListener('click', () => {
    clearToken();
    location.href = '/login.html';
  });

  qs('#reloadStudents').addEventListener('click', loadStudents);
  qs('#reloadResults').addEventListener('click', loadResults);

  qs('#mClose').addEventListener('click', () => closeModal('studentModal'));
  qs('#mSubmit').addEventListener('click', submitEvaluation);

  qs('#changePass').addEventListener('click', changePassword);
}

async function bootstrap() {
  try {
    await loadMe();
  } catch {
    location.href = '/login.html';
    return;
  }

  bindUi();
  await loadCriteria();
  await loadStudents();
}

bootstrap();

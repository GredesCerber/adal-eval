const TOKEN_KEY = 'sep.jwt';
const THEME_KEY = 'sep.theme';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, { method = 'GET', body = null, headers = {}, auth = 'user', basic = '' } = {}) {
  const h = { 'Accept': 'application/json', ...headers };
  if (body !== null && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
  }

  if (auth === 'user') {
    const token = getToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
  }
  if (auth === 'admin' && basic) {
    h['Authorization'] = `Basic ${basic}`;
  }

  const res = await fetch(path, {
    method,
    headers: h,
    body: body === null ? null : (body instanceof FormData ? body : JSON.stringify(body))
  });

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  if (!res.ok) {
    const msg = formatApiError(data, res.status);
    throw new Error(msg);
  }
  return data;
}

function formatApiError(data, status) {
  try {
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = data.detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        // FastAPI validation errors: [{loc: [...], msg: '...', type: '...'}]
        return detail.map((e) => {
          const loc = Array.isArray(e.loc) ? e.loc.slice(1).join('.') : '';
          const msg = e.msg || 'Некорректные данные';
          return loc ? `${loc}: ${msg}` : msg;
        }).join('\n');
      }
      return JSON.stringify(detail);
    }
    if (typeof data === 'string' && data.trim()) return data;
  } catch {
    // ignore
  }
  return `Ошибка HTTP ${status}`;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export function openModal(id) {
  const el = document.getElementById(id);
  el.classList.add('open');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('open');
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* ========== Theme management ========== */
export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let next;
  
  if (current === 'dark') {
    next = 'light';
  } else if (current === 'light') {
    next = 'dark';
  } else {
    next = prefersDark ? 'light' : 'dark';
  }
  
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  return next;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 
         (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/* ========== Toast notifications ========== */
let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function toast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warn: '⚠',
    info: 'ℹ'
  };
  
  el.innerHTML = `
    <span style="font-size:18px">${icons[type] || icons.info}</span>
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Закрыть">×</button>
  `;
  
  const close = () => {
    el.style.animation = 'fadeIn .2s ease reverse';
    setTimeout(() => el.remove(), 200);
  };
  
  el.querySelector('.toast-close').onclick = close;
  container.appendChild(el);
  
  if (duration > 0) {
    setTimeout(close, duration);
  }
  
  return el;
}

/* ========== Mobile nav toggle ========== */
export function initNavToggle() {
  const toggle = qs('.nav-toggle');
  const nav = qs('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      nav.classList.toggle('open');
    });
  }
}

/* ========== Init common ========== */
export function initCommon() {
  initTheme();
  initNavToggle();
  
  // Theme toggle button
  const themeBtn = qs('.theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = toggleTheme();
      themeBtn.innerHTML = next === 'dark' ? '☀️' : '🌙';
    });
    // Set initial icon
    const current = getTheme();
    themeBtn.innerHTML = current === 'dark' ? '☀️' : '🌙';
  }
}

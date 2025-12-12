const path = require('path');
const fs = require('fs');

const python = process.platform === 'win32'
  ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
  : path.join(__dirname, '.venv', 'bin', 'python');

function loadDotEnv(envPath) {
  // Minimal .env loader (to avoid requiring extra npm deps)
  // Supports KEY=VALUE, ignores comments and empty lines.
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

const fileEnv = loadDotEnv(path.join(__dirname, '.env'));
const host = process.env.APP_HOST || fileEnv.APP_HOST || '0.0.0.0';
const port = Number(process.env.APP_PORT || fileEnv.APP_PORT || 8000);
const portArg = Number.isFinite(port) ? port : 8000;

module.exports = {
  apps: [
    {
      name: 'student-eval-api',
      cwd: __dirname,
      script: python,
      args: `-m uvicorn backend.main:app --host ${host} --port ${portArg}`,
      env: {
        PYTHONUNBUFFERED: '1'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      time: true,
      merge_logs: true
    }
  ]
};

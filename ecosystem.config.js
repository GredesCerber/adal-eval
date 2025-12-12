module.exports = {
  apps: [
    {
      name: 'student-eval-api',
      cwd: __dirname,
      script: 'python',
      args: '-m uvicorn backend.main:app --host 0.0.0.0 --port 8000',
      env: {
        PYTHONUNBUFFERED: '1'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10
    }
  ]
};

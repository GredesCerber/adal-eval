# Платформа оценивания студентов (FastAPI + SQLite + чистый JS)

## Быстрый старт (Windows)

1) Создайте и заполните `.env` на основе `.env.example`.

2) Создайте виртуальное окружение и установите зависимости:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

3) Инициализация БД и seed:

```powershell
python scripts\init_db.py
```

Seed создаёт тестовых пользователей:
- `ivanov / password123`
- `petrova / password123`

4) Запуск dev:

```powershell
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Откройте:
- `http://127.0.0.1:8000/login.html`
- `http://127.0.0.1:8000/admin.html`

## Админ-доступ

Админ-эндпоинты защищены Basic Auth логином/паролем из `.env`:
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`

В админке (`/admin.html`) введите эти значения — после этого доступны CRUD пользователей/критериев, просмотр оценок, inline-edit и аудит-логи.


## PM2 (production)

```powershell
pm2 start ecosystem.config.js
pm2 logs student-eval-api
```

> PM2 требует установленный Node.js и `pm2`.


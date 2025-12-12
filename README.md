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

## Разворачивание на AlmaLinux (production, только PM2)

Предпосылки:
- Хост/порт берутся из `.env`: `APP_HOST`, `APP_PORT` (PM2 подставляет их в параметры Uvicorn).
- Нужны `python3`, `venv`, `nodejs` и `pm2`.

### 1) Установка зависимостей

```bash
sudo dnf update -y
sudo dnf install -y git python3 python3-pip

# Node.js (выберите подходящую версию из репозитория вашей AlmaLinux)
sudo dnf install -y nodejs npm

sudo npm i -g pm2
```

Проверьте:

```bash
python3 --version
node --version
pm2 --version
```

### 2) Клонирование и настройка окружения

```bash
git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ>
cd adal-eval

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Создайте `.env`:

```bash
cp .env.example .env
nano .env
```

Минимально обязательные параметры в `.env`:
- `JWT_SECRET`
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`

Для публичного хоста обычно ставят:

```dotenv
APP_HOST=0.0.0.0
APP_PORT=8000
```

### 3) Инициализация БД (первый запуск)

```bash
source .venv/bin/activate
python scripts/init_db.py
```

По умолчанию создаётся SQLite-файл `app.db` в корне проекта.

### 4) Запуск через PM2

Запуск (из корня проекта):

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs student-eval-api
```

Сервис будет доступен по адресу:
- `http://<SERVER_IP>:8000/login.html`
- `http://<SERVER_IP>:8000/admin.html`

### 5) Автозапуск PM2 после перезагрузки

```bash
pm2 save
pm2 startup
```

Команда `pm2 startup` выведет строку с `sudo ...` — выполните её (она создаст unit для systemd).

### (Опционально) Открыть порт в firewall

Если включён firewalld:

```bash
sudo firewall-cmd --add-port=8000/tcp --permanent
sudo firewall-cmd --reload
```

## Админ-доступ

Админ-эндпоинты защищены Basic Auth логином/паролем из `.env`:
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`

В админке (`/admin.html`) введите эти значения — после этого доступны CRUD пользователей/критериев, просмотр оценок, inline-edit и аудит-логи.


## PM2 (production)

```bash
pm2 start ecosystem.config.js
pm2 logs student-eval-api
pm2 save
pm2 startup
```

> PM2 требует установленный Node.js и `pm2`.


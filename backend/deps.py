from __future__ import annotations

import secrets
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBasic, HTTPBasicCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User
from .security import decode_token


bearer = HTTPBearer(auto_error=False)
basic = HTTPBasic(auto_error=False)


def get_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")

    try:
        payload = decode_token(credentials.credentials)
        nickname = payload.get("sub")
        if not nickname:
            raise ValueError("missing sub")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный токен")

    user = db.query(User).filter(User.nickname == nickname).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден или отключён")
    return user


def require_admin(
    request: Request,
    creds: Annotated[Optional[HTTPBasicCredentials], Depends(basic)],
) -> str:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация администратора")

    ok_login = secrets.compare_digest(creds.username, settings.admin_login)
    ok_pass = secrets.compare_digest(creds.password, settings.admin_password)
    if not (ok_login and ok_pass):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль администратора")

    return request.client.host if request.client else ""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import engine
from .models import Base
from .routes.admin import router as admin_router
from .routes.auth import router as auth_router
from .routes.user import router as user_router


def create_app() -> FastAPI:
    app = FastAPI(title="Платформа оценивания студентов")

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/api/health")
    def health():
        return {"ok": True}

    app.include_router(auth_router)
    app.include_router(user_router)
    app.include_router(admin_router)

    # Tables
    Base.metadata.create_all(bind=engine)

    # Serve frontend as static site (API routes above take precedence)
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

    return app


app = create_app()

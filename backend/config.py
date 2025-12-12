from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_host: str = "0.0.0.0"
    app_port: int = 8000

    database_url: str = "sqlite:///./app.db"

    jwt_secret: str
    jwt_alg: str = "HS256"
    jwt_expires_min: int = 1440

    admin_login: str
    admin_password: str

    cors_origins: str = ""

    anomaly_zscore: float = 2.0
    anomaly_min_samples: int = 3

    @property
    def cors_origin_list(self) -> list[str]:
        if not self.cors_origins:
            return []
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

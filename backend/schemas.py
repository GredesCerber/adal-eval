from __future__ import annotations

import datetime as dt
from typing import Any, Optional

from pydantic import BaseModel, Field


# ==================== Events ====================

class EventCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    is_active: bool = True


class EventUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None


class EventPublic(BaseModel):
    id: int
    name: str
    description: str
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime


class EventWithParticipation(BaseModel):
    """Событие с информацией о прикреплении текущего пользователя."""
    id: int
    name: str
    description: str
    is_active: bool
    is_joined: bool  # Прикреплён ли текущий пользователь
    participants_count: int  # Количество участников
    created_at: dt.datetime


class EventParticipantPublic(BaseModel):
    id: int
    user_id: int
    full_name: str
    nickname: str
    group: str
    joined_at: dt.datetime


# ==================== Auth ====================

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    group: str = Field(min_length=1, max_length=64)
    nickname: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    nickname: str
    password: str


class UserSelfUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    group: Optional[str] = Field(default=None, min_length=1, max_length=64)
    nickname: Optional[str] = Field(default=None, min_length=3, max_length=64)


class UserPublic(BaseModel):
    id: int
    nickname: str
    full_name: str
    group: str
    created_at: dt.datetime


class UserAdminUpdate(BaseModel):
    nickname: Optional[str] = Field(default=None, min_length=3, max_length=64)
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    group: Optional[str] = Field(default=None, min_length=1, max_length=64)
    is_active: Optional[bool] = None


class UserAdminCreate(BaseModel):
    nickname: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=2, max_length=200)
    group: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


class CriterionPublic(BaseModel):
    id: int
    event_id: Optional[int] = None
    name: str
    description: str
    max_score: float
    active: bool


class CriterionCreate(BaseModel):
    event_id: Optional[int] = None
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=500)
    max_score: float = Field(default=10.0, ge=0)
    active: bool = True


class CriterionUpdate(BaseModel):
    event_id: Optional[int] = None
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    max_score: Optional[float] = Field(default=None, ge=0)
    active: Optional[bool] = None


class ScoreInput(BaseModel):
    criterion_id: int
    score: int = Field(ge=0)


class CreateEvaluationRequest(BaseModel):
    event_id: Optional[int] = None
    target_name: Optional[str] = Field(default=None, max_length=200)  # Для внешних участников
    comment: str = Field(default="", max_length=2000)
    scores: list[ScoreInput]


class EvaluationScorePublic(BaseModel):
    id: int
    criterion_id: int
    criterion_name: str
    max_score: float
    score: float
    mean: Optional[float] = None
    stdev: Optional[float] = None
    z: Optional[float] = None
    delta: Optional[float] = None
    is_anomaly: bool = False


class EvaluationPublic(BaseModel):
    id: int
    rater_id: int
    rater_full_name: str
    comment: str
    created_at: dt.datetime
    scores: list[EvaluationScorePublic]


class ResultsRow(BaseModel):
    """Строка итоговой таблицы — агрегация по нормализованному ФИО."""
    normalized_name: str  # Ключ группировки
    display_name: str  # Отображаемое ФИО
    student_id: Optional[int] = None  # ID пользователя (если это зарег. пользователь)
    student_full_name: str
    group: str
    criteria: dict[str, Optional[float]]
    overall_mean: Optional[float]  # Средний ИТОГО (avg по суммарным баллам)
    raters_count: int  # COUNT DISTINCT оценщиков
    anomaly_count: int


class ResultsDetailRow(BaseModel):
    """Детальная строка — отдельная оценка."""
    evaluation_id: int
    rater_id: int
    rater_full_name: str
    scores: dict[str, float]  # criterion_name -> score
    total_score: float
    comment: str
    created_at: dt.datetime


class AdminScorePatch(BaseModel):
    score: int


class AdminEvaluationPatch(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=2000)


class AuditLogRow(BaseModel):
    id: int
    actor_type: str
    actor_user_id: Optional[int]
    action: str
    entity_type: str
    entity_id: Optional[int]
    before_json: str
    after_json: str
    created_at: dt.datetime
    ip: str


class ListResponse(BaseModel):
    items: list[Any]
    total: int

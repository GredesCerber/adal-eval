from __future__ import annotations

import datetime as dt
from typing import Any

from pydantic import BaseModel, Field


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


class UserPublic(BaseModel):
    id: int
    nickname: str
    full_name: str
    group: str
    created_at: dt.datetime


class UserAdminUpdate(BaseModel):
    nickname: str | None = Field(default=None, min_length=3, max_length=64)
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    group: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None


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
    name: str
    description: str
    max_score: float
    active: bool


class CriterionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=500)
    max_score: float = Field(default=10.0, ge=0)
    active: bool = True


class CriterionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    max_score: float | None = Field(default=None, ge=0)
    active: bool | None = None


class ScoreInput(BaseModel):
    criterion_id: int
    score: int = Field(ge=0)


class CreateEvaluationRequest(BaseModel):
    comment: str = Field(default="", max_length=2000)
    scores: list[ScoreInput]


class EvaluationScorePublic(BaseModel):
    id: int
    criterion_id: int
    criterion_name: str
    max_score: float
    score: float
    mean: float | None = None
    stdev: float | None = None
    z: float | None = None
    delta: float | None = None
    is_anomaly: bool = False


class EvaluationPublic(BaseModel):
    id: int
    rater_id: int
    rater_full_name: str
    comment: str
    created_at: dt.datetime
    scores: list[EvaluationScorePublic]


class ResultsRow(BaseModel):
    student_id: int
    student_full_name: str
    group: str
    criteria: dict[str, float | None]
    overall_mean: float | None
    anomaly_count: int


class AdminScorePatch(BaseModel):
    score: int


class AdminEvaluationPatch(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class AuditLogRow(BaseModel):
    id: int
    actor_type: str
    actor_user_id: int | None
    action: str
    entity_type: str
    entity_id: int | None
    before_json: str
    after_json: str
    created_at: dt.datetime
    ip: str


class ListResponse(BaseModel):
    items: list[Any]
    total: int

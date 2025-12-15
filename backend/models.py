from __future__ import annotations

import datetime as dt
import re
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def normalize_full_name(name: str) -> str:
    """Нормализует ФИО: trim, сжатие пробелов, lowercase для сравнения."""
    if not name:
        return ""
    return re.sub(r'\s+', ' ', name.strip()).lower()


def normalize_group(group: str) -> str:
    """Нормализует группу: удаление всех пробелов."""
    if not group:
        return ""
    return re.sub(r'\s+', '', group.strip())


class Base(DeclarativeBase):
    pass


class Event(Base):
    """Событие оценивания — основная сущность, к которой привязаны критерии и оценки."""
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow(), onupdate=lambda: dt.datetime.utcnow())

    criteria: Mapped[list["Criterion"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    evaluations: Mapped[list["Evaluation"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    participants: Mapped[list["EventParticipant"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class EventParticipant(Base):
    """Прикрепление пользователя к событию."""
    __tablename__ = "event_participants"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())

    event: Mapped["Event"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship(back_populates="event_participations")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nickname: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    group: Mapped[str] = mapped_column(String(64), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    given_evaluations: Mapped[list["Evaluation"]] = relationship(
        back_populates="rater", foreign_keys="Evaluation.rater_id", cascade="all, delete-orphan"
    )
    received_evaluations: Mapped[list["Evaluation"]] = relationship(
        back_populates="target", foreign_keys="Evaluation.target_id", cascade="all, delete-orphan"
    )
    event_participations: Mapped[list["EventParticipant"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Criterion(Base):
    __tablename__ = "criteria"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[Optional[int]] = mapped_column(ForeignKey("events.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    max_score: Mapped[float] = mapped_column(Float, default=10.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow(), onupdate=lambda: dt.datetime.utcnow())

    event: Mapped[Optional["Event"]] = relationship(back_populates="criteria")
    scores: Mapped[list["EvaluationScore"]] = relationship(back_populates="criterion")


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[Optional[int]] = mapped_column(ForeignKey("events.id"), nullable=True, index=True)
    rater_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    target_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # Для внешних участников (не зарегистрированных пользователей)
    target_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    target_name_normalized: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow(), onupdate=lambda: dt.datetime.utcnow())

    event: Mapped[Optional["Event"]] = relationship(back_populates="evaluations")
    rater: Mapped[User] = relationship(back_populates="given_evaluations", foreign_keys=[rater_id])
    target: Mapped[Optional[User]] = relationship(back_populates="received_evaluations", foreign_keys=[target_id])

    scores: Mapped[list["EvaluationScore"]] = relationship(back_populates="evaluation", cascade="all, delete-orphan")


class EvaluationScore(Base):
    __tablename__ = "evaluation_scores"
    __table_args__ = (UniqueConstraint("evaluation_id", "criterion_id", name="uq_eval_criterion"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(ForeignKey("evaluations.id"), index=True)
    criterion_id: Mapped[int] = mapped_column(ForeignKey("criteria.id"), index=True)
    score: Mapped[float] = mapped_column(Float)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow(), onupdate=lambda: dt.datetime.utcnow())

    evaluation: Mapped[Evaluation] = relationship(back_populates="scores")
    criterion: Mapped[Criterion] = relationship(back_populates="scores")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_type: Mapped[str] = mapped_column(String(32))  # 'admin' | 'user'
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    action: Mapped[str] = mapped_column(String(120))
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    before_json: Mapped[str] = mapped_column(Text, default="")
    after_json: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=lambda: dt.datetime.utcnow())
    ip: Mapped[str] = mapped_column(String(64), default="")

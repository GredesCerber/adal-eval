from __future__ import annotations

import random
import sys
from pathlib import Path

# Allow running as: python scripts/init_db.py
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.database import SessionLocal, engine
from backend.models import Base, Criterion, Evaluation, EvaluationScore, User
from backend.security import hash_password
from backend.services import clamp_score


def _get_or_create_user(db, *, nickname: str, full_name: str, group: str, password: str) -> User:
    u = db.query(User).filter(User.nickname == nickname).first()
    if u:
        return u
    u = User(
        nickname=nickname,
        full_name=full_name,
        group=group,
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(u)
    db.flush()
    return u


def _get_or_create_criterion(db, *, name: str, description: str, max_score: float, active: bool = True) -> Criterion:
    c = db.query(Criterion).filter(Criterion.name == name).first()
    if c:
        return c
    c = Criterion(name=name, description=description, max_score=float(max_score), active=bool(active))
    db.add(c)
    db.flush()
    return c


def _seed_evaluations(db, *, users: list[User], criteria: list[Criterion]) -> None:
    rng = random.Random(42)

    # If there are already evaluations, don't duplicate.
    existing = db.query(Evaluation).count()
    if existing:
        return

    active_users = [u for u in users if u.is_active]
    if len(active_users) < 3 or not criteria:
        return

    # For each target user create a few evaluations from others
    for target in active_users:
        raters = [u for u in active_users if u.id != target.id]
        rng.shuffle(raters)
        for rater in raters[: min(4, len(raters))]:
            e = Evaluation(rater_id=rater.id, target_id=target.id, comment=f"Оценка от {rater.full_name}")
            db.add(e)
            db.flush()

            for crit in criteria:
                base = rng.uniform(0.6, 0.95) * float(crit.max_score)
                noise = rng.uniform(-0.15, 0.15) * float(crit.max_score)
                score = clamp_score(base + noise, max_score=float(crit.max_score))
                db.add(EvaluationScore(evaluation_id=e.id, criterion_id=crit.id, score=score))

    # Add one intentionally anomalous score to demonstrate highlighting
    target = active_users[0]
    rater = active_users[1]
    crit = criteria[0]
    e = Evaluation(rater_id=rater.id, target_id=target.id, comment="(seed) намеренно аномальная оценка")
    db.add(e)
    db.flush()
    db.add(EvaluationScore(evaluation_id=e.id, criterion_id=crit.id, score=clamp_score(float(crit.max_score), max_score=float(crit.max_score))))


def main() -> None:
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Users
        users = [
            _get_or_create_user(db, nickname="ivanov", full_name="Иванов Иван Иванович", group="ИС-31", password="password123"),
            _get_or_create_user(db, nickname="petrova", full_name="Петрова Анна Сергеевна", group="ИС-31", password="password123"),
            _get_or_create_user(db, nickname="sidorov", full_name="Сидоров Павел Олегович", group="ИС-31", password="password123"),
            _get_or_create_user(db, nickname="smirnova", full_name="Смирнова Мария Ильинична", group="ИС-32", password="password123"),
            _get_or_create_user(db, nickname="kuznetsov", full_name="Кузнецов Артём Денисович", group="ИС-32", password="password123"),
            _get_or_create_user(db, nickname="volkova", full_name="Волкова Екатерина Павловна", group="ИС-32", password="password123"),
        ]

        # Criteria
        criteria = [
            _get_or_create_criterion(db, name="Качество", description="Насколько качественно выполнена работа", max_score=10),
            _get_or_create_criterion(db, name="Сроки", description="Соблюдение сроков", max_score=10),
            _get_or_create_criterion(db, name="Коммуникация", description="Взаимодействие в команде", max_score=10),
        ]

        _seed_evaluations(db, users=users, criteria=[c for c in criteria if c.active])

        db.commit()
        print("OK: DB initialized and seeded")
        print("Test user login: ivanov / password123")
        print("Test user login: petrova / password123")
    finally:
        db.close()


if __name__ == "__main__":
    main()

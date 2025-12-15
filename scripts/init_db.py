from __future__ import annotations

import random
import sys
from pathlib import Path

# Allow running as: python scripts/init_db.py
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.database import SessionLocal, engine
from backend.models import Base, Criterion, Evaluation, EvaluationScore, Event, User
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


def _get_or_create_criterion(db, *, name: str, description: str, max_score: float, active: bool = True, event_id: int = None) -> Criterion:
    q = db.query(Criterion).filter(Criterion.name == name)
    if event_id:
        q = q.filter(Criterion.event_id == event_id)
    c = q.first()
    if c:
        return c
    c = Criterion(name=name, description=description, max_score=float(max_score), active=bool(active), event_id=event_id)
    db.add(c)
    db.flush()
    return c


def _get_or_create_event(db, *, name: str, description: str = "", is_active: bool = True) -> Event:
    e = db.query(Event).filter(Event.name == name).first()
    if e:
        return e
    e = Event(name=name, description=description, is_active=is_active)
    db.add(e)
    db.flush()
    return e


from backend.models import EventParticipant

def _add_users_to_event(db, *, users: list[User], event: Event) -> None:
    """Добавляет пользователей как участников события."""
    for user in users:
        existing = db.query(EventParticipant).filter(
            EventParticipant.event_id == event.id,
            EventParticipant.user_id == user.id
        ).first()
        if not existing:
            ep = EventParticipant(event_id=event.id, user_id=user.id)
            db.add(ep)
    db.flush()


def _seed_evaluations(db, *, users: list[User], criteria: list[Criterion], event_id: int = None) -> None:
    rng = random.Random(42)

    # If there are already evaluations, don't duplicate.
    existing_q = db.query(Evaluation)
    if event_id:
        existing_q = existing_q.filter(Evaluation.event_id == event_id)
    existing = existing_q.count()
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
            e = Evaluation(event_id=event_id, rater_id=rater.id, target_id=target.id, comment=f"Оценка от {rater.full_name}")
            db.add(e)
            db.flush()

            for crit in criteria:
                # Используем целые числа для оценок
                max_s = int(crit.max_score)
                min_score = max(1, int(max_s * 0.5))  # минимум 50% от макс
                score = rng.randint(min_score, max_s)
                db.add(EvaluationScore(evaluation_id=e.id, criterion_id=crit.id, score=float(score)))

    # Add one intentionally anomalous score to demonstrate highlighting
    target = active_users[0]
    rater = active_users[1]
    crit = criteria[0]
    e = Evaluation(event_id=event_id, rater_id=rater.id, target_id=target.id, comment="(seed) намеренно аномальная оценка")
    db.add(e)
    db.flush()
    db.add(EvaluationScore(evaluation_id=e.id, criterion_id=crit.id, score=float(int(crit.max_score))))


def main() -> None:
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Users - расширенный список
        users = [
            _get_or_create_user(db, nickname="ivanov", full_name="Иванов Иван Иванович", group="ИС-31", password="password123"),
            _get_or_create_user(db, nickname="petrova", full_name="Петрова Анна Сергеевна", group="ИС-31", password="password123"),
            _get_or_create_user(db, nickname="sidorov", full_name="Сидоров Павел Олегович", group="ИС-31", password="password123"),
            _get_or_create_user(db, nickname="smirnova", full_name="Смирнова Мария Ильинична", group="ИС-32", password="password123"),
            _get_or_create_user(db, nickname="kuznetsov", full_name="Кузнецов Артём Денисович", group="ИС-32", password="password123"),
            _get_or_create_user(db, nickname="volkova", full_name="Волкова Екатерина Павловна", group="ИС-32", password="password123"),
            # Дополнительные пользователи
            _get_or_create_user(db, nickname="kozlov", full_name="Козлов Дмитрий Александрович", group="ИМ-31", password="password123"),
            _get_or_create_user(db, nickname="morozova", full_name="Морозова Ольга Викторовна", group="ИМ-31", password="password123"),
            _get_or_create_user(db, nickname="novikov", full_name="Новиков Алексей Игоревич", group="ИМ-32", password="password123"),
            _get_or_create_user(db, nickname="fedorova", full_name="Фёдорова Елена Андреевна", group="ИМ-32", password="password123"),
            _get_or_create_user(db, nickname="sokolov", full_name="Соколов Михаил Петрович", group="ПИ-31", password="password123"),
            _get_or_create_user(db, nickname="lebedeva", full_name="Лебедева Наталья Сергеевна", group="ПИ-31", password="password123"),
        ]

        # Событие 1 - основное
        event1 = _get_or_create_event(db, name="Семестровая оценка 2024", description="Оценка работы студентов за осенний семестр 2024", is_active=True)

        # Событие 2 - проектная работа
        event2 = _get_or_create_event(db, name="Проектная работа IT", description="Оценка командных проектов по информационным технологиям", is_active=True)
        
        # Событие 3 - неактивное
        event3 = _get_or_create_event(db, name="Хакатон 2023", description="Прошедший хакатон по разработке приложений", is_active=False)

        # Критерии для события 1
        criteria1 = [
            _get_or_create_criterion(db, name="Качество", description="Насколько качественно выполнена работа", max_score=10, event_id=event1.id),
            _get_or_create_criterion(db, name="Сроки", description="Соблюдение сроков", max_score=10, event_id=event1.id),
            _get_or_create_criterion(db, name="Коммуникация", description="Взаимодействие в команде", max_score=10, event_id=event1.id),
        ]

        # Критерии для события 2
        criteria2 = [
            _get_or_create_criterion(db, name="Техническая реализация", description="Качество кода и архитектуры", max_score=10, event_id=event2.id),
            _get_or_create_criterion(db, name="Презентация", description="Качество защиты проекта", max_score=10, event_id=event2.id),
            _get_or_create_criterion(db, name="Инновационность", description="Оригинальность решения", max_score=10, event_id=event2.id),
            _get_or_create_criterion(db, name="Работа в команде", description="Вклад в командную работу", max_score=10, event_id=event2.id),
        ]

        # Критерии для события 3 (хакатон)
        criteria3 = [
            _get_or_create_criterion(db, name="Креативность", description="Оригинальность идеи", max_score=10, event_id=event3.id),
            _get_or_create_criterion(db, name="Реализация", description="Техническая реализация за ограниченное время", max_score=10, event_id=event3.id),
        ]

        # Добавляем пользователей как участников событий
        _add_users_to_event(db, users=users[:6], event=event1)  # Первые 6 в событие 1
        _add_users_to_event(db, users=users[4:10], event=event2)  # Средние 6 в событие 2
        _add_users_to_event(db, users=users[6:], event=event3)  # Последние в хакатон

        _seed_evaluations(db, users=users[:6], criteria=[c for c in criteria1 if c.active], event_id=event1.id)
        _seed_evaluations(db, users=users[4:10], criteria=[c for c in criteria2 if c.active], event_id=event2.id)

        db.commit()
        print("OK: DB initialized and seeded")
        print(f"\nСобытия:")
        print(f"  1. {event1.name} (ID: {event1.id}) - активно")
        print(f"  2. {event2.name} (ID: {event2.id}) - активно")
        print(f"  3. {event3.name} (ID: {event3.id}) - неактивно")
        print(f"\nПользователей: {len(users)}")
        print(f"\nТестовые аккаунты:")
        print(f"  ivanov / password123 (ИС-31)")
        print(f"  petrova / password123 (ИС-31)")
        print(f"  kozlov / password123 (ИМ-31)")
        print(f"  novikov / password123 (ИМ-32)")
    finally:
        db.close()


if __name__ == "__main__":
    main()

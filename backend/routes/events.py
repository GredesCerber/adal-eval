from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import write_audit
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import Criterion, Event, EventParticipant, User
from ..schemas import (
    CriterionCreate,
    CriterionPublic,
    EventCreate,
    EventParticipantPublic,
    EventPublic,
    EventUpdate,
    EventWithParticipation,
)


router = APIRouter(prefix="/api/events", tags=["events"])


# ==================== Пользовательские эндпоинты ====================

@router.get("", response_model=list[EventWithParticipation])
def list_events(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    active_only: bool = True,
):
    """Получить список событий с информацией о прикреплении текущего пользователя."""
    q = db.query(Event)
    if active_only:
        q = q.filter(Event.is_active.is_(True))
    q = q.order_by(Event.created_at.desc())
    
    events = q.all()
    
    # Получаем ID событий, к которым прикреплён пользователь
    joined_ids = set(
        ep.event_id for ep in db.query(EventParticipant)
        .filter(EventParticipant.user_id == current.id)
        .all()
    )
    
    # Подсчёт участников для каждого события
    counts = dict(
        db.query(EventParticipant.event_id, func.count(EventParticipant.id))
        .group_by(EventParticipant.event_id)
        .all()
    )
    
    return [
        EventWithParticipation(
            id=e.id,
            name=e.name,
            description=e.description or "",
            is_active=e.is_active,
            is_joined=e.id in joined_ids,
            participants_count=counts.get(e.id, 0),
            created_at=e.created_at,
        )
        for e in events
    ]


@router.get("/{event_id}", response_model=EventPublic)
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Получить событие по ID."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    return EventPublic(
        id=event.id,
        name=event.name,
        description=event.description or "",
        is_active=event.is_active,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


@router.post("/{event_id}/join", response_model=dict)
def join_event(
    event_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Прикрепиться к событию."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    if not event.is_active:
        raise HTTPException(status_code=400, detail="Событие неактивно")
    
    existing = db.query(EventParticipant).filter(
        EventParticipant.event_id == event_id,
        EventParticipant.user_id == current.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Вы уже прикреплены к этому событию")
    
    participant = EventParticipant(event_id=event_id, user_id=current.id)
    db.add(participant)
    db.commit()
    
    return {"ok": True, "message": "Вы успешно прикреплены к событию"}


@router.post("/{event_id}/leave", response_model=dict)
def leave_event(
    event_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Открепиться от события."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    participant = db.query(EventParticipant).filter(
        EventParticipant.event_id == event_id,
        EventParticipant.user_id == current.id
    ).first()
    if not participant:
        raise HTTPException(status_code=400, detail="Вы не прикреплены к этому событию")
    
    db.delete(participant)
    db.commit()
    
    return {"ok": True, "message": "Вы успешно откреплены от события"}


@router.get("/{event_id}/participants", response_model=list[EventParticipantPublic])
def get_event_participants(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Получить список участников события."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    participants = db.query(EventParticipant).filter(
        EventParticipant.event_id == event_id
    ).all()
    
    return [
        EventParticipantPublic(
            id=p.id,
            user_id=p.user.id,
            full_name=p.user.full_name,
            nickname=p.user.nickname,
            group=p.user.group,
            joined_at=p.created_at,
        )
        for p in participants
    ]


@router.get("/{event_id}/criteria", response_model=list[CriterionPublic])
def get_event_criteria(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    active_only: bool = True,
):
    """Получить критерии для события."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    q = db.query(Criterion).filter(Criterion.event_id == event_id)
    if active_only:
        q = q.filter(Criterion.active.is_(True))
    q = q.order_by(Criterion.id.asc())
    
    return [
        CriterionPublic(
            id=c.id,
            event_id=c.event_id,
            name=c.name,
            description=c.description or "",
            max_score=float(c.max_score),
            active=bool(c.active),
        )
        for c in q.all()
    ]


# ==================== Админские эндпоинты ====================

admin_router = APIRouter(prefix="/api/admin/events", tags=["admin-events"])


@admin_router.get("", response_model=list[dict])
def admin_list_events(
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: получить все события с подсчётом участников."""
    events = db.query(Event).order_by(Event.created_at.desc()).all()
    
    # Подсчёт участников
    counts = dict(
        db.query(EventParticipant.event_id, func.count(EventParticipant.id))
        .group_by(EventParticipant.event_id)
        .all()
    )
    
    return [
        {
            "id": e.id,
            "name": e.name,
            "description": e.description or "",
            "is_active": e.is_active,
            "participants_count": counts.get(e.id, 0),
            "created_at": e.created_at,
            "updated_at": e.updated_at,
        }
        for e in events
    ]


@admin_router.post("", response_model=dict)
def admin_create_event(
    payload: EventCreate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: создать событие."""
    event = Event(
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        is_active=payload.is_active,
    )
    db.add(event)
    db.flush()
    
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="create",
        entity_type="event",
        entity_id=event.id,
        after={"name": event.name, "is_active": event.is_active},
        ip=ip,
    )
    db.commit()
    db.refresh(event)
    return {"id": event.id}


@admin_router.patch("/{event_id}", response_model=dict)
def admin_update_event(
    event_id: int,
    payload: EventUpdate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: обновить событие."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    before = {"name": event.name, "description": event.description, "is_active": event.is_active}
    
    if payload.name is not None:
        event.name = payload.name.strip()
    if payload.description is not None:
        event.description = payload.description.strip()
    if payload.is_active is not None:
        event.is_active = payload.is_active
    
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="update",
        entity_type="event",
        entity_id=event.id,
        before=before,
        after={"name": event.name, "description": event.description, "is_active": event.is_active},
        ip=ip,
    )
    db.add(event)
    db.commit()
    return {"ok": True}


@admin_router.delete("/{event_id}", response_model=dict)
def admin_delete_event(
    event_id: int,
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: удалить событие."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    before = {"name": event.name}
    db.delete(event)
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="delete",
        entity_type="event",
        entity_id=event_id,
        before=before,
        after=None,
        ip=ip,
    )
    db.commit()
    return {"ok": True}


@admin_router.get("/{event_id}/participants", response_model=list[EventParticipantPublic])
def admin_get_event_participants(
    event_id: int,
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: получить участников события."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    participants = db.query(EventParticipant).filter(
        EventParticipant.event_id == event_id
    ).all()
    
    return [
        EventParticipantPublic(
            id=p.id,
            user_id=p.user.id,
            full_name=p.user.full_name,
            nickname=p.user.nickname,
            group=p.user.group,
            joined_at=p.created_at,
        )
        for p in participants
    ]


@admin_router.delete("/{event_id}/participants/{user_id}", response_model=dict)
def admin_remove_participant(
    event_id: int,
    user_id: int,
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: удалить участника из события."""
    participant = db.query(EventParticipant).filter(
        EventParticipant.event_id == event_id,
        EventParticipant.user_id == user_id
    ).first()
    if not participant:
        raise HTTPException(status_code=404, detail="Участник не найден")
    
    db.delete(participant)
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="remove_participant",
        entity_type="event_participant",
        entity_id=participant.id,
        before={"event_id": event_id, "user_id": user_id},
        after=None,
        ip=ip,
    )
    db.commit()
    return {"ok": True}


@admin_router.post("/{event_id}/criteria", response_model=dict)
def admin_create_event_criterion(
    event_id: int,
    payload: CriterionCreate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Админ: добавить критерий к событию."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    criterion = Criterion(
        event_id=event_id,
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        max_score=float(payload.max_score),
        active=bool(payload.active),
    )
    db.add(criterion)
    db.flush()
    
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="create",
        entity_type="criterion",
        entity_id=criterion.id,
        after={"event_id": event_id, "name": criterion.name, "max_score": float(criterion.max_score)},
        ip=ip,
    )
    db.commit()
    return {"id": criterion.id}

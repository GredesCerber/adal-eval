from __future__ import annotations

import csv
import io
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_current_user
from ..models import Criterion, Evaluation, EvaluationScore, Event, User, normalize_full_name, normalize_group
from ..schemas import (
    ChangePasswordRequest,
    CreateEvaluationRequest,
    CriterionPublic,
    EvaluationPublic,
    ResultsRow,
    ResultsDetailRow,
    UserPublic,
    UserSelfUpdate,
)
from ..security import create_access_token, hash_password, verify_password
from ..services import clamp_score, evaluation_to_dict, get_stats_for_target


router = APIRouter(prefix="/api", tags=["user"])


def _compute_results(
    *,
    db: Session,
    event_id: Optional[int] = None,
    q: Optional[str] = None,
    group: Optional[str] = None,
    sort: str = "name",
    order: str = "asc",
) -> list[ResultsRow]:
    """
    Вычисляет итоговую таблицу с агрегацией по нормализованному ФИО.
    
    Для каждого уникального ФИО (нормализованного):
    - Средний ИТОГО = avg по суммарным баллам всех оценок
    - Количество оценщиков = COUNT DISTINCT rater_id
    """
    from ..config import settings

    # Получаем критерии (с фильтром по событию если указано)
    criteria_q = db.query(Criterion).filter(Criterion.active.is_(True))
    if event_id:
        criteria_q = criteria_q.filter(Criterion.event_id == event_id)
    criteria = criteria_q.order_by(Criterion.id.asc()).all()
    criteria_by_id = {c.id: c for c in criteria}

    if not criteria_by_id:
        return []

    # Базовый запрос для оценок
    evals_base = db.query(Evaluation).options(
        joinedload(Evaluation.target),
        joinedload(Evaluation.scores).joinedload(EvaluationScore.criterion)
    )
    if event_id:
        evals_base = evals_base.filter(Evaluation.event_id == event_id)

    # Фильтр по группе
    if group:
        group_clean = normalize_group(group)
        # Для зарегистрированных пользователей
        user_ids_by_group = [
            u.id for u in db.query(User).filter(
                func.replace(User.group, " ", "").ilike(f"%{group_clean}%")
            ).all()
        ]
        evals_base = evals_base.filter(Evaluation.target_id.in_(user_ids_by_group) if user_ids_by_group else False)

    all_evals = evals_base.all()

    # Группируем по нормализованному ФИО
    # Ключ: normalized_name -> { display_name, student_id, group, evaluations }
    grouped: dict[str, dict] = defaultdict(lambda: {
        "display_name": "",
        "student_id": None,
        "group": "",
        "evaluations": [],
        "raters": set(),
    })

    for e in all_evals:
        # Определяем ФИО участника
        if e.target:
            full_name = e.target.full_name
            student_id = e.target.id
            student_group = e.target.group
        elif e.target_name:
            full_name = e.target_name
            student_id = None
            student_group = ""
        else:
            continue

        normalized = normalize_full_name(full_name)
        
        # Фильтр по поиску
        if q:
            q_lower = q.strip().lower()
            if q_lower not in normalized and q_lower not in full_name.lower():
                continue

        data = grouped[normalized]
        if not data["display_name"]:
            data["display_name"] = full_name
            data["student_id"] = student_id
            data["group"] = student_group

        data["evaluations"].append(e)
        data["raters"].add(e.rater_id)

    # Формируем результаты
    out: list[ResultsRow] = []
    
    for normalized, data in grouped.items():
        evals = data["evaluations"]
        if not evals:
            continue

        # Вычисляем средние по критериям и суммарные баллы
        crit_scores: dict[int, list[float]] = defaultdict(list)
        total_scores: list[float] = []

        for e in evals:
            eval_total = 0.0
            for s in e.scores:
                if s.criterion_id in criteria_by_id:
                    crit_scores[s.criterion_id].append(float(s.score))
                    eval_total += float(s.score)
            if e.scores:
                total_scores.append(eval_total)

        # Средние по критериям
        crit_map: dict[str, Optional[float]] = {}
        for cid, c in criteria_by_id.items():
            scores = crit_scores.get(cid, [])
            crit_map[c.name] = (sum(scores) / len(scores)) if scores else None

        # Средний ИТОГО
        overall_mean = (sum(total_scores) / len(total_scores)) if total_scores else None

        # Подсчёт аномалий
        anomaly_count = 0
        if data["student_id"]:
            stats = get_stats_for_target(db, target_id=data["student_id"])
            for e in evals:
                for s in e.scores:
                    stat = stats.get(int(s.criterion_id))
                    if not stat or stat.n < settings.anomaly_min_samples or stat.stdev <= 0:
                        continue
                    z = (float(s.score) - stat.mean) / stat.stdev
                    if abs(z) >= settings.anomaly_zscore:
                        anomaly_count += 1

        out.append(
            ResultsRow(
                normalized_name=normalized,
                display_name=data["display_name"],
                student_id=data["student_id"],
                student_full_name=data["display_name"],
                group=data["group"],
                criteria=crit_map,
                overall_mean=overall_mean,
                raters_count=len(data["raters"]),
                anomaly_count=anomaly_count,
            )
        )

    reverse = order.lower() == "desc"
    if sort == "overall":
        out.sort(key=lambda r: (r.overall_mean is None, r.overall_mean or 0), reverse=reverse)
    elif sort == "anomalies":
        out.sort(key=lambda r: r.anomaly_count, reverse=reverse)
    elif sort == "raters":
        out.sort(key=lambda r: r.raters_count, reverse=reverse)
    else:
        out.sort(key=lambda r: r.student_full_name.lower(), reverse=reverse)

    return out


def _get_results_detail(
    db: Session,
    normalized_name: str,
    event_id: Optional[int] = None,
) -> list[ResultsDetailRow]:
    """Получить детальные оценки для конкретного ФИО."""
    evals_q = db.query(Evaluation).options(
        joinedload(Evaluation.rater),
        joinedload(Evaluation.target),
        joinedload(Evaluation.scores).joinedload(EvaluationScore.criterion)
    )
    
    if event_id:
        evals_q = evals_q.filter(Evaluation.event_id == event_id)
    
    all_evals = evals_q.all()
    
    out: list[ResultsDetailRow] = []
    for e in all_evals:
        # Определяем ФИО
        if e.target:
            full_name = e.target.full_name
        elif e.target_name:
            full_name = e.target_name
        else:
            continue
        
        if normalize_full_name(full_name) != normalized_name:
            continue
        
        scores_dict: dict[str, float] = {}
        total = 0.0
        for s in e.scores:
            scores_dict[s.criterion.name] = float(s.score)
            total += float(s.score)
        
        out.append(ResultsDetailRow(
            evaluation_id=e.id,
            rater_id=e.rater_id,
            rater_full_name=e.rater.full_name,
            scores=scores_dict,
            total_score=total,
            comment=e.comment or "",
            created_at=e.created_at,
        ))
    
    out.sort(key=lambda r: r.created_at, reverse=True)
    return out


@router.get("/me", response_model=UserPublic)
def me(current: User = Depends(get_current_user)):
    return UserPublic(
        id=current.id,
        nickname=current.nickname,
        full_name=current.full_name,
        group=current.group,
        created_at=current.created_at,
    )


@router.post("/me/password", response_model=dict)
def change_password(payload: ChangePasswordRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    if not verify_password(payload.old_password, current.password_hash):
        raise HTTPException(status_code=400, detail="Старый пароль указан неверно")
    current.password_hash = hash_password(payload.new_password)
    db.add(current)
    db.commit()
    return {"ok": True}


@router.patch("/me", response_model=dict)
def update_me(payload: UserSelfUpdate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    changed = False

    if payload.nickname is not None:
        new_nick = payload.nickname.strip()
        if not new_nick:
            raise HTTPException(status_code=400, detail="Никнейм не может быть пустым")
        other = db.query(User).filter(User.nickname == new_nick, User.id != current.id).first()
        if other:
            raise HTTPException(status_code=400, detail="Никнейм уже занят")
        current.nickname = new_nick
        changed = True

    if payload.full_name is not None:
        new_full = payload.full_name.strip()
        if not new_full:
            raise HTTPException(status_code=400, detail="ФИО не может быть пустым")
        current.full_name = new_full
        changed = True

    if payload.group is not None:
        new_group = payload.group.replace(" ", "").strip()
        if not new_group:
            raise HTTPException(status_code=400, detail="Группа не может быть пустой")
        current.group = new_group
        changed = True

    if not changed:
        return {
            "user": UserPublic(
                id=current.id,
                nickname=current.nickname,
                full_name=current.full_name,
                group=current.group,
                created_at=current.created_at,
            )
        }

    db.add(current)
    db.commit()
    db.refresh(current)

    new_token = create_access_token(subject=current.nickname)

    return {
        "user": UserPublic(
            id=current.id,
            nickname=current.nickname,
            full_name=current.full_name,
            group=current.group,
            created_at=current.created_at,
        ),
        "access_token": new_token,
        "token_type": "bearer",
    }


@router.get("/criteria", response_model=list[CriterionPublic])
def list_criteria(
    active_only: bool = True, 
    event_id: Optional[int] = None,
    db: Session = Depends(get_db), 
    _: User = Depends(get_current_user)
):
    """Получить критерии. Можно фильтровать по событию."""
    q = db.query(Criterion)
    if active_only:
        q = q.filter(Criterion.active.is_(True))
    if event_id:
        q = q.filter(Criterion.event_id == event_id)
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


@router.get("/students", response_model=list[UserPublic])
def list_students(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    q: Optional[str] = Query(default=None, description="search by nickname/full name"),
    group: Optional[str] = None,
):
    query = db.query(User).filter(User.is_active.is_(True), User.id != current.id)
    if group:
        group_clean = group.replace(" ", "")
        query = query.filter(func.replace(User.group, " ", "").ilike(f"%{group_clean}%"))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.full_name.ilike(like)) | (User.nickname.ilike(like)))
    query = query.order_by(User.full_name.asc())

    return [
        UserPublic(
            id=u.id,
            nickname=u.nickname,
            full_name=u.full_name,
            group=u.group,
            created_at=u.created_at,
        )
        for u in query.all()
    ]


@router.get("/students/{target_id}/evaluations", response_model=list[EvaluationPublic])
def student_evaluations(target_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    target = db.query(User).filter(User.id == target_id, User.is_active.is_(True)).first()
    if not target:
        raise HTTPException(status_code=404, detail="Студент не найден")

    stats = get_stats_for_target(db, target_id=target_id)
    # keep only latest evaluation per rater to avoid clutter
    evals_all = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.rater), joinedload(Evaluation.scores).joinedload(EvaluationScore.criterion))
        .filter(Evaluation.target_id == target_id)
        .order_by(Evaluation.created_at.desc())
        .all()
    )

    seen_raters: set[int] = set()
    evals: list[Evaluation] = []
    for e in evals_all:
        rid = int(e.rater_id)
        if rid in seen_raters:
            continue
        seen_raters.add(rid)
        evals.append(e)

    return [EvaluationPublic(**evaluation_to_dict(e, stats=stats)) for e in evals]


@router.post("/students/{target_id}/evaluate", response_model=dict)
def create_evaluation(target_id: int, payload: CreateEvaluationRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    if target_id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя оценивать самого себя")

    target = db.query(User).filter(User.id == target_id, User.is_active.is_(True)).first()
    if not target:
        raise HTTPException(status_code=404, detail="Студент не найден")

    # Проверка события (если указано)
    event_id = payload.event_id
    if event_id:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Событие не найдено")
        if not event.is_active:
            raise HTTPException(status_code=400, detail="Событие неактивно. Нельзя выставлять оценки.")

    # Получаем критерии (с фильтром по событию если указано)
    criteria_q = db.query(Criterion).filter(Criterion.active.is_(True))
    if event_id:
        criteria_q = criteria_q.filter(Criterion.event_id == event_id)
    active_criteria = {c.id: c for c in criteria_q.all()}
    
    if not active_criteria:
        raise HTTPException(status_code=400, detail="Нет активных критериев")

    # Проверяем, что все оценки не превышают max_score
    for item in payload.scores:
        crit = active_criteria.get(item.criterion_id)
        if crit and item.score > int(crit.max_score):
            raise HTTPException(
                status_code=400, 
                detail=f"Оценка по критерию '{crit.name}' превышает максимум ({int(crit.max_score)})"
            )

    # If the user already evaluated this target, update their latest evaluation instead of creating a new one.
    # Also delete older duplicates (legacy data).
    existing_q = db.query(Evaluation).options(joinedload(Evaluation.scores)).filter(
        Evaluation.rater_id == current.id, 
        Evaluation.target_id == target_id
    )
    if event_id:
        existing_q = existing_q.filter(Evaluation.event_id == event_id)
    existing = existing_q.order_by(Evaluation.created_at.desc()).all()

    eval_row: Evaluation
    if existing:
        eval_row = existing[0]
        # purge older duplicates
        for old in existing[1:]:
            db.delete(old)
        eval_row.comment = (payload.comment or "").strip()
        db.add(eval_row)
        db.flush()
    else:
        eval_row = Evaluation(
            event_id=event_id,
            rater_id=current.id, 
            target_id=target_id, 
            comment=(payload.comment or "").strip()
        )
        db.add(eval_row)
        db.flush()  # get eval_row.id

    existing_scores = {int(s.criterion_id): s for s in (eval_row.scores or [])}

    seen: set[int] = set()
    for item in payload.scores:
        cid = int(item.criterion_id)
        if cid in seen:
            continue
        seen.add(cid)
        crit = active_criteria.get(cid)
        if not crit:
            continue

        max_int = int(float(crit.max_score))
        val = int(item.score)
        if val < 0:
            val = 0
        if val > max_int:
            val = max_int

        if cid in existing_scores:
            existing_scores[cid].score = float(val)
            db.add(existing_scores[cid])
        else:
            db.add(EvaluationScore(evaluation_id=eval_row.id, criterion_id=cid, score=float(val)))

    db.commit()
    return {"id": eval_row.id, "updated": bool(existing)}


@router.post("/events/{event_id}/evaluate", response_model=dict)
def create_event_evaluation(
    event_id: int,
    payload: CreateEvaluationRequest,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user)
):
    """
    Оценить участника в рамках события.
    Можно оценивать как зарегистрированных пользователей (target_id в URL), 
    так и внешних участников (target_name в payload).
    """
    # Проверка события
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    if not event.is_active:
        raise HTTPException(status_code=400, detail="Событие неактивно. Нельзя выставлять оценки.")

    # Получаем критерии события
    active_criteria = {c.id: c for c in db.query(Criterion).filter(
        Criterion.event_id == event_id,
        Criterion.active.is_(True)
    ).all()}
    
    if not active_criteria:
        raise HTTPException(status_code=400, detail="Нет активных критериев для этого события")

    # Проверяем, что все оценки не превышают max_score
    for item in payload.scores:
        crit = active_criteria.get(item.criterion_id)
        if crit and item.score > int(crit.max_score):
            raise HTTPException(
                status_code=400, 
                detail=f"Оценка по критерию '{crit.name}' превышает максимум ({int(crit.max_score)})"
            )

    # Определяем участника
    target_name = (payload.target_name or "").strip()
    target_name_normalized = normalize_full_name(target_name) if target_name else None

    if not target_name:
        raise HTTPException(status_code=400, detail="Укажите ФИО участника (target_name)")

    # Нельзя оценивать себя
    if target_name_normalized and normalize_full_name(current.full_name) == target_name_normalized:
        raise HTTPException(status_code=400, detail="Нельзя оценивать самого себя")

    # Ищем существующую оценку для этого участника от этого оценщика в этом событии
    existing_q = db.query(Evaluation).options(joinedload(Evaluation.scores)).filter(
        Evaluation.event_id == event_id,
        Evaluation.rater_id == current.id,
        Evaluation.target_name_normalized == target_name_normalized
    )
    existing = existing_q.order_by(Evaluation.created_at.desc()).all()

    eval_row: Evaluation
    if existing:
        eval_row = existing[0]
        for old in existing[1:]:
            db.delete(old)
        eval_row.comment = (payload.comment or "").strip()
        eval_row.target_name = target_name  # Обновляем на случай изменения регистра
        db.add(eval_row)
        db.flush()
    else:
        eval_row = Evaluation(
            event_id=event_id,
            rater_id=current.id,
            target_id=None,  # Внешний участник
            target_name=target_name,
            target_name_normalized=target_name_normalized,
            comment=(payload.comment or "").strip()
        )
        db.add(eval_row)
        db.flush()

    existing_scores = {int(s.criterion_id): s for s in (eval_row.scores or [])}

    seen: set[int] = set()
    for item in payload.scores:
        cid = int(item.criterion_id)
        if cid in seen:
            continue
        seen.add(cid)
        crit = active_criteria.get(cid)
        if not crit:
            continue

        max_int = int(float(crit.max_score))
        val = int(item.score)
        if val < 0:
            val = 0
        if val > max_int:
            val = max_int

        if cid in existing_scores:
            existing_scores[cid].score = float(val)
            db.add(existing_scores[cid])
        else:
            db.add(EvaluationScore(evaluation_id=eval_row.id, criterion_id=cid, score=float(val)))

    db.commit()
    return {"id": eval_row.id, "updated": bool(existing)}


@router.get("/results", response_model=list[ResultsRow])
def results(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    event_id: Optional[int] = None,
    q: Optional[str] = None,
    group: Optional[str] = None,
    sort: str = "name",
    order: str = "asc",
):
    """
    Итоговая таблица с агрегацией по нормализованному ФИО.
    
    Каждая строка — уникальное ФИО:
    - overall_mean: средний ИТОГО (avg по суммарным баллам)
    - raters_count: количество уникальных оценщиков
    """
    return _compute_results(db=db, event_id=event_id, q=q, group=group, sort=sort, order=order)


@router.get("/results/detail", response_model=list[ResultsDetailRow])
def results_detail(
    normalized_name: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    event_id: Optional[int] = None,
):
    """
    Детальные оценки для конкретного ФИО (раскрытие строки).
    Возвращает все отдельные оценки/оценщиков.
    """
    return _get_results_detail(db, normalized_name, event_id)


@router.get("/results/export/csv")
def export_csv(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    data = _compute_results(db=db)

    output = io.StringIO()
    writer = csv.writer(output)
    if not data:
        writer.writerow(["student", "group", "overall_mean", "anomaly_count"])
    else:
        # dynamic criteria headers
        criteria_headers = list(data[0].criteria.keys())
        writer.writerow(["student", "group", *criteria_headers, "overall_mean", "anomaly_count"])
        for row in data:
            writer.writerow(
                [
                    row.student_full_name,
                    row.group,
                    *[(row.criteria.get(h) if row.criteria.get(h) is not None else "") for h in criteria_headers],
                    row.overall_mean if row.overall_mean is not None else "",
                    row.anomaly_count,
                ]
            )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=results.csv"},
    )


@router.get("/results/export/xlsx")
def export_xlsx(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    data = _compute_results(db=db)

    wb = Workbook()
    ws = wb.active
    ws.title = "Results"

    if not data:
        ws.append(["student", "group", "overall_mean", "anomaly_count"])
    else:
        criteria_headers = list(data[0].criteria.keys())
        ws.append(["student", "group", *criteria_headers, "overall_mean", "anomaly_count"])
        for row in data:
            ws.append(
                [
                    row.student_full_name,
                    row.group,
                    *[(row.criteria.get(h) if row.criteria.get(h) is not None else None) for h in criteria_headers],
                    row.overall_mean,
                    row.anomaly_count,
                ]
            )

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=results.xlsx"},
    )

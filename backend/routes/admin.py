from __future__ import annotations

import io
import csv
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from ..audit import write_audit
from ..config import settings
from ..database import get_db
from ..deps import require_admin
from ..models import Criterion, Evaluation, EvaluationScore, User
from ..schemas import (
    AdminEvaluationPatch,
    AdminScorePatch,
    AuditLogRow,
    CriterionCreate,
    CriterionPublic,
    CriterionUpdate,
    UserAdminCreate,
    UserAdminUpdate,
)
from ..security import hash_password
from ..services import clamp_score, get_stats_for_target


# We avoid router-level dependencies so we can both protect endpoints and
# reuse the returned admin IP without calling `require_admin` twice.
router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=dict)
def admin_list_users(
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
    q: Optional[str] = None,
    group: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
):
    query = db.query(User)
    if group:
        query = query.filter(User.group == group)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.full_name.ilike(like)) | (User.nickname.ilike(like)))

    total = query.count()
    items = query.order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": u.id,
                "nickname": u.nickname,
                "full_name": u.full_name,
                "group": u.group,
                "created_at": u.created_at,
                "is_active": u.is_active,
            }
            for u in items
        ],
    }


@router.post("/users", response_model=dict)
def admin_create_user(
    payload: UserAdminCreate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.nickname == payload.nickname).first():
        raise HTTPException(status_code=400, detail="Никнейм уже занят")

    u = User(
        nickname=payload.nickname.strip(),
        full_name=payload.full_name.strip(),
        group=payload.group.replace(" ", "").strip(),
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(u)
    db.flush()
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="create",
        entity_type="user",
        entity_id=u.id,
        after={"nickname": u.nickname, "full_name": u.full_name, "group": u.group},
        ip=ip,
    )
    db.commit()
    db.refresh(u)
    return {"id": u.id}


@router.patch("/users/{user_id}", response_model=dict)
def admin_update_user(
    user_id: int,
    payload: UserAdminUpdate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    before = {"nickname": u.nickname, "full_name": u.full_name, "group": u.group, "is_active": u.is_active}
    if payload.nickname is not None:
        other = db.query(User).filter(User.nickname == payload.nickname, User.id != user_id).first()
        if other:
            raise HTTPException(status_code=400, detail="Никнейм уже занят")
        u.nickname = payload.nickname.strip()
    if payload.full_name is not None:
        u.full_name = payload.full_name.strip()
    if payload.group is not None:
        u.group = payload.group.replace(" ", "").strip()
    if payload.is_active is not None:
        u.is_active = bool(payload.is_active)

    write_audit(db, actor_type="admin", actor_user_id=None, action="update", entity_type="user", entity_id=u.id, before=before, after={"nickname": u.nickname, "full_name": u.full_name, "group": u.group, "is_active": u.is_active}, ip=ip)
    db.add(u)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/reset-password", response_model=dict)
def admin_reset_password(user_id: int, ip: str = Depends(require_admin), db: Session = Depends(get_db), new_password: str = Query(min_length=6, max_length=128)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    before = {"nickname": u.nickname}
    u.password_hash = hash_password(new_password)
    write_audit(db, actor_type="admin", actor_user_id=None, action="reset_password", entity_type="user", entity_id=u.id, before=before, after={"nickname": u.nickname}, ip=ip)
    db.add(u)
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}", response_model=dict)
def admin_delete_user(user_id: int, ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    before = {"nickname": u.nickname}
    db.delete(u)
    write_audit(db, actor_type="admin", actor_user_id=None, action="delete", entity_type="user", entity_id=user_id, before=before, after=None, ip=ip)
    db.commit()
    return {"ok": True}


@router.get("/criteria", response_model=list[CriterionPublic])
def admin_list_criteria(ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    items = db.query(Criterion).order_by(Criterion.id.asc()).all()
    return [CriterionPublic(id=c.id, name=c.name, description=c.description or "", max_score=float(c.max_score), active=bool(c.active)) for c in items]


@router.post("/criteria", response_model=dict)
def admin_create_criteria(
    payload: CriterionCreate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(Criterion).filter(Criterion.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Название критерия уже существует")
    c = Criterion(name=payload.name.strip(), description=(payload.description or "").strip(), max_score=float(payload.max_score), active=bool(payload.active))
    db.add(c)
    db.flush()
    write_audit(db, actor_type="admin", actor_user_id=None, action="create", entity_type="criterion", entity_id=c.id, after={"name": c.name, "max_score": float(c.max_score), "active": bool(c.active)}, ip=ip)
    db.commit()
    return {"id": c.id}


@router.patch("/criteria/{criterion_id}", response_model=dict)
def admin_update_criteria(
    criterion_id: int,
    payload: CriterionUpdate = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    c = db.query(Criterion).filter(Criterion.id == criterion_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Критерий не найден")

    before = {"name": c.name, "description": c.description, "max_score": float(c.max_score), "active": bool(c.active)}

    if payload.name is not None:
        other = db.query(Criterion).filter(Criterion.name == payload.name, Criterion.id != criterion_id).first()
        if other:
            raise HTTPException(status_code=400, detail="Название критерия уже существует")
        c.name = payload.name.strip()
    if payload.description is not None:
        c.description = payload.description.strip()
    if payload.max_score is not None:
        c.max_score = float(payload.max_score)
    if payload.active is not None:
        c.active = bool(payload.active)

    write_audit(db, actor_type="admin", actor_user_id=None, action="update", entity_type="criterion", entity_id=c.id, before=before, after={"name": c.name, "description": c.description, "max_score": float(c.max_score), "active": bool(c.active)}, ip=ip)
    db.add(c)
    db.commit()
    return {"ok": True}


@router.delete("/criteria/{criterion_id}", response_model=dict)
def admin_delete_criteria(criterion_id: int, ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.query(Criterion).filter(Criterion.id == criterion_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Критерий не найден")

    # Hard-delete: remove all scores for this criterion first, then delete the criterion.
    # This enables replacing criteria sets cleanly.
    deleted_scores = (
        db.query(EvaluationScore)
        .filter(EvaluationScore.criterion_id == criterion_id)
        .delete(synchronize_session=False)
    )

    before = {"name": c.name, "deleted_scores": int(deleted_scores)}
    db.delete(c)
    write_audit(db, actor_type="admin", actor_user_id=None, action="delete", entity_type="criterion", entity_id=criterion_id, before=before, after=None, ip=ip)
    db.commit()
    return {"ok": True, "deleted_scores": int(deleted_scores)}


@router.get("/evaluations", response_model=dict)
def admin_list_evaluations(
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
    target_id: Optional[int] = None,
    rater_id: Optional[int] = None,
    criterion_id: Optional[int] = None,
    anomaly_only: bool = False,
    limit: int = 300,
    offset: int = 0,
):
    q = (
        db.query(EvaluationScore)
        .options(
            joinedload(EvaluationScore.evaluation).joinedload(Evaluation.rater),
            joinedload(EvaluationScore.evaluation).joinedload(Evaluation.target),
            joinedload(EvaluationScore.criterion),
        )
        .join(Evaluation, Evaluation.id == EvaluationScore.evaluation_id)
        .join(Criterion, Criterion.id == EvaluationScore.criterion_id)
    )
    if target_id is not None:
        q = q.filter(Evaluation.target_id == target_id)
    if rater_id is not None:
        q = q.filter(Evaluation.rater_id == rater_id)
    if criterion_id is not None:
        q = q.filter(EvaluationScore.criterion_id == criterion_id)

    total = q.count()
    items = q.order_by(EvaluationScore.updated_at.desc()).offset(offset).limit(limit).all()

    # compute anomaly flag per row (per target+criterion)
    stats_cache: dict[int, dict[int, object]] = {}

    out = []
    for s in items:
        t_id = s.evaluation.target_id
        if t_id not in stats_cache:
            stats_cache[t_id] = get_stats_for_target(db, target_id=t_id, include_inactive=True)
        stat = stats_cache[t_id].get(int(s.criterion_id))
        is_anomaly = False
        z = None
        delta = None
        mean = None
        stdev = None
        if stat and getattr(stat, "n", 0) >= settings.anomaly_min_samples and getattr(stat, "stdev", 0) and stat.stdev > 0:  # type: ignore
            mean = float(stat.mean)  # type: ignore
            stdev = float(stat.stdev)  # type: ignore
            delta = float(s.score) - mean
            z = delta / stdev
            is_anomaly = abs(z) >= settings.anomaly_zscore

        if anomaly_only and not is_anomaly:
            continue

        out.append(
            {
                "score_id": s.id,
                "evaluation_id": s.evaluation_id,
                "target": s.evaluation.target.full_name,
                "rater": s.evaluation.rater.full_name,
                "criterion": s.criterion.name,
                "max_score": float(s.criterion.max_score),
                "score": float(s.score),
                "comment": s.evaluation.comment or "",
                "created_at": s.evaluation.created_at,
                "updated_at": s.updated_at,
                "mean": mean,
                "stdev": stdev,
                "z": z,
                "delta": delta,
                "is_anomaly": is_anomaly,
            }
        )

    return {"total": total, "items": out}


@router.get("/evaluations/export/xlsx")
def admin_export_evaluations_xlsx(
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
    target_id: Optional[int] = None,
    rater_id: Optional[int] = None,
    criterion_id: Optional[int] = None,
    anomaly_only: bool = False,
):
    # Reuse the same query as list but export to Excel
    q = (
        db.query(EvaluationScore)
        .options(
            joinedload(EvaluationScore.evaluation).joinedload(Evaluation.rater),
            joinedload(EvaluationScore.evaluation).joinedload(Evaluation.target),
            joinedload(EvaluationScore.criterion),
        )
        .join(Evaluation, Evaluation.id == EvaluationScore.evaluation_id)
        .join(Criterion, Criterion.id == EvaluationScore.criterion_id)
    )
    if target_id is not None:
        q = q.filter(Evaluation.target_id == target_id)
    if rater_id is not None:
        q = q.filter(Evaluation.rater_id == rater_id)
    if criterion_id is not None:
        q = q.filter(EvaluationScore.criterion_id == criterion_id)

    items = q.order_by(EvaluationScore.updated_at.desc()).all()

    stats_cache: dict[int, dict[int, object]] = {}

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Evaluations"
    ws.append(
        [
            "Target",
            "Rater",
            "Criterion",
            "Score",
            "Max",
            "Mean",
            "Delta",
            "z",
            "Anomaly",
            "Comment",
            "Created",
            "Updated",
        ]
    )

    for s in items:
        t_id = s.evaluation.target_id
        if t_id not in stats_cache:
            stats_cache[t_id] = get_stats_for_target(db, target_id=t_id, include_inactive=True)
        stat = stats_cache[t_id].get(int(s.criterion_id))

        mean = stat.mean if stat else None  # type: ignore
        stdev = stat.stdev if stat else None  # type: ignore
        delta = float(s.score) - mean if mean is not None else None
        z = delta / stdev if delta is not None and stdev and stdev > 0 else None
        is_anomaly = bool(z is not None and abs(z) >= settings.anomaly_zscore and stat and getattr(stat, "n", 0) >= settings.anomaly_min_samples)

        if anomaly_only and not is_anomaly:
            continue

        ws.append(
            [
                s.evaluation.target.full_name,
                s.evaluation.rater.full_name,
                s.criterion.name,
                float(s.score),
                float(s.criterion.max_score),
                mean,
                delta,
                z,
                "yes" if is_anomaly else "no",
                s.evaluation.comment or "",
                s.evaluation.created_at,
                s.updated_at,
            ]
        )

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    filename = f"evaluations-{dt.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/evaluations/export/csv")
def admin_export_evaluations_csv(
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
    target_id: Optional[int] = None,
    rater_id: Optional[int] = None,
    criterion_id: Optional[int] = None,
    anomaly_only: bool = False,
):
    q = (
        db.query(EvaluationScore)
        .options(
            joinedload(EvaluationScore.evaluation).joinedload(Evaluation.rater),
            joinedload(EvaluationScore.evaluation).joinedload(Evaluation.target),
            joinedload(EvaluationScore.criterion),
        )
        .join(Evaluation, Evaluation.id == EvaluationScore.evaluation_id)
        .join(Criterion, Criterion.id == EvaluationScore.criterion_id)
    )
    if target_id is not None:
        q = q.filter(Evaluation.target_id == target_id)
    if rater_id is not None:
        q = q.filter(Evaluation.rater_id == rater_id)
    if criterion_id is not None:
        q = q.filter(EvaluationScore.criterion_id == criterion_id)

    items = q.order_by(EvaluationScore.updated_at.desc()).all()

    stats_cache: dict[int, dict[int, object]] = {}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "target",
        "rater",
        "criterion",
        "score",
        "max",
        "mean",
        "delta",
        "z",
        "anomaly",
        "comment",
        "created",
        "updated",
    ])

    for s in items:
        t_id = s.evaluation.target_id
        if t_id not in stats_cache:
            stats_cache[t_id] = get_stats_for_target(db, target_id=t_id, include_inactive=True)
        stat = stats_cache[t_id].get(int(s.criterion_id))

        mean = stat.mean if stat else None  # type: ignore
        stdev = stat.stdev if stat else None  # type: ignore
        delta = float(s.score) - mean if mean is not None else None
        z = delta / stdev if delta is not None and stdev and stdev > 0 else None
        is_anomaly = bool(z is not None and abs(z) >= settings.anomaly_zscore and stat and getattr(stat, "n", 0) >= settings.anomaly_min_samples)

        if anomaly_only and not is_anomaly:
            continue

        writer.writerow([
            s.evaluation.target.full_name,
            s.evaluation.rater.full_name,
            s.criterion.name,
            float(s.score),
            float(s.criterion.max_score),
            mean if mean is not None else "",
            delta if delta is not None else "",
            z if z is not None else "",
            "yes" if is_anomaly else "no",
            (s.evaluation.comment or "").replace("\n", " ").strip(),
            s.evaluation.created_at.isoformat() if s.evaluation.created_at else "",
            s.updated_at.isoformat() if s.updated_at else "",
        ])

    output.seek(0)
    filename = f"evaluations-{dt.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.patch("/evaluation-scores/{score_id}", response_model=dict)
def admin_patch_score(
    score_id: int,
    payload: AdminScorePatch = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(EvaluationScore).options(joinedload(EvaluationScore.criterion)).filter(EvaluationScore.id == score_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Оценка не найдена")

    before = {"score": float(s.score)}
    s.score = clamp_score(float(payload.score), max_score=float(s.criterion.max_score))
    write_audit(db, actor_type="admin", actor_user_id=None, action="update", entity_type="evaluation_score", entity_id=s.id, before=before, after={"score": float(s.score)}, ip=ip)
    db.add(s)
    db.commit()
    return {"ok": True, "score": float(s.score)}


@router.delete("/evaluation-scores/{score_id}", response_model=dict)
def admin_delete_score(score_id: int, ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    s = db.query(EvaluationScore).filter(EvaluationScore.id == score_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    before = {"evaluation_id": s.evaluation_id, "criterion_id": s.criterion_id, "score": float(s.score)}
    db.delete(s)
    write_audit(db, actor_type="admin", actor_user_id=None, action="delete", entity_type="evaluation_score", entity_id=score_id, before=before, after=None, ip=ip)
    db.commit()
    return {"ok": True}


@router.patch("/evaluations/{evaluation_id}", response_model=dict)
def admin_patch_evaluation(
    evaluation_id: int,
    payload: AdminEvaluationPatch = Body(...),
    ip: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    e = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Оценивание не найдено")

    before = {"comment": e.comment}
    if payload.comment is not None:
        e.comment = payload.comment.strip()
    write_audit(db, actor_type="admin", actor_user_id=None, action="update", entity_type="evaluation", entity_id=e.id, before=before, after={"comment": e.comment}, ip=ip)
    db.add(e)
    db.commit()
    return {"ok": True}


@router.delete("/evaluations/{evaluation_id}", response_model=dict)
def admin_delete_evaluation(evaluation_id: int, ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    e = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Оценивание не найдено")
    before = {"rater_id": e.rater_id, "target_id": e.target_id}
    db.delete(e)
    write_audit(db, actor_type="admin", actor_user_id=None, action="delete", entity_type="evaluation", entity_id=evaluation_id, before=before, after=None, ip=ip)
    db.commit()
    return {"ok": True}


@router.delete("/evaluations/by-rater/{rater_id}/target/{target_id}", response_model=dict)
def admin_delete_by_rater(rater_id: int, target_id: int, ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    q = db.query(Evaluation).filter(Evaluation.rater_id == rater_id, Evaluation.target_id == target_id)
    count = q.count()
    q.delete(synchronize_session=False)
    write_audit(db, actor_type="admin", actor_user_id=None, action="delete_many", entity_type="evaluation", entity_id=None, before={"rater_id": rater_id, "target_id": target_id, "count": count}, after=None, ip=ip)
    db.commit()
    return {"ok": True, "deleted": count}


@router.delete("/evaluations", response_model=dict)
def admin_delete_all_evaluations(ip: str = Depends(require_admin), db: Session = Depends(get_db)):
    # Purge ALL evaluation data: scores first, then evaluation headers.
    scores_deleted = db.query(EvaluationScore).delete(synchronize_session=False)
    evals_deleted = db.query(Evaluation).delete(synchronize_session=False)
    write_audit(
        db,
        actor_type="admin",
        actor_user_id=None,
        action="delete_all",
        entity_type="evaluation",
        entity_id=None,
        before={"scores_deleted": int(scores_deleted), "evaluations_deleted": int(evals_deleted)},
        after=None,
        ip=ip,
    )
    db.commit()
    return {"ok": True, "scores_deleted": int(scores_deleted), "evaluations_deleted": int(evals_deleted)}


@router.get("/audit-logs", response_model=dict)
def admin_audit_logs(ip: str = Depends(require_admin), db: Session = Depends(get_db), limit: int = 300, offset: int = 0):
    from ..models import AuditLog

    q = db.query(AuditLog)
    total = q.count()
    items = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            AuditLogRow(
                id=a.id,
                actor_type=a.actor_type,
                actor_user_id=a.actor_user_id,
                action=a.action,
                entity_type=a.entity_type,
                entity_id=a.entity_id,
                before_json=a.before_json,
                after_json=a.after_json,
                created_at=a.created_at,
                ip=a.ip,
            ).model_dump()
            for a in items
        ],
    }

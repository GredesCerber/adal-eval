from __future__ import annotations

import csv
import io
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import get_current_user
from ..models import Criterion, Evaluation, EvaluationScore, User
from ..schemas import (
    ChangePasswordRequest,
    CreateEvaluationRequest,
    CriterionPublic,
    EvaluationPublic,
    ResultsRow,
    UserPublic,
)
from ..security import hash_password, verify_password
from ..services import clamp_score, evaluation_to_dict, get_stats_for_target


router = APIRouter(prefix="/api", tags=["user"])


def _compute_results(
    *,
    db: Session,
    q: Optional[str] = None,
    group: Optional[str] = None,
    sort: str = "name",
    order: str = "asc",
) -> list[ResultsRow]:
    from ..config import settings

    criteria = db.query(Criterion).filter(Criterion.active.is_(True)).order_by(Criterion.id.asc()).all()
    criteria_by_id = {c.id: c for c in criteria}

    users_q = db.query(User).filter(User.is_active.is_(True))
    if group:
        users_q = users_q.filter(User.group == group)
    if q:
        like = f"%{q.strip()}%"
        users_q = users_q.filter((User.full_name.ilike(like)) | (User.nickname.ilike(like)))

    users = users_q.all()
    user_ids = [u.id for u in users]
    if not user_ids:
        return []

    rows = (
        db.query(Evaluation.target_id, EvaluationScore.criterion_id, func.avg(EvaluationScore.score))
        .join(EvaluationScore, EvaluationScore.evaluation_id == Evaluation.id)
        .join(Criterion, Criterion.id == EvaluationScore.criterion_id)
        .filter(Evaluation.target_id.in_(user_ids), Criterion.active.is_(True))
        .group_by(Evaluation.target_id, EvaluationScore.criterion_id)
        .all()
    )

    agg: dict[int, dict[int, float]] = defaultdict(dict)
    for target_id, criterion_id, avg_score in rows:
        agg[int(target_id)][int(criterion_id)] = float(avg_score) if avg_score is not None else None

    out: list[ResultsRow] = []
    for u in users:
        crit_map: dict[str, Optional[float]] = {}
        values: list[float] = []
        for cid, c in criteria_by_id.items():
            val = agg.get(u.id, {}).get(cid)
            crit_map[c.name] = val
            if val is not None:
                values.append(float(val))

        stats = get_stats_for_target(db, target_id=u.id)
        score_q = (
            db.query(EvaluationScore.score, EvaluationScore.criterion_id)
            .join(Evaluation, Evaluation.id == EvaluationScore.evaluation_id)
            .join(Criterion, Criterion.id == EvaluationScore.criterion_id)
            .filter(Evaluation.target_id == u.id, Criterion.active.is_(True))
        )
        anomaly_count = 0
        for score_val, cid in score_q.all():
            stat = stats.get(int(cid))
            if not stat or stat.n < settings.anomaly_min_samples or stat.stdev <= 0:
                continue
            z = (float(score_val) - stat.mean) / stat.stdev
            if abs(z) >= settings.anomaly_zscore:
                anomaly_count += 1

        out.append(
            ResultsRow(
                student_id=u.id,
                student_full_name=u.full_name,
                group=u.group,
                criteria=crit_map,
                overall_mean=(sum(values) / len(values)) if values else None,
                anomaly_count=anomaly_count,
            )
        )

    reverse = order.lower() == "desc"
    if sort == "overall":
        out.sort(key=lambda r: (r.overall_mean is None, r.overall_mean or 0), reverse=reverse)
    elif sort == "anomalies":
        out.sort(key=lambda r: r.anomaly_count, reverse=reverse)
    else:
        out.sort(key=lambda r: r.student_full_name.lower(), reverse=reverse)

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


@router.get("/criteria", response_model=list[CriterionPublic])
def list_criteria(active_only: bool = True, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(Criterion)
    if active_only:
        q = q.filter(Criterion.active.is_(True))
    q = q.order_by(Criterion.id.asc())
    return [
        CriterionPublic(
            id=c.id,
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
        query = query.filter(User.group == group)
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

    active_criteria = {c.id: c for c in db.query(Criterion).filter(Criterion.active.is_(True)).all()}
    if not active_criteria:
        raise HTTPException(status_code=400, detail="Нет активных критериев")

    # If the user already evaluated this target, update their latest evaluation instead of creating a new one.
    # Also delete older duplicates (legacy data).
    existing = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.scores))
        .filter(Evaluation.rater_id == current.id, Evaluation.target_id == target_id)
        .order_by(Evaluation.created_at.desc())
        .all()
    )

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
        eval_row = Evaluation(rater_id=current.id, target_id=target_id, comment=(payload.comment or "").strip())
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


@router.get("/results", response_model=list[ResultsRow])
def results(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    q: Optional[str] = None,
    group: Optional[str] = None,
    sort: str = "name",
    order: str = "asc",
):
    return _compute_results(db=db, q=q, group=group, sort=sort, order=order)


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

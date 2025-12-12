from __future__ import annotations

from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from .anomalies import Stat, compute_stat, zscore
from .config import settings
from .models import Criterion, Evaluation, EvaluationScore


def clamp_score(value: float, *, max_score: float) -> float:
    if value < 0:
        return 0.0
    if value > max_score:
        return float(max_score)
    return float(value)


def get_stats_for_target(db: Session, *, target_id: int, include_inactive: bool = False) -> dict[int, Stat]:
    q = (
        db.query(EvaluationScore.criterion_id, EvaluationScore.score)
        .join(Evaluation, Evaluation.id == EvaluationScore.evaluation_id)
        .join(Criterion, Criterion.id == EvaluationScore.criterion_id)
        .filter(Evaluation.target_id == target_id)
    )
    if not include_inactive:
        q = q.filter(Criterion.active.is_(True))

    buckets: dict[int, list[float]] = defaultdict(list)
    for criterion_id, score in q.all():
        buckets[int(criterion_id)].append(float(score))

    return {cid: compute_stat(values) for cid, values in buckets.items()}


def evaluation_to_dict(e: Evaluation, *, stats: dict[int, Stat]) -> dict:
    z_thresh = settings.anomaly_zscore
    min_n = settings.anomaly_min_samples

    out_scores: list[dict] = []
    for s in e.scores:
        stat = stats.get(int(s.criterion_id))
        z = zscore(float(s.score), stat) if stat else None
        is_anomaly = bool(stat and stat.n >= min_n and z is not None and abs(z) >= z_thresh)
        out_scores.append(
            {
                "id": int(s.id),
                "criterion_id": int(s.criterion_id),
                "criterion_name": s.criterion.name,
                "max_score": float(s.criterion.max_score),
                "score": float(s.score),
                "mean": float(stat.mean) if stat else None,
                "stdev": float(stat.stdev) if stat else None,
                "z": float(z) if z is not None else None,
                "delta": float(s.score - stat.mean) if stat else None,
                "is_anomaly": is_anomaly,
            }
        )

    return {
        "id": int(e.id),
        "rater_id": int(e.rater_id),
        "rater_full_name": e.rater.full_name,
        "comment": e.comment or "",
        "created_at": e.created_at,
        "scores": out_scores,
    }


def load_evaluation(db: Session, evaluation_id: int) -> Optional[Evaluation]:
    return (
        db.query(Evaluation)
        .options(joinedload(Evaluation.rater), joinedload(Evaluation.scores).joinedload(EvaluationScore.criterion))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )

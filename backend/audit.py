from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog


def write_audit(
    db: Session,
    *,
    actor_type: str,
    actor_user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None,
    before: Any = None,
    after: Any = None,
    ip: str = "",
) -> None:
    row = AuditLog(
        actor_type=actor_type,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_json=json.dumps(before, ensure_ascii=False, default=str) if before is not None else "",
        after_json=json.dumps(after, ensure_ascii=False, default=str) if after is not None else "",
        ip=ip or "",
    )
    db.add(row)

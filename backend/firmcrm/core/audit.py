"""Audit trail: every state-changing action records actor, entity, before/after."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from firmcrm.models import AuditLog, Account, Contact, Opportunity, Engagement, Activity, ConflictCheck, EthicalWall, Invoice


def record(db: Session, *, actor_id: str | None, action: str, entity_type: str, entity_id: int | str | None,
           before: Any = None, after: Any = None, note: str | None = None, opportunity_id: int | None = None) -> AuditLog:
    account_id = contact_id = None
    models = {'account': Account, 'contact': Contact, 'opportunity': Opportunity, 'engagement': Engagement, 'activity': Activity, 'conflict_check': ConflictCheck, 'ethical_wall': EthicalWall, 'invoice': Invoice}
    model = models.get(entity_type)
    subject = db.get(model, entity_id) if model and entity_id is not None else None
    if subject is not None:
        account_id = subject.id if model is Account else getattr(subject, 'account_id', None)
        opportunity_id = opportunity_id or (subject.id if model is Opportunity else getattr(subject,'opportunity_id',None))
        contact_id = subject.id if model is Contact else getattr(subject,'contact_id',None)
        if model is EthicalWall:
            if subject.entity_type == 'account': account_id = subject.entity_id
            else: opportunity_id = subject.entity_id
    if isinstance(after, dict):
        contact_id = contact_id or after.get('contact_id')
    row = AuditLog(account_id=account_id, opportunity_id=opportunity_id, contact_id=contact_id,
        actor_id=actor_id, action=action, entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        before_json=json.dumps(before, default=str) if before is not None else None,
        after_json=json.dumps(after, default=str) if after is not None else None,
        note=note,
    )
    db.add(row)
    return row

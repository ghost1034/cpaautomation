from __future__ import annotations
from firmcrm.core.routing import FirmCrmRoute

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from firmcrm.api.common import (
    SortDir,
    account_names,
    apply_sort,
    apply_updates,
    archive,
    assert_practice_area_active,
    contact_names,
    get_or_404,
    paginate,
    practice_area_names,
    restore,
    stage_map,
    user_names,
)
from firmcrm.core.audit import record
from firmcrm.core.db import get_db
from firmcrm.core.deps import at_least, get_current_user, require_role
from firmcrm.core.errors import DomainError
from firmcrm.models import Account, Invoice, Opportunity, Pipeline, PracticeArea, Stage, StageHistory, User, utcnow
from firmcrm.schemas import FirmCrmOpportunityCreate, FirmCrmOpportunityOut, FirmCrmOpportunityUpdate, FirmCrmPage, FirmCrmStageChangeIn, FirmCrmStageHistoryOut
from firmcrm.services import conflicts, visibility
from firmcrm.services import opportunities as opp_svc
from firmcrm.services.leads import default_pipeline

router = APIRouter(route_class=FirmCrmRoute, prefix="/opportunities", tags=["opportunities"])


def enrich(db: Session, rows: list[Opportunity]) -> list[FirmCrmOpportunityOut]:
    an = account_names(db, [o.account_id for o in rows])
    un = user_names(db, [o.owner_id for o in rows] + [o.originating_partner_id for o in rows])
    cn = contact_names(db, [o.primary_contact_id for o in rows])
    pn = practice_area_names(db, [o.practice_area_id for o in rows])
    stages = stage_map(db)
    pa_clear = {p.id: p.clearance_type for p in db.scalars(select(PracticeArea)).all()}
    out = []
    for o in rows:
        d = FirmCrmOpportunityOut.model_validate(o)
        d.account_name = an.get(o.account_id)
        d.owner_name = un.get(o.owner_id)
        d.originating_partner_name = un.get(o.originating_partner_id)
        d.primary_contact_name = cn.get(o.primary_contact_id)
        d.practice_area_name = pn.get(o.practice_area_id)
        st = stages.get(o.stage_id)
        d.stage_name = st.name if st else None
        d.stage_position = st.position if st else None
        d.weighted_amount = round(o.amount * o.probability / 100, 2)
        d.days_in_stage = (utcnow() - o.stage_entered_at).days if o.stage_entered_at else 0
        d.is_stale = opp_svc.is_stale(db, o)
        d.clearance_type = pa_clear.get(o.practice_area_id)
        d.clearance_status = conflicts.latest_status_for_opportunity(db, o.id, d.clearance_type) if d.clearance_type else None
        out.append(d)
    return out


@router.get("", response_model=FirmCrmPage[FirmCrmOpportunityOut])
def list_opportunities(q: str | None = Query(None, max_length=200), status: str | None = Query("open", max_length=10),
                       pipeline_id: int | None = None, stage_id: int | None = None, owner_id: str | None = None,
                       account_id: int | None = None, practice_area_id: int | None = None, stale_only: bool = False,
                       include_archived: bool = False, sort: str | None = Query(None, max_length=40), dir: SortDir = "asc",
                       limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0),
                       db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    if status and status not in ("open", "won", "lost", "all"):
        raise DomainError("status must be open, won, lost, or all", code="validation_error", status_code=422)
    stmt = visibility.apply(select(Opportunity), visibility.opportunity_clause(_))
    if not include_archived:
        stmt = stmt.where(Opportunity.is_archived.is_(False))
    if q:
        stmt = stmt.join(Account, Account.id == Opportunity.account_id).where(or_(Opportunity.name.ilike(f"%{q}%"), Account.name.ilike(f"%{q}%")))
    if status and status != "all":
        stmt = stmt.where(Opportunity.status == status)
    for col, val in ((Opportunity.pipeline_id, pipeline_id), (Opportunity.stage_id, stage_id), (Opportunity.owner_id, owner_id),
                     (Opportunity.account_id, account_id), (Opportunity.practice_area_id, practice_area_id)):
        if val:
            stmt = stmt.where(col == val)
    stage_pos = select(Stage.position).where(Stage.id == Opportunity.stage_id).scalar_subquery()
    stmt = apply_sort(stmt, sort, dir, {"name": Opportunity.name, "amount": Opportunity.amount, "probability": Opportunity.probability,
                                        "expected_close": Opportunity.expected_close, "stage": stage_pos, "created_at": Opportunity.created_at,
                                        "updated_at": Opportunity.updated_at, "days_in_stage": Opportunity.stage_entered_at},
                      [Opportunity.expected_close.is_(None), Opportunity.expected_close, Opportunity.id])
    if stale_only:
        # stale is computed in Python; filter the full open set then page in memory
        all_rows = db.scalars(stmt).all()
        out = [o for o in enrich(db, all_rows) if o.is_stale]
        return FirmCrmPage(items=out[offset:offset + limit], total=len(out), limit=limit, offset=offset)
    rows, total = paginate(db, stmt, limit, offset)
    return FirmCrmPage(items=enrich(db, rows), total=total, limit=limit, offset=offset)


@router.post("", response_model=FirmCrmOpportunityOut, status_code=201)
def create_opportunity(body: FirmCrmOpportunityCreate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    get_or_404(db, Account, body.account_id)
    visibility.assert_account_visible(db, actor, body.account_id)
    assert_practice_area_active(db, body.practice_area_id)
    pipeline = db.get(Pipeline, body.pipeline_id) if body.pipeline_id else default_pipeline(db)
    if not pipeline:
        raise DomainError("Pipeline not found", status_code=404)
    stage = db.get(Stage, body.stage_id) if body.stage_id else sorted(pipeline.stages, key=lambda s: s.position)[0]
    if not stage or stage.pipeline_id != pipeline.id or stage.is_won or stage.is_lost:
        raise DomainError("Initial stage must be an open stage in the chosen pipeline")
    data = body.model_dump()
    data.update(pipeline_id=pipeline.id, stage_id=stage.id)
    if data.get("probability") is None:
        data["probability"] = stage.probability
    o = Opportunity(**data)
    if o.owner_id is None:
        o.owner_id = actor.id
    db.add(o)
    db.flush()
    db.add(StageHistory(opportunity_id=o.id, from_stage_id=None, to_stage_id=stage.id, changed_by_id=actor.id))
    record(db, actor_id=actor.id, action="opportunity.create", entity_type="opportunity", entity_id=o.id, after=body.model_dump())
    db.commit()
    return enrich(db, [o])[0]


def get_visible(db: Session, user: User, opp_id: int) -> Opportunity:
    o = get_or_404(db, Opportunity, opp_id)
    visibility.assert_opportunity_visible(db, user, o)
    return o


@router.get("/{opp_id}", response_model=FirmCrmOpportunityOut)
def get_opportunity(opp_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return enrich(db, [get_visible(db, user, opp_id)])[0]


@router.patch("/{opp_id}", response_model=FirmCrmOpportunityOut)
def update_opportunity(opp_id: int, body: FirmCrmOpportunityUpdate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    o = get_visible(db, actor, opp_id)
    data = body.model_dump(exclude_unset=True)
    if "practice_area_id" in data and data["practice_area_id"] != o.practice_area_id:
        assert_practice_area_active(db, data["practice_area_id"])
    before = apply_updates(o, data)
    if before:
        record(db, actor_id=actor.id, action="opportunity.update", entity_type="opportunity", entity_id=o.id, before=before,
               after={k: data[k] for k in before})
    db.commit()
    return enrich(db, [o])[0]


@router.post("/{opp_id}/stage", response_model=FirmCrmOpportunityOut)
def change_stage(opp_id: int, body: FirmCrmStageChangeIn, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    o = get_visible(db, actor, opp_id)
    opp_svc.change_stage(db, o, body.stage_id, actor, lost_reason=body.lost_reason, competitor=body.competitor, note=body.note)
    db.commit()
    return enrich(db, [o])[0]


@router.post("/{opp_id}/reopen", response_model=FirmCrmOpportunityOut)
def reopen(opp_id: int, body: FirmCrmStageChangeIn, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    o = get_visible(db, actor, opp_id)
    opp_svc.reopen(db, o, body.stage_id, actor)
    db.commit()
    return enrich(db, [o])[0]


@router.get("/{opp_id}/history", response_model=list[FirmCrmStageHistoryOut])
def history(opp_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_visible(db, user, opp_id)
    rows = db.scalars(select(StageHistory).where(StageHistory.opportunity_id == opp_id).order_by(StageHistory.changed_at)).all()
    stages = stage_map(db)
    un = user_names(db, [h.changed_by_id for h in rows])
    out = []
    for h in rows:
        d = FirmCrmStageHistoryOut.model_validate(h)
        d.from_stage_name = stages[h.from_stage_id].name if h.from_stage_id in stages else None
        d.to_stage_name = stages[h.to_stage_id].name if h.to_stage_id in stages else None
        d.changed_by_name = un.get(h.changed_by_id)
        out.append(d)
    return out


@router.post("/{opp_id}/archive", response_model=FirmCrmOpportunityOut)
def archive_opportunity(opp_id: int, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    o = get_visible(db, actor, opp_id)
    if o.status == "open":
        raise DomainError("Close the opportunity (won or lost) before archiving", code="open")
    archive(db, o, actor.id, "opportunity")
    db.commit()
    return enrich(db, [o])[0]


@router.post("/{opp_id}/restore", response_model=FirmCrmOpportunityOut)
def restore_opportunity(opp_id: int, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    o = get_visible(db, actor, opp_id)
    restore(db, o, actor.id, "opportunity")
    db.commit()
    return enrich(db, [o])[0]


@router.delete("/{opp_id}", status_code=204)
def purge_opportunity(opp_id: int, db: Session = Depends(get_db), actor: User = Depends(require_role("admin"))):
    o = get_visible(db, actor, opp_id)
    if o.status == "won":
        raise DomainError("Won opportunities cannot be deleted", code="won")
    with db.include_restricted():  # an invoice hidden from the actor still blocks deletion
        has_invoices = db.scalar(select(Invoice.id).where(Invoice.opportunity_id == o.id).limit(1)) is not None
    if has_invoices:
        raise DomainError("Opportunities with invoices cannot be deleted; archive it instead", code="has_invoices")
    record(db, actor_id=actor.id, action="opportunity.purge", entity_type="opportunity", entity_id=o.id, before={"name": o.name})
    db.delete(o)
    db.commit()

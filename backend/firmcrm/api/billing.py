from __future__ import annotations
from firmcrm.core.routing import FirmCrmRoute

from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from firmcrm.api.common import SortDir, account_names, apply_sort, apply_updates, archive, get_or_404, name_map, paginate
from firmcrm.core.audit import record
from firmcrm.core.db import get_db
from firmcrm.core.deps import ROLE_RANK, at_least, get_current_user
from firmcrm.core.errors import Forbidden
from firmcrm.enums import InvoiceStatus
from firmcrm.models import Account, BillingProfile, Engagement, Invoice, User
from firmcrm.schemas import (
    FirmCrmBillingProfileCreate,
    FirmCrmBillingProfileOut,
    FirmCrmBillingProfileUpdate,
    FirmCrmInvoiceCreate,
    FirmCrmInvoiceOut,
    FirmCrmInvoicePrefillOut,
    FirmCrmInvoiceUpdate,
    FirmCrmInvoiceVoidIn,
    FirmCrmPage,
)
from firmcrm.services import billing

router = APIRouter(route_class=FirmCrmRoute, prefix="/billing", tags=["billing"])


# ---- billing profiles

@router.get("/profiles", response_model=list[FirmCrmBillingProfileOut])
def list_profiles(include_archived: bool = False, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stmt = select(BillingProfile).order_by(BillingProfile.is_default.desc(), BillingProfile.label)
    if not include_archived:
        stmt = stmt.where(BillingProfile.is_archived.is_(False))
    return db.scalars(stmt).all()


@router.post("/profiles", response_model=FirmCrmBillingProfileOut, status_code=201)
def create_profile(body: FirmCrmBillingProfileCreate, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    data = body.model_dump(exclude={"account_number", "is_default"})
    profile = BillingProfile(**data)
    profile.set_account_number(body.account_number)
    db.add(profile)
    db.flush()
    has_default = db.scalar(select(BillingProfile.id).where(BillingProfile.id != profile.id, BillingProfile.is_default.is_(True),
                                                            BillingProfile.is_archived.is_(False)))
    if body.is_default or has_default is None:
        billing.set_default_profile(db, profile)
    record(db, actor_id=actor.id, action="billing_profile.create", entity_type="billing_profile", entity_id=profile.id,
           after={"label": profile.label, "issuer_name": profile.issuer_name})
    db.commit()
    return profile


@router.patch("/profiles/{profile_id}", response_model=FirmCrmBillingProfileOut)
def update_profile(profile_id: int, body: FirmCrmBillingProfileUpdate, db: Session = Depends(get_db),
                   actor: User = Depends(at_least("manager"))):
    profile = get_or_404(db, BillingProfile, profile_id, "Billing profile")
    data = body.model_dump(exclude_unset=True)
    account_number_changed = "account_number" in data
    if account_number_changed:
        profile.set_account_number(data.pop("account_number"))
    make_default = data.pop("is_default", None)
    before = apply_updates(profile, data)
    if make_default:
        billing.set_default_profile(db, profile)
    elif make_default is False:
        profile.is_default = False
    if before or account_number_changed or make_default is not None:
        # Bank details are audited by field name only.
        record(db, actor_id=actor.id, action="billing_profile.update", entity_type="billing_profile", entity_id=profile.id,
               before=before,
               after={**{k: data[k] for k in before}, **({"account_number": "changed"} if account_number_changed else {})})
    db.commit()
    return profile


@router.post("/profiles/{profile_id}/archive", response_model=FirmCrmBillingProfileOut)
def archive_profile(profile_id: int, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    profile = get_or_404(db, BillingProfile, profile_id, "Billing profile")
    archive(db, profile, actor.id, "billing_profile")
    profile.is_default = False
    db.commit()
    return profile


# ---- invoices

def _out(db: Session, rows: list[Invoice]) -> list[FirmCrmInvoiceOut]:
    an = account_names(db, [i.account_id for i in rows])
    en = name_map(db, Engagement, [i.engagement_id for i in rows])
    pn = name_map(db, BillingProfile, [i.billing_profile_id for i in rows], "label")
    out = []
    for invoice in rows:
        d = FirmCrmInvoiceOut.model_validate(invoice)
        d.account_name, d.engagement_name, d.billing_profile_label = an.get(invoice.account_id), en.get(invoice.engagement_id), pn.get(invoice.billing_profile_id)
        out.append(d)
    return out


def _can_manage(actor: User, invoice: Invoice) -> None:
    if invoice.created_by_id != actor.id and ROLE_RANK.get(actor.role, 0) < ROLE_RANK["manager"]:
        raise Forbidden("Only the author or a manager can change this invoice")


@router.get("/invoices", response_model=FirmCrmPage[FirmCrmInvoiceOut])
def list_invoices(status: InvoiceStatus | None = None, account_id: int | None = None, q: str | None = Query(None, max_length=100),
                  sort: str | None = Query(None, max_length=40), dir: SortDir = "desc",
                  limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db),
                  _: User = Depends(get_current_user)):
    stmt = select(Invoice)
    if status:
        stmt = stmt.where(Invoice.status == status)
    if account_id:
        stmt = stmt.where(Invoice.account_id == account_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Invoice.billed_to_name.ilike(like), Invoice.number.ilike(like)))
    stmt = apply_sort(stmt, sort, dir, {"number": Invoice.number, "issue_date": Invoice.issue_date, "due_date": Invoice.due_date,
                                        "total": Invoice.total, "status": Invoice.status, "billed_to_name": Invoice.billed_to_name},
                      [Invoice.created_at.desc(), Invoice.id.desc()])
    rows, total = paginate(db, stmt, limit, offset)
    return FirmCrmPage(items=_out(db, rows), total=total, limit=limit, offset=offset)


@router.get("/invoices/prefill", response_model=FirmCrmInvoicePrefillOut)
def prefill_invoice(account_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return billing.prefill_from_account(db, get_or_404(db, Account, account_id, "Account"))


@router.post("/invoices", response_model=FirmCrmInvoiceOut, status_code=201)
def create_invoice(body: FirmCrmInvoiceCreate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    invoice = billing.create_draft(db, actor, body.model_dump())
    db.commit()
    return _out(db, [invoice])[0]


@router.get("/invoices/{invoice_id}", response_model=FirmCrmInvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _out(db, [get_or_404(db, Invoice, invoice_id, "Invoice")])[0]


@router.patch("/invoices/{invoice_id}", response_model=FirmCrmInvoiceOut)
def update_invoice(invoice_id: int, body: FirmCrmInvoiceUpdate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    invoice = get_or_404(db, Invoice, invoice_id, "Invoice")
    _can_manage(actor, invoice)
    billing.update_draft(db, actor, invoice, body.model_dump(exclude_unset=True))
    db.commit()
    return _out(db, [invoice])[0]


@router.delete("/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    invoice = get_or_404(db, Invoice, invoice_id, "Invoice")
    _can_manage(actor, invoice)
    billing.delete_draft(db, actor, invoice)
    db.commit()
    return Response(status_code=204)


@router.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    invoice = get_or_404(db, Invoice, invoice_id, "Invoice")
    filename = billing.pdf_filename(invoice)
    return Response(billing.invoice_pdf(db, invoice), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.post("/invoices/{invoice_id}/issue", response_model=FirmCrmInvoiceOut)
def issue_invoice(invoice_id: int, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    invoice = billing.issue(db, actor, get_or_404(db, Invoice, invoice_id, "Invoice"))
    db.commit()
    return _out(db, [invoice])[0]


@router.post("/invoices/{invoice_id}/mark-paid", response_model=FirmCrmInvoiceOut)
def mark_invoice_paid(invoice_id: int, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    invoice = billing.mark_paid(db, actor, get_or_404(db, Invoice, invoice_id, "Invoice"))
    db.commit()
    return _out(db, [invoice])[0]


@router.post("/invoices/{invoice_id}/void", response_model=FirmCrmInvoiceOut)
def void_invoice(invoice_id: int, body: FirmCrmInvoiceVoidIn, db: Session = Depends(get_db), actor: User = Depends(at_least("manager"))):
    invoice = billing.void(db, actor, get_or_404(db, Invoice, invoice_id, "Invoice"), body.reason)
    db.commit()
    return _out(db, [invoice])[0]


@router.post("/invoices/{invoice_id}/duplicate", response_model=FirmCrmInvoiceOut, status_code=201)
def duplicate_invoice(invoice_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    invoice = billing.duplicate(db, actor, get_or_404(db, Invoice, invoice_id, "Invoice"))
    db.commit()
    return _out(db, [invoice])[0]

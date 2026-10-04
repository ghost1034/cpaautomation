"""Invoice lifecycle: drafts, numbering, issue snapshots, PDF documents and email delivery."""

from __future__ import annotations

import html
import logging
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from firmcrm.core.audit import record
from firmcrm.core.errors import Conflict, DomainError, NotFound
from firmcrm.models import Account, BillingProfile, Contact, Engagement, FirmCrmSettings, Invoice, InvoiceDelivery, InvoiceLine, User, utcnow
from firmcrm.services.invoice_pdf import format_date, format_money, render_invoice_pdf
from services.pdf_common import CENTS

logger = logging.getLogger(__name__)

# Issuer fields frozen onto an invoice when it is issued. The account number travels separately, encrypted.
SNAPSHOT_FIELDS = (
    "issuer_name", "address_line1", "address_line2", "city", "state", "postal_code", "country", "phone", "email",
    "website", "accent_color", "bank_name", "account_name", "routing_number", "swift_code", "account_number_last4", "footer_note",
)
EDITABLE_STATUSES = {"draft"}
TRANSITIONS = {"issue": {"draft"}, "mark_paid": {"issued", "sent"}, "void": {"draft", "issued", "sent"}}


def compute_line(unit_cost: Decimal, quantity: Decimal) -> Decimal:
    return (Decimal(unit_cost) * Decimal(quantity)).quantize(CENTS, rounding=ROUND_HALF_UP)


def apply_lines(invoice: Invoice, lines: list[dict[str, Any]]) -> None:
    """Replace line items and recompute totals server-side; client-sent amounts are never trusted."""
    invoice.lines = [
        InvoiceLine(position=i, description=line["description"].strip(), unit_cost=Decimal(line["unit_cost"]),
                    quantity=Decimal(line["quantity"]), amount=compute_line(line["unit_cost"], line["quantity"]))
        for i, line in enumerate(lines)
    ]
    subtotal = sum((line.amount for line in invoice.lines), Decimal("0.00")).quantize(CENTS)
    invoice.subtotal = subtotal
    invoice.total = subtotal


def _validate_links(db: Session, account_id: int | None, engagement_id: int | None) -> None:
    if account_id is not None and db.get(Account, account_id) is None:
        raise NotFound("Account not found")
    if engagement_id is not None:
        engagement = db.get(Engagement, engagement_id)
        if engagement is None:
            raise NotFound("Engagement not found")
        if account_id is not None and engagement.account_id != account_id:
            raise Conflict("Engagement and account must match")


def _active_profile(db: Session, profile_id: int) -> BillingProfile:
    profile = db.get(BillingProfile, profile_id)
    if profile is None:
        raise NotFound("Billing profile not found")
    if profile.is_archived:
        raise DomainError("Billing profile is archived", code="archived_profile")
    return profile


def prefill_from_account(db: Session, account: Account) -> dict[str, Any]:
    locality = " ".join(p for p in [", ".join(p for p in [account.city, account.state] if p), account.postal_code] if p)
    lines = [account.address, locality]
    if account.country and account.country not in ("US", "USA", "United States"):
        lines.append(account.country)
    contacts = db.scalars(select(Contact).where(Contact.account_id == account.id, Contact.is_archived.is_(False),
                                                Contact.email.is_not(None)).order_by(Contact.id)).all()
    preferred = next((c for c in contacts if c.role == "decision_maker"), contacts[0] if contacts else None)
    return {"account_id": account.id, "billed_to_name": account.name,
            "billed_to_address": "\n".join(line for line in lines if line) or None,
            "billed_to_email": preferred.email if preferred else None}


# ---- profiles

def set_default_profile(db: Session, profile: BillingProfile) -> None:
    for other in db.scalars(select(BillingProfile).where(BillingProfile.id != profile.id, BillingProfile.is_default.is_(True))).all():
        other.is_default = False
    profile.is_default = True


def default_profile(db: Session) -> BillingProfile | None:
    stmt = select(BillingProfile).where(BillingProfile.is_archived.is_(False))
    return db.scalars(stmt.order_by(BillingProfile.is_default.desc(), BillingProfile.id)).first()


# ---- drafts

def create_draft(db: Session, actor: User, data: dict[str, Any]) -> Invoice:
    profile = _active_profile(db, data["billing_profile_id"])
    _validate_links(db, data.get("account_id"), data.get("engagement_id"))
    lines = data.pop("lines", [])
    invoice = Invoice(**data, status="draft", created_by_id=actor.id)
    if not invoice.terms_text:
        invoice.terms_text = profile.default_terms_text
    apply_lines(invoice, lines)
    db.add(invoice)
    db.flush()
    record(db, actor_id=actor.id, action="invoice.create", entity_type="invoice", entity_id=invoice.id,
           after={"billed_to_name": invoice.billed_to_name, "total": str(invoice.total)})
    return invoice


def update_draft(db: Session, actor: User, invoice: Invoice, data: dict[str, Any]) -> Invoice:
    if invoice.status not in EDITABLE_STATUSES:
        raise Conflict("Only draft invoices can be edited", code="invoice_not_draft")
    if data.get("billing_profile_id") is not None:
        _active_profile(db, data["billing_profile_id"])
    account_id = data.get("account_id", invoice.account_id)
    engagement_id = data.get("engagement_id", invoice.engagement_id)
    _validate_links(db, account_id, engagement_id)
    lines = data.pop("lines", None)
    before = {}
    for key, value in data.items():
        if getattr(invoice, key) != value:
            before[key] = getattr(invoice, key)
            setattr(invoice, key, value)
    if lines is not None:
        before["total"] = str(invoice.total)
        apply_lines(invoice, lines)
    if before:
        record(db, actor_id=actor.id, action="invoice.update", entity_type="invoice", entity_id=invoice.id, before=before,
               after={k: (str(invoice.total) if k == "total" else getattr(invoice, k)) for k in before})
    return invoice


def delete_draft(db: Session, actor: User, invoice: Invoice) -> None:
    if invoice.status != "draft":
        raise Conflict("Only draft invoices can be deleted; void issued invoices instead", code="invoice_not_draft")
    record(db, actor_id=actor.id, action="invoice.delete", entity_type="invoice", entity_id=invoice.id,
           before={"billed_to_name": invoice.billed_to_name, "total": str(invoice.total)})
    db.delete(invoice)


def duplicate(db: Session, actor: User, invoice: Invoice) -> Invoice:
    profile = db.get(BillingProfile, invoice.billing_profile_id)
    if profile is None or profile.is_archived:
        profile = default_profile(db)
        if profile is None:
            raise DomainError("Create a billing profile first", code="no_billing_profile")
    data = {k: getattr(invoice, k) for k in ("account_id", "engagement_id", "billed_to_name", "billed_to_address",
                                              "billed_to_email", "billed_to_cc", "currency", "notes")}
    data["billing_profile_id"] = profile.id
    data["lines"] = [{"description": l.description, "unit_cost": l.unit_cost, "quantity": l.quantity} for l in invoice.lines]
    return create_draft(db, actor, data)


# ---- lifecycle

def _guard(invoice: Invoice, action: str) -> None:
    if invoice.status not in TRANSITIONS[action]:
        raise Conflict(f"Cannot {action.replace('_', ' ')} an invoice that is {invoice.status}", code="invalid_invoice_transition")


def _allocate_number(db: Session) -> str:
    # get_db holds a FOR UPDATE lock on the firm row for mutations, so allocation is serialized per firm.
    settings = db.get(FirmCrmSettings, db.info["firm_id"])
    while True:
        number = str(settings.next_invoice_number).zfill(settings.invoice_number_width)
        settings.next_invoice_number += 1
        if db.scalar(select(Invoice.id).where(Invoice.number == number)) is None:
            return number


def issue(db: Session, actor: User, invoice: Invoice) -> Invoice:
    _guard(invoice, "issue")
    if not invoice.lines:
        raise DomainError("Add at least one line item before issuing", code="invoice_empty")
    profile = _active_profile(db, invoice.billing_profile_id)
    invoice.issue_date = invoice.issue_date or date.today()
    invoice.due_date = invoice.due_date or invoice.issue_date + timedelta(days=profile.default_terms_days)
    invoice.terms_text = render_template(invoice.terms_text or profile.default_terms_text, invoice, profile.issuer_name)
    invoice.issuer_snapshot = {field: getattr(profile, field) for field in SNAPSHOT_FIELDS}
    invoice.account_number_ciphertext = profile.account_number_ciphertext
    invoice.number = _allocate_number(db)
    invoice.status = "issued"
    invoice.issued_at = utcnow()
    record(db, actor_id=actor.id, action="invoice.issue", entity_type="invoice", entity_id=invoice.id,
           after={"number": invoice.number, "total": str(invoice.total)})
    return invoice


def mark_paid(db: Session, actor: User, invoice: Invoice) -> Invoice:
    _guard(invoice, "mark_paid")
    before = invoice.status
    invoice.status, invoice.paid_at = "paid", utcnow()
    record(db, actor_id=actor.id, action="invoice.mark_paid", entity_type="invoice", entity_id=invoice.id,
           before={"status": before}, after={"status": "paid"})
    return invoice


def void(db: Session, actor: User, invoice: Invoice, reason: str | None) -> Invoice:
    _guard(invoice, "void")
    before = invoice.status
    invoice.status, invoice.voided_at, invoice.void_reason = "void", utcnow(), reason
    record(db, actor_id=actor.id, action="invoice.void", entity_type="invoice", entity_id=invoice.id,
           before={"status": before}, after={"status": "void", "reason": reason})
    return invoice


# ---- documents

class _SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def render_template(template: str, invoice: Invoice, issuer_name: str) -> str:
    values = _SafeDict(invoice_number=invoice.number or "DRAFT", issuer_name=issuer_name or "",
                       customer_name=invoice.billed_to_name or "", total=format_money(invoice.total, invoice.currency),
                       due_date=format_date(invoice.due_date), issue_date=format_date(invoice.issue_date))
    try:
        return template.format_map(values)
    except (ValueError, IndexError):  # stray braces in user text are printed verbatim
        return template


def _issuer_and_account(db: Session, invoice: Invoice) -> tuple[dict[str, Any], str | None]:
    from services.encryption_service import encryption_service
    if invoice.issuer_snapshot is not None:
        ciphertext = invoice.account_number_ciphertext
        return dict(invoice.issuer_snapshot), encryption_service.decrypt_token(ciphertext) if ciphertext else None
    profile = db.get(BillingProfile, invoice.billing_profile_id)
    if profile is None:
        raise NotFound("Billing profile not found")
    return {field: getattr(profile, field) for field in SNAPSHOT_FIELDS}, profile.get_account_number()


def invoice_pdf(db: Session, invoice: Invoice) -> bytes:
    issuer, account_number = _issuer_and_account(db, invoice)
    terms = invoice.terms_text
    if invoice.status == "draft" and terms:
        terms = render_template(terms, invoice, issuer.get("issuer_name") or "")
    return render_invoice_pdf({
        "issuer": issuer, "number": invoice.number, "draft": invoice.status == "draft",
        "issue_date": invoice.issue_date or (date.today() if invoice.status == "draft" else None),
        "billed_to_name": invoice.billed_to_name, "billed_to_address": invoice.billed_to_address,
        "lines": [{"description": l.description, "unit_cost": l.unit_cost, "quantity": l.quantity, "amount": l.amount}
                  for l in invoice.lines],
        "subtotal": invoice.subtotal, "total": invoice.total, "currency": invoice.currency,
        "terms_text": terms, "notes": invoice.notes, "account_number": account_number,
    })


def pdf_filename(invoice: Invoice) -> str:
    customer = "".join(ch for ch in invoice.billed_to_name if ch.isalnum() or ch in " -_").strip()[:60] or "Customer"
    return f"{customer} Invoice {invoice.number or 'Draft'}.pdf"


# ---- delivery

def send(db: Session, actor: User, invoice: Invoice, *, to: str, cc: list[str], subject: str | None,
         message: str | None) -> InvoiceDelivery:
    """Email the invoice PDF. A failed delivery is recorded and never marks the invoice as sent."""
    from services.email_service import email_service
    if invoice.status in ("void", "paid"):
        raise Conflict(f"Cannot send an invoice that is {invoice.status}", code="invalid_invoice_transition")
    if invoice.status == "draft":
        issue(db, actor, invoice)
    issuer, _ = _issuer_and_account(db, invoice)
    profile = db.get(BillingProfile, invoice.billing_profile_id)
    issuer_name = issuer.get("issuer_name") or ""
    subject = render_template(subject or (profile.email_subject_template if profile else "Invoice {invoice_number}"), invoice, issuer_name)
    body = render_template(message or (profile.email_message_template if profile else ""), invoice, issuer_name)
    pdf = invoice_pdf(db, invoice)
    html_body = "<div style=\"font-family:Arial,sans-serif;font-size:14px\">" + html.escape(body).replace("\n", "<br>") + "</div>"

    def deliver(recipient: str) -> str | None:
        try:
            ok = email_service.send_html_email(recipient, subject, html_body, body, reply_to=issuer.get("email") or None,
                                               attachments=[(pdf_filename(invoice), pdf, "application/pdf")])
            return None if ok else f"Email delivery to {recipient} failed"
        except Exception as exc:  # provider errors become a failed delivery, not a 500
            logger.exception("Invoice email failed for invoice %s", invoice.id)
            return f"Email delivery to {recipient} failed: {exc}"

    # The primary recipient decides the outcome; copy failures are reported but do not undo a delivered invoice.
    error = deliver(to)
    delivered = error is None
    if delivered:
        errors = [e for e in (deliver(address) for address in cc) if e]
        error = "; ".join(errors) or None
    delivery = InvoiceDelivery(invoice_id=invoice.id, to_email=to, cc=", ".join(cc) or None, subject=subject[:300],
                               status="sent" if delivered else "failed", error=error[:1000] if error else None,
                               sent_by_id=actor.id)
    invoice.deliveries.append(delivery)
    if delivered:
        if invoice.status == "issued":
            invoice.status = "sent"
        invoice.sent_at = invoice.sent_at or utcnow()
    record(db, actor_id=actor.id, action=f"invoice.delivery_{delivery.status}", entity_type="invoice", entity_id=invoice.id,
           after={"to": to, "cc": cc, "error": error})
    return delivery

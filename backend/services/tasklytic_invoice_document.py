"""Canonical Tasklytic invoice documents and deterministic ReportLab rendering."""

from __future__ import annotations

import html
import hashlib
import io
import re
from collections import OrderedDict
from datetime import date
from decimal import Decimal
from functools import partial
from typing import Any

from services.pdf_common import money, register_vera_fonts

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


SNAPSHOT_VERSION = 1
PAGE_SIZES = {"letter": LETTER, "a4": A4}
LINE_PRESENTATIONS = {"detailed", "summary"}
DEFAULT_ACCENT = "#2563EB"
MAX_TEXT = {
    "issuerDisplayName": 200,
    "issuerAddress": 1000,
    "issuerEmail": 320,
    "issuerPhone": 100,
    "issuerWebsite": 500,
    "paymentInstructions": 4000,
    "taxLabel": 80,
    "taxRegistrationText": 500,
    "defaultFooter": 1000,
    "emailSubjectTemplate": 998,
    "emailMessageTemplate": 10000,
}


def _text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _money(value: Any) -> Decimal:
    return money(value)


def _amount(value: Any, currency: str) -> str:
    return f"{currency} {_money(value):,.2f}"


def normalize_billing_settings(workspace: dict[str, Any]) -> dict[str, Any]:
    raw = workspace.get("billingSettings") or {}
    accent = str(raw.get("accentColor") or DEFAULT_ACCENT).upper()
    if len(accent) != 7 or accent[0] != "#" or any(char not in "0123456789ABCDEF" for char in accent[1:]):
        accent = DEFAULT_ACCENT
    page_size = str(raw.get("pageSize") or "letter").lower()
    if page_size not in PAGE_SIZES:
        page_size = "letter"
    line_presentation = str(raw.get("defaultLinePresentation") or "").lower()
    if line_presentation not in LINE_PRESENTATIONS:
        line_presentation = "detailed" if workspace.get("psaMode") == "legal" else "summary"
    return {
        "issuerDisplayName": _text(raw.get("issuerDisplayName") or raw.get("brandedHeader") or workspace.get("name") or "Invoice", 200),
        "issuerAddress": _text(raw.get("issuerAddress"), 1000),
        "issuerEmail": _text(raw.get("issuerEmail"), 320),
        "issuerPhone": _text(raw.get("issuerPhone"), 100),
        "issuerWebsite": _text(raw.get("issuerWebsite"), 500),
        "accentColor": accent,
        "paymentInstructions": _text(raw.get("paymentInstructions"), 4000),
        "logoObjectName": _text(raw.get("logoObjectName"), 1000) or None,
        "taxLabel": _text(raw.get("taxLabel") or "Tax", 80),
        "taxRegistrationText": _text(raw.get("taxRegistrationText"), 500),
        "defaultLinePresentation": line_presentation,
        "pageSize": page_size,
        "defaultFooter": _text(raw.get("defaultFooter"), 1000),
        "emailSubjectTemplate": _text(raw.get("emailSubjectTemplate") or "Invoice {invoiceNumber} from {issuerName}", 998),
        "emailMessageTemplate": _text(raw.get("emailMessageTemplate") or "Please find invoice {invoiceNumber} attached. Amount due: {amountDue}.", 10000),
    }


def canonical_display_lines(line_items: list[dict[str, Any]], presentation: str) -> list[dict[str, Any]]:
    """Return stable detail or summary rows without changing the underlying charges."""
    if presentation == "detailed":
        return [
            {
                "id": str(line.get("id") or line.get("sourceId") or index),
                "serviceDate": line.get("serviceDate"),
                "description": _text(line.get("description") or "Professional services", 4000),
                "professionalCategory": _text(line.get("professionalCategory"), 300),
                "matterProjectLabel": _text(line.get("matterProjectLabel"), 500),
                "activityCode": _text(line.get("activityCode"), 100),
                "quantity": float(line.get("quantity") or 0),
                "rate": float(line.get("rate") or 0),
                "amount": float(_money(line.get("amount"))),
                "chargeType": line.get("type") or "fee",
                "sourceIds": [str(line.get("sourceId"))] if line.get("sourceId") else [],
            }
            for index, line in enumerate(line_items)
        ]

    grouped: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
    for line in line_items:
        label = _text(line.get("matterProjectLabel") or "General", 500)
        charge_type = str(line.get("type") or "fee")
        key = (label, charge_type)
        if key not in grouped:
            grouped[key] = {
                "id": f"summary-{len(grouped) + 1}",
                "matterProjectLabel": label,
                "description": "Professional services" if charge_type == "time" else "Reimbursable expenses" if charge_type == "expense" else "Fees",
                "chargeType": charge_type,
                "amount": 0.0,
                "sourceIds": [],
            }
        grouped[key]["amount"] = float(_money(grouped[key]["amount"]) + _money(line.get("amount")))
        if line.get("sourceId"):
            grouped[key]["sourceIds"].append(str(line["sourceId"]))
    return list(grouped.values())


def build_document_snapshot(
    invoice: dict[str, Any],
    workspace: dict[str, Any],
    client: dict[str, Any],
    *,
    frozen_at: str | None = None,
    frozen_by_id: str | None = None,
) -> dict[str, Any]:
    settings = normalize_billing_settings(workspace)
    presentation = str(invoice.get("linePresentation") or settings["defaultLinePresentation"])
    if presentation not in LINE_PRESENTATIONS:
        presentation = settings["defaultLinePresentation"]
    display_lines = invoice.get("displayLines")
    if not isinstance(display_lines, list) or invoice.get("linePresentation") != presentation:
        display_lines = canonical_display_lines(list(invoice.get("lineItems") or []), presentation)
    bill_to_override = invoice.get("billTo") if isinstance(invoice.get("billTo"), dict) else {}
    bill_to = {
        "name": _text(bill_to_override.get("name") or client.get("name") or invoice.get("clientName") or "Client", 300),
        "contactName": _text(bill_to_override.get("contactName") or client.get("contactName"), 200),
        "email": _text(bill_to_override.get("email") or client.get("contactEmail"), 320),
        "phone": _text(bill_to_override.get("phone") or client.get("contactPhone"), 100),
        "address": _text(bill_to_override.get("address") or client.get("billingAddress"), 1000),
        "taxId": _text(bill_to_override.get("taxId") or client.get("taxId"), 200),
    }
    issuer = {key: settings[key] for key in ("issuerDisplayName", "issuerAddress", "issuerEmail", "issuerPhone", "issuerWebsite", "taxRegistrationText")}
    return {
        "version": SNAPSHOT_VERSION,
        "issuer": issuer,
        "billTo": bill_to,
        "branding": {"accentColor": settings["accentColor"], "logoObjectName": settings["logoObjectName"]},
        "paymentInstructions": _text(invoice.get("paymentInstructions") or settings["paymentInstructions"], 4000),
        "pageSize": str(invoice.get("pageSize") or settings["pageSize"]),
        "linePresentation": presentation,
        "taxLabel": _text(invoice.get("taxLabel") or settings["taxLabel"], 80),
        "footer": _text(invoice.get("footer") or settings["defaultFooter"], 1000),
        "document": {
            "invoiceNumber": _text(invoice.get("invoiceNumber"), 200),
            "issueDate": invoice.get("issueDate"),
            "dueOn": invoice.get("dueOn"),
            "periodStart": invoice.get("periodStart"),
            "periodEnd": invoice.get("periodEnd"),
            "currency": str(invoice.get("currency") or "USD").upper(),
            "narrative": _text(invoice.get("narrative"), 4000),
            "notes": _text(invoice.get("notes"), 10000),
            "displayLines": display_lines,
            "subtotalFees": float(_money(invoice.get("subtotalFees"))),
            "subtotalExpenses": float(_money(invoice.get("subtotalExpenses"))),
            "discountAmount": float(_money(invoice.get("discountAmount"))),
            "discountReason": _text(invoice.get("discountReason"), 500),
            "taxAmount": float(_money(invoice.get("taxAmount"))),
            "total": float(_money(invoice.get("total", invoice.get("amount")))),
        },
        "freeze": {"frozenAt": frozen_at, "frozenById": frozen_by_id} if frozen_at else None,
    }


def _font_names() -> tuple[str, str]:
    return register_vera_fonts("TasklyticVera", "TasklyticVeraBold")


def _paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(str(value or "")).replace("\n", "<br/>"), style)


def render_invoice_pdf(
    invoice: dict[str, Any],
    workspace: dict[str, Any],
    *,
    client: dict[str, Any] | None = None,
    logo_bytes: bytes | None = None,
) -> bytes:
    """Render a deterministic, multipage invoice from a frozen or legacy document."""
    snapshot = invoice.get("documentSnapshot")
    if not isinstance(snapshot, dict):
        snapshot = build_document_snapshot(invoice, workspace, client or {})
    document = snapshot.get("document") or {}
    issuer = snapshot.get("issuer") or {}
    bill_to = snapshot.get("billTo") or {}
    branding = snapshot.get("branding") or {}
    page_size_key = str(snapshot.get("pageSize") or "letter").lower()
    page_size = PAGE_SIZES.get(page_size_key, LETTER)
    accent = colors.HexColor(str(branding.get("accentColor") or DEFAULT_ACCENT))
    regular_font, bold_font = _font_names()
    styles = getSampleStyleSheet()
    body = ParagraphStyle("InvoiceBody", parent=styles["BodyText"], fontName=regular_font, fontSize=8.5, leading=11, textColor=colors.HexColor("#334155"))
    small = ParagraphStyle("InvoiceSmall", parent=body, fontSize=7.5, leading=9)
    label = ParagraphStyle("InvoiceLabel", parent=small, fontName=bold_font, textColor=colors.HexColor("#64748B"), spaceAfter=2)
    heading = ParagraphStyle("InvoiceHeading", parent=body, fontName=bold_font, fontSize=22, leading=25, textColor=accent)
    right = ParagraphStyle("InvoiceRight", parent=body, alignment=TA_RIGHT)
    right_bold = ParagraphStyle("InvoiceRightBold", parent=right, fontName=bold_font)
    table_header = ParagraphStyle("InvoiceTableHeader", parent=small, fontName=bold_font, textColor=colors.white)
    output = io.BytesIO()
    margin = 0.55 * inch

    def page_decor(pdf: canvas.Canvas, doc: BaseDocTemplate) -> None:
        pdf.saveState()
        pdf.setTitle(str(document.get("invoiceNumber") or "Invoice"))
        pdf.setAuthor(str(issuer.get("issuerDisplayName") or ""))
        if not snapshot.get("freeze"):
            pdf.setFillColor(colors.Color(0.75, 0.78, 0.82, alpha=0.18))
            pdf.setFont(bold_font, 54)
            pdf.translate(page_size[0] / 2, page_size[1] / 2)
            pdf.rotate(35)
            pdf.drawCentredString(0, 0, "DRAFT")
            pdf.rotate(-35)
            pdf.translate(-page_size[0] / 2, -page_size[1] / 2)
        pdf.setFillColor(colors.HexColor("#64748B"))
        pdf.setFont(regular_font, 7)
        footer = str(snapshot.get("footer") or "")
        if footer:
            pdf.drawString(margin, 0.28 * inch, footer[:160])
        pdf.drawRightString(page_size[0] - margin, 0.28 * inch, f"Page {doc.page}")
        pdf.restoreState()

    doc = BaseDocTemplate(
        output,
        pagesize=page_size,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=0.45 * inch,
        bottomMargin=0.48 * inch,
        title=str(document.get("invoiceNumber") or "Invoice"),
        author=str(issuer.get("issuerDisplayName") or ""),
        pageCompression=1,
        invariant=1,
    )
    frame = Frame(margin, 0.48 * inch, page_size[0] - 2 * margin, page_size[1] - 0.93 * inch, id="invoice")
    doc.addPageTemplates([PageTemplate(id="invoice", frames=[frame], onPage=page_decor)])
    story: list[Any] = []

    issuer_lines = [issuer.get("issuerDisplayName"), issuer.get("issuerAddress"), issuer.get("issuerEmail"), issuer.get("issuerPhone"), issuer.get("issuerWebsite"), issuer.get("taxRegistrationText")]
    issuer_block = [_paragraph(issuer_lines[0] or "Invoice", ParagraphStyle("Issuer", parent=body, fontName=bold_font, fontSize=13, leading=16))]
    issuer_block.extend(_paragraph(value, small) for value in issuer_lines[1:] if value)
    if logo_bytes:
        try:
            logo = Image(io.BytesIO(logo_bytes))
            logo._restrictSize(1.6 * inch, 0.7 * inch)
            brand_cell: Any = Table([[logo, issuer_block]], colWidths=[1.8 * inch, None], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        except Exception:
            brand_cell = issuer_block
    else:
        brand_cell = issuer_block
    meta = [
        _paragraph("INVOICE", heading),
        _paragraph(document.get("invoiceNumber"), right_bold),
        _paragraph(f"Issue date: {document.get('issueDate') or '-'}", right),
        _paragraph(f"Due date: {document.get('dueOn') or '-'}", right),
    ]
    header = Table([[brand_cell, meta]], colWidths=[page_size[0] - 2 * margin - 2.25 * inch, 2.25 * inch])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.extend([header, Spacer(1, 13), Table([[""]], colWidths=[page_size[0] - 2 * margin], rowHeights=[3], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)])), Spacer(1, 13)])

    bill_lines = [bill_to.get("name"), bill_to.get("contactName"), bill_to.get("address"), bill_to.get("email"), bill_to.get("phone"), f"Tax ID: {bill_to.get('taxId')}" if bill_to.get("taxId") else None]
    bill_block = [_paragraph("BILL TO", label)] + [_paragraph(value, body) for value in bill_lines if value]
    service_period = f"{document.get('periodStart') or '-'} to {document.get('periodEnd') or '-'}"
    details = [_paragraph("SERVICE PERIOD", label), _paragraph(service_period, body)]
    if document.get("narrative"):
        details.extend([Spacer(1, 5), _paragraph("DOCUMENT SUMMARY", label), _paragraph(document.get("narrative"), body)])
    info = Table([[bill_block, details]], colWidths=[(page_size[0] - 2 * margin) * 0.52, (page_size[0] - 2 * margin) * 0.48])
    info.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.extend([info, Spacer(1, 16)])

    currency = str(document.get("currency") or "USD")
    rows = list(document.get("displayLines") or [])
    if snapshot.get("linePresentation") == "summary":
        headers = ["Matter / project", "Charge description", "Amount"]
        data = [[_paragraph(value, table_header) for value in headers]]
        for line in rows:
            data.append([_paragraph(line.get("matterProjectLabel") or "General", body), _paragraph(line.get("description"), body), _paragraph(_amount(line.get("amount"), currency), right)])
        widths = [1.8 * inch, page_size[0] - 2 * margin - 3.25 * inch, 1.45 * inch]
    else:
        headers = ["Date", "Narrative", "Professional / category", "Qty", "Rate", "Amount"]
        data = [[_paragraph(value, table_header) for value in headers]]
        for line in rows:
            professional = line.get("professionalCategory") or line.get("matterProjectLabel") or "-"
            data.append([
                _paragraph(line.get("serviceDate") or "-", small),
                _paragraph(line.get("description"), body),
                _paragraph(professional, small),
                _paragraph(f"{Decimal(str(line.get('quantity') or 0)):g}", right),
                _paragraph(_amount(line.get("rate"), currency), right),
                _paragraph(_amount(line.get("amount"), currency), right),
            ])
        usable = page_size[0] - 2 * margin
        widths = [0.85 * inch, usable - 4.9 * inch, 1.2 * inch, 0.45 * inch, 1.05 * inch, 1.35 * inch]
    line_table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    line_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), accent),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([line_table, Spacer(1, 14)])

    subtotal = _money(document.get("subtotalFees")) + _money(document.get("subtotalExpenses"))
    totals: list[list[Any]] = [[_paragraph("Subtotal", body), _paragraph(_amount(subtotal, currency), right)]]
    if _money(document.get("discountAmount")):
        discount_label = "Discount"
        if document.get("discountReason"):
            discount_label += f" - {document['discountReason']}"
        totals.append([_paragraph(discount_label, body), _paragraph(f"-{_amount(document.get('discountAmount'), currency)}", right)])
    if _money(document.get("taxAmount")):
        totals.append([_paragraph(snapshot.get("taxLabel") or "Tax", body), _paragraph(_amount(document.get("taxAmount"), currency), right)])
    totals.append([_paragraph("AMOUNT DUE", ParagraphStyle("AmountDueLabel", parent=body, fontName=bold_font, fontSize=10)), _paragraph(_amount(document.get("total"), currency), ParagraphStyle("AmountDue", parent=right_bold, fontSize=11, textColor=accent))])
    totals_table = Table(totals, colWidths=[2.1 * inch, 1.55 * inch], hAlign="RIGHT")
    totals_table.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 1.2, accent), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story.append(totals_table)

    trailing: list[Any] = []
    if document.get("notes"):
        trailing.extend([_paragraph("NOTES", label), _paragraph(document.get("notes"), body), Spacer(1, 10)])
    if snapshot.get("paymentInstructions"):
        trailing.extend([_paragraph("PAYMENT / REMITTANCE", label), _paragraph(snapshot.get("paymentInstructions"), body)])
    if trailing:
        story.extend([Spacer(1, 18), KeepTogether(trailing)])

    deterministic_canvas = partial(canvas.Canvas, invariant=1, pageCompression=1)
    doc.build(story, canvasmaker=deterministic_canvas)
    content = output.getvalue()
    # ReportLab's trailer ID is process-state dependent even with invariant=1.
    # Replace only that fixed-width identifier with one derived from the rest of
    # the document so identical snapshots produce byte-identical PDFs.
    id_pattern = re.compile(rb"/ID\s*\n\[<([0-9a-fA-F]{32})><([0-9a-fA-F]{32})>\]")
    normalized = id_pattern.sub(b"/ID \n[<00000000000000000000000000000000><00000000000000000000000000000000>]", content)
    stable_id = hashlib.sha256(normalized).hexdigest()[:32].encode("ascii")
    return id_pattern.sub(b"/ID \n[<" + stable_id + b"><" + stable_id + b">]", content)

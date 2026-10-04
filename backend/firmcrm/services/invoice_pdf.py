"""Deterministic ReportLab rendering of FirmCRM invoices.

The layout follows the firm's existing invoice design: accent bands, issuer header, BILLED TO block,
an "Invoice" column beside a banded line-item table, wire instructions, a large total and payment terms.
Coordinates are in points measured from the top of a US Letter page.
"""

from __future__ import annotations

import io
from datetime import date
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

from services.pdf_common import money, register_roboto_fonts

PAGE_W, PAGE_H = LETTER
BAND_X0, BAND_X1 = 49.5, 562.5
LEFT = 85.0
TABLE_X0, TABLE_X1 = 191.0, 528.5
COL_UNIT, COL_QTY, COL_AMOUNT = 370.0, 425.5, 488.5
DESC_WIDTH = COL_UNIT - TABLE_X0 - 8
MIN_ROWS = 8
ROW_H, ROW_GAP = 16.0, 3.0
BOTTOM_LIMIT = PAGE_H - 36

TEXT = colors.HexColor("#1F1F1F")
LABEL = colors.HexColor("#A3A3A3")
MUTED = colors.HexColor("#5F6368")
ROW_FILL = colors.HexColor("#F2F2F2")


def format_money(value: Any, currency: str = "USD") -> str:
    amount = money(value)
    sign = "-" if amount < 0 else ""
    return f"{sign}${abs(amount):,.2f}" if currency == "USD" else f"{sign}{currency} {abs(amount):,.2f}"


def format_quantity(value: Any) -> str:
    qty = Decimal(str(value or 0))
    return f"{qty:f}".rstrip("0").rstrip(".") if "." in f"{qty:f}" else f"{qty:f}"


def format_date(value: date | None) -> str:
    return value.strftime("%m/%d/%Y") if value else ""


def issuer_address_lines(issuer: dict[str, Any]) -> list[str]:
    locality = " ".join(p for p in [", ".join(p for p in [issuer.get("city"), issuer.get("state")] if p), issuer.get("postal_code")] if p)
    lines = [issuer.get("address_line1"), issuer.get("address_line2"), locality]
    if issuer.get("country") and issuer.get("country") not in ("US", "USA", "United States"):
        lines.append(issuer["country"])
    return [line for line in lines if line]


class _Renderer:
    def __init__(self, doc: dict[str, Any]):
        self.doc = doc
        self.issuer = doc["issuer"]
        self.currency = doc.get("currency") or "USD"
        try:
            self.accent = colors.HexColor(self.issuer.get("accent_color") or "#1683DB")
        except ValueError:
            self.accent = colors.HexColor("#1683DB")
        self.buffer = io.BytesIO()
        self.c = canvas.Canvas(self.buffer, pagesize=LETTER, invariant=1, pageCompression=1)
        self.c.setTitle(f"Invoice {doc.get('number') or 'Draft'}")
        self.c.setAuthor(self.issuer.get("issuer_name") or "")
        self.font, self.bold = register_roboto_fonts("FirmCrmRoboto", "FirmCrmRobotoBold")

    # -- primitives (top-based coordinates)
    def text(self, x: float, top: float, value: str, size: float, color=TEXT, bold: bool = False, align: str = "left"):
        c = self.c
        c.setFillColor(color)
        c.setFont(self.bold if bold else self.font, size)
        y = PAGE_H - top
        if align == "right":
            c.drawRightString(x, y, value)
        elif align == "center":
            c.drawCentredString(x, y, value)
        else:
            c.drawString(x, y, value)

    def rect(self, x0: float, top: float, x1: float, height: float, fill):
        self.c.setFillColor(fill)
        self.c.rect(x0, PAGE_H - top - height, x1 - x0, height, stroke=0, fill=1)

    def top_band(self):
        self.rect(BAND_X0, 53, BAND_X1, 20, self.accent)

    def watermark(self):
        # Drawn last on each page so it sits above the content; translucent so that content stays legible.
        if not self.doc.get("draft"):
            return
        c = self.c
        c.saveState()
        c.setFillColor(colors.Color(0.6, 0.6, 0.6, alpha=0.25))
        c.setFont(self.bold, 96)
        c.translate(PAGE_W / 2, PAGE_H / 2)
        c.rotate(35)
        c.drawCentredString(0, -30, "DRAFT")
        c.restoreState()

    def end_page(self):
        self.watermark()
        self.c.showPage()

    def new_page(self):
        self.end_page()
        self.top_band()

    def table_header(self, top: float):
        self.rect(TABLE_X0, top, TABLE_X1, 14, self.accent)
        for x, label in [(TABLE_X0 + 3, "DESCRIPTION"), (COL_UNIT, "UNIT COST"), (COL_QTY, "QTY/HR RATE"), (COL_AMOUNT, "AMOUNT")]:
            self.text(x, top + 10, label, 7, colors.white, bold=True)
        return top + 19

    # -- sections
    def header(self) -> float:
        issuer = self.issuer
        self.text(LEFT, 112, issuer.get("issuer_name") or "", 14)
        left = issuer_address_lines(issuer)
        right = [v for v in (issuer.get("phone"), issuer.get("email"), issuer.get("website")) if v]
        for i, line in enumerate(left):
            self.text(LEFT, 128 + i * 9.5, line, 7.5)
        right_x = LEFT + max([self.c.stringWidth(line, self.font, 7.5) for line in left] + [90]) + 14
        for i, line in enumerate(right):
            self.text(right_x, 128 + i * 9.5, line, 7.5)
        return 128 + max(len(left), len(right), 1) * 9.5

    def billed_to(self, top: float) -> float:
        label_top = top + 34
        self.text(LEFT, label_top, "BILLED TO", 6.5, LABEL, bold=True)
        lines = [self.doc.get("billed_to_name") or ""] + [
            line for line in (self.doc.get("billed_to_address") or "").splitlines() if line.strip()]
        for i, line in enumerate(lines):
            self.text(LEFT, label_top + 16 + i * 12.5, line, 8)
        return label_top + 16 + (len(lines) - 1) * 12.5

    def invoice_meta(self, top: float):
        self.text(LEFT, top + 18, "Invoice", 24, MUTED)
        self.text(LEFT, top + 34, "INVOICE NUMBER", 6.5, LABEL, bold=True)
        self.text(LEFT, top + 44, "DRAFT" if self.doc.get("draft") else (self.doc.get("number") or ""), 8)
        self.text(LEFT, top + 72, "DATE OF ISSUE", 6.5, LABEL, bold=True)
        self.text(LEFT, top + 82, format_date(self.doc.get("issue_date")), 8)

    def lines(self, top: float) -> float:
        y = self.table_header(top)
        rows = list(self.doc.get("lines") or [])
        rows += [None] * max(0, MIN_ROWS - len(rows))
        for row in rows:
            wrapped = simpleSplit(row["description"], self.font, 7.5, DESC_WIDTH) if row else [""]
            height = max(ROW_H, 10 * len(wrapped) + 6)
            if y + height > BOTTOM_LIMIT:
                if row is None:
                    break  # never start a page just for filler rows
                self.new_page()
                y = self.table_header(100)
            self.rect(TABLE_X0, y, TABLE_X1, height, ROW_FILL)
            if row:
                for i, part in enumerate(wrapped):
                    self.text(TABLE_X0 + 3, y + 11 + i * 10, part, 7.5)
                # Money is right-aligned so large amounts never spill into the next column.
                self.text(COL_QTY - 6, y + 11, format_money(row["unit_cost"], self.currency), 7.5, align="right")
                self.text(COL_QTY, y + 11, format_quantity(row["quantity"]), 7.5)
                self.text(TABLE_X1 - 3, y + 11, format_money(row["amount"], self.currency), 7.5, align="right")
            y += height + ROW_GAP
        return y - ROW_GAP

    def footer_height(self) -> float:
        terms = self._terms_lines()
        return 160 + len(terms) * 10 + 18 + 72

    def _terms_lines(self) -> list[str]:
        out: list[str] = []
        for block in (self.doc.get("terms_text"), self.doc.get("notes"), self.issuer.get("footer_note")):
            for para in (block or "").splitlines():
                out += simpleSplit(para, self.font, 8, TABLE_X1 - LEFT) or [""]
        return out

    def totals_and_wire(self, top: float) -> float:
        self.text(COL_AMOUNT - 20, top + 20, "SUBTOTAL", 6.5, LABEL, bold=True, align="right")
        self.text(TABLE_X1 - 3, top + 20, format_money(self.doc.get("subtotal"), self.currency), 8, align="right")

        wire_rows = [("Bank Name", self.issuer.get("bank_name")), ("Account Name", self.issuer.get("account_name")),
                     ("Routing Number", self.issuer.get("routing_number")), ("Account number", self.doc.get("account_number")),
                     ("SWIFT / BIC", self.issuer.get("swift_code"))]
        wire_rows = [(label, value) for label, value in wire_rows if value]
        y = top + 40
        if wire_rows:
            self.text(LEFT, y, "Wire Instruction", 7.5, MUTED, bold=True)
            y += 3
            for label, value in wire_rows:
                self.rect(LEFT - 3, y, 368, 14, ROW_FILL)
                self.text(LEFT, y + 10, label, 7.5, MUTED)
                self.text(LEFT, y + 25, str(value), 7.5, MUTED)
                y += 29
        total_x = (COL_UNIT + 53 + TABLE_X1) / 2
        self.c.setStrokeColor(MUTED)
        self.c.setLineWidth(0.6)
        self.c.line(COL_UNIT + 53, PAGE_H - (top + 81), TABLE_X1, PAGE_H - (top + 81))
        self.text(total_x, top + 117, "INVOICE TOTAL", 6.5, LABEL, bold=True, align="center")
        self.text(total_x, top + 137, format_money(self.doc.get("total"), self.currency), 18, MUTED, align="center")
        return max(y, top + 140)

    def terms(self, top: float) -> float:
        lines = self._terms_lines()
        if not lines:
            return top
        self.text(LEFT, top + 14, "TERMS", 6.5, LABEL, bold=True)
        for i, line in enumerate(lines):
            self.text(LEFT, top + 24 + i * 10, line, 8)
        return top + 24 + (len(lines) - 1) * 10

    def render(self) -> bytes:
        self.top_band()
        top = self.billed_to(self.header())
        section = top + 25
        self.invoice_meta(section)
        table_end = self.lines(section)
        if table_end + self.footer_height() > PAGE_H:
            self.new_page()
            table_end = 90
        end = self.terms(self.totals_and_wire(table_end))
        self.rect(BAND_X0, end + 22, BAND_X1, 72, self.accent)
        self.end_page()
        self.c.save()
        return self.buffer.getvalue()


def render_invoice_pdf(doc: dict[str, Any]) -> bytes:
    """Render an invoice document.

    `doc` keys: issuer (profile fields), number, draft, issue_date, billed_to_name, billed_to_address,
    lines [{description, unit_cost, quantity, amount}], subtotal, total, currency, terms_text, notes, account_number.
    """
    return _Renderer(doc).render()

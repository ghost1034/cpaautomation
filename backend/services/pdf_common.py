"""Shared ReportLab helpers for deterministic invoice-style documents."""

from __future__ import annotations

import os
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

CENTS = Decimal("0.01")


def money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENTS, rounding=ROUND_HALF_UP)


def register_vera_fonts(regular_name: str, bold_name: str) -> tuple[str, str]:
    # TTFont instances retain per-document subset state. Re-register fresh
    # instances so the output never depends on a previously rendered document.
    font_dir = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    pdfmetrics.registerFont(TTFont(regular_name, os.path.join(font_dir, "Vera.ttf")))
    pdfmetrics.registerFont(TTFont(bold_name, os.path.join(font_dir, "VeraBd.ttf")))
    return regular_name, bold_name

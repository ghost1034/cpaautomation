"""
Analytics AI service — Vertex AI port of every Gemini call from CPAAnalytics' server.ts.

One module owns every analytics LLM call. All routes are async and return
(parsed_response, usage_counts) so the calling FastAPI router can record a
UsageEvent for billing. Streaming routes are async generators that yield
("chunk", str) events while the model emits tokens and a final
("usage", Dict[str, Optional[int]]) event when the stream completes.

Mirrors the patterns from `backend/services/ai_extraction_service.py`:
- Single shared `genai.Client(vertexai=True, ...)` client
- `_get_usage_counts` extracted from response metadata
- `_get_resp_text` fallback for older response shapes
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


# CPA Analytics only (IRS/GAAP research, assistant, variance, reconciliation, etc.).
# Inkwise, extraction, and form-fill use their own model env vars.
ANALYTICS_MODEL = os.getenv("ANALYTICS_GEMINI_MODEL", "gemini-4-argon")

# Gemini 4 Argon counts thinking tokens toward max_output_tokens, rejects
# thinking_budget with a 400, and ignores temperature/top_p/top_k.
_MIN_OUTPUT_TOKENS = 32_768
_LOW_THINKING = types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)


_client: Optional[genai.Client] = None


def get_client() -> genai.Client:
    """Lazy singleton Vertex AI client shared across analytics calls."""
    global _client
    if _client is not None:
        return _client
    project = os.getenv("GOOGLE_CLOUD_PROJECT_ID")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
    if not project:
        raise RuntimeError(
            "GOOGLE_CLOUD_PROJECT_ID is not set; analytics AI service requires Vertex AI."
        )
    _client = genai.Client(vertexai=True, project=project, location=location)
    return _client


# ---------------------------------------------------------------------------
# Response helpers (mirror ai_extraction_service)
# ---------------------------------------------------------------------------

def _get_resp_text(resp: Any) -> Optional[str]:
    if resp is None:
        return None
    text = getattr(resp, "text", None)
    if isinstance(text, str) and text.strip():
        return text
    try:
        candidates = getattr(resp, "candidates", None)
        if isinstance(candidates, list) and candidates:
            content = getattr(candidates[0], "content", None)
            parts = getattr(content, "parts", None)
            if isinstance(parts, list):
                chunks: List[str] = []
                for p in parts:
                    t = getattr(p, "text", None)
                    if isinstance(t, str):
                        chunks.append(t)
                joined = "".join(chunks)
                if joined.strip():
                    return joined
    except Exception:
        pass
    return None


def _get_usage_counts(resp: Any) -> Dict[str, Optional[int]]:
    """Best-effort token usage extraction across google-genai versions."""
    out: Dict[str, Optional[int]] = {
        "prompt_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
    }
    if resp is None:
        return out

    usage = getattr(resp, "usage_metadata", None) or getattr(resp, "usage", None)
    if usage is None:
        return out

    if isinstance(usage, dict):
        get = usage.get
        for k in ("prompt_token_count", "prompt_tokens", "input_tokens"):
            if isinstance(get(k), int):
                out["prompt_tokens"] = get(k)
                break
        for k in ("candidates_token_count", "output_tokens", "completion_tokens"):
            if isinstance(get(k), int):
                out["output_tokens"] = get(k)
                break
        for k in ("total_token_count", "total_tokens"):
            if isinstance(get(k), int):
                out["total_tokens"] = get(k)
                break
        return out

    for attr in ("prompt_token_count", "prompt_tokens", "input_tokens"):
        v = getattr(usage, attr, None)
        if isinstance(v, int):
            out["prompt_tokens"] = v
            break
    for attr in ("candidates_token_count", "output_tokens", "completion_tokens"):
        v = getattr(usage, attr, None)
        if isinstance(v, int):
            out["output_tokens"] = v
            break
    for attr in ("total_token_count", "total_tokens"):
        v = getattr(usage, attr, None)
        if isinstance(v, int):
            out["total_tokens"] = v
            break

    return out


def _parse_json_text(text: Optional[str]) -> Any:
    if not text:
        raise ValueError("Analytics AI model returned empty response")
    return json.loads(text)


def _empty_usage() -> Dict[str, Optional[int]]:
    return {"prompt_tokens": None, "output_tokens": None, "total_tokens": None}


_RESEARCH_WEB_SEARCH_BLOCK = """Web research (Google Search is enabled):
- Use Google Search to verify current law, rates, thresholds, effective dates, proposed
  rules, recent ASUs, and guidance issued after your training cutoff.
- Prefer authoritative sources (tax: irs.gov, treasury.gov, law.cornell.edu; GAAP:
  fasb.org, sec.gov, pcaobus.org, aicpa.org).
- Combine uploaded Document Context (client-specific facts, line items, amounts) with
  web-grounded authorities. Read Document Context directly for facts; use web search
  for up-to-date rules and whether guidance has changed.
- When citing web-sourced information, note the source domain or publication where helpful.
- Do not describe your search process in the answer (no "Let me search…"); deliver the
  final polished response only."""


def _serialize_grounding_metadata(resp: Any) -> Optional[Dict[str, Any]]:
    """Extract Google Search grounding sources from a Gemini response."""
    if resp is None:
        return None
    try:
        candidates = getattr(resp, "candidates", None)
        if not isinstance(candidates, list) or not candidates:
            return None
        gm = getattr(candidates[0], "grounding_metadata", None)
        if gm is None:
            return None

        queries = getattr(gm, "web_search_queries", None) or []
        sources: List[Dict[str, str]] = []
        seen_domains: set[str] = set()
        chunks = getattr(gm, "grounding_chunks", None) or []
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if web is None:
                continue
            domain = getattr(web, "domain", None) or ""
            if domain and domain in seen_domains:
                continue
            if domain:
                seen_domains.add(domain)
            title = getattr(web, "title", None) or domain
            uri = getattr(web, "uri", None) or ""
            if domain or uri:
                sources.append({"domain": domain, "title": title, "uri": uri})

        if not queries and not sources:
            return None
        return {
            "web_search_queries": list(queries) if queries else [],
            "sources": sources,
        }
    except Exception:
        logger.debug("Failed to serialize grounding metadata", exc_info=True)
        return None


def _structured_json_config(
    *,
    response_schema: types.Schema,
) -> types.GenerateContentConfig:
    """JSON schema config for short analytics LLM responses.

    Thinking tokens come out of max_output_tokens, so a small cap truncates
    structured JSON to ``{`` and surfaces as a 500.
    """
    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=response_schema,
        max_output_tokens=_MIN_OUTPUT_TOKENS,
        thinking_config=_LOW_THINKING,
    )


# ---------------------------------------------------------------------------
# Reconciliation: rule generation, additional pass, AI-assisted match
# ---------------------------------------------------------------------------

def _reconciliation_pass_schema(required_id: bool = True) -> types.Schema:
    rule_schema = types.Schema(
        type="OBJECT",
        properties={
            "id": types.Schema(type="STRING"),
            "type": types.Schema(type="STRING"),
            "config": types.Schema(type="OBJECT"),
        },
        required=["id", "type"],
    )
    properties = {
        "id": types.Schema(type="STRING"),
        "name": types.Schema(type="STRING"),
        "matchTypes": types.Schema(
            type="ARRAY",
            items=types.Schema(
                type="STRING",
                enum=["1:1", "1:Many", "Many:1", "Many:Many"],
            ),
        ),
        "logic": types.Schema(type="STRING", enum=["AND", "OR"]),
        "rules": types.Schema(type="ARRAY", items=rule_schema),
    }
    required = ["id", "name", "matchTypes", "logic", "rules"] if required_id else [
        "name",
        "matchTypes",
        "logic",
        "rules",
    ]
    return types.Schema(type="OBJECT", properties=properties, required=required)


async def generate_reconciliation_rules(
    headers: List[str],
    available_rules: Any,
) -> Tuple[List[Dict[str, Any]], Dict[str, Optional[int]]]:
    """Generate a recommended set of reconciliation matching passes."""
    client = get_client()
    headers_list = ", ".join([f'"{h}"' for h in headers])
    prompt = f"""You are a reconciliation expert. The user has uploaded two datasets with the following columns:
[{headers_list}]

Please create a recommended set of matching "passes" to automatically reconcile these datasets.
You MUST only use the rules from the 'availableRules' library below. Note that rule names should match the rules array elements in the available rules exactly.
Available rules grouped by category:
{json.dumps(available_rules, indent=2)}

Produce your response as an array of passes. Each pass must have a "name", "matchTypes" array (from '1:1', '1:Many', 'Many:1', 'Many:Many'), "logic" ('AND' or 'OR'), and an array of "rules".
Each rule is an object with "type" matching exactly an element string in the availableRules rules arrays.

For example, a standard reconciliation might have 4 passes:
1. Exact Match (1:1, AND): Amount - Exact Match, Date - Exact
2. Near Match (1:1, AND): Amount - Exact Match, Date - Range
3. Group Match (1:Many, Many:1, AND): Amount - Sum Match, Date - Range
4. Complex Group Match (Many:Many, AND): Amount - Sum Match, Date - Range

CRITICAL: You MUST include at least one pass with the "Many:Many" matchType in your response, as the user expects to see advanced many-to-many reconciliation logic.

Generate passes specifically tailored to the columns provided."""

    response_schema = types.Schema(
        type="ARRAY",
        items=_reconciliation_pass_schema(required_id=True),
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=_structured_json_config(response_schema=response_schema),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


async def generate_additional_reconciliation_pass(
    instructions: str,
    available_rules: Any,
) -> Tuple[Dict[str, Any], Dict[str, Optional[int]]]:
    client = get_client()
    prompt = f"""You are a reconciliation expert. The user wants to add a specific rule or pass to their reconciliation engine.
User Request: "{instructions}"

Available rules grouped by category:
{json.dumps(available_rules, indent=2)}

Create exactly ONE "pass" that satisfies the user's request using ONLY the available rules provided.
The pass must have a "name", "matchTypes" array (from '1:1', '1:Many', 'Many:1', 'Many:Many'), "logic" ('AND' or 'OR'), and an array of "rules".
Each rule object must have a "type" matching an element from the availableRules."""

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=_structured_json_config(response_schema=_reconciliation_pass_schema(required_id=True)),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


async def perform_ai_assisted_match(
    source_a: List[Dict[str, Any]],
    source_b: List[Dict[str, Any]],
    rules: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, Optional[int]]]:
    """Run AI-assisted reconciliation matching.

    Returns a dict with ``matchGroups`` and ``unmatchedExceptions`` arrays so the
    caller can populate both the Matched and Exceptions tabs. The dict shape
    matches the JSON schema enforced by the model.
    """
    client = get_client()
    enriched_a = [{**t, "absoluteAmount": abs(t.get("amount", 0) or 0)} for t in source_a]
    enriched_b = [{**t, "absoluteAmount": abs(t.get("amount", 0) or 0)} for t in source_b]

    prompt = f"""You are an expert accountant performing reconciliation.
Given two lists of transactions (Source A and Source B) and a set of matching rules, your task is to identify matching groups of transactions and categorize any unmatched exceptions.
CRITICAL MATHEMATICAL INSTRUCTION: Use the 'absoluteAmount' property supplied on the transactions for all matching logic. For Group Matches / Sum Matches, the sum of 'absoluteAmount' for the Source A group must EXACTLY match the sum of 'absoluteAmount' for the Source B group.

Source A (e.g., Bank):
{json.dumps(enriched_a, indent=2)}

Source B (e.g., G/L):
{json.dumps(enriched_b, indent=2)}

Rules to apply:
{json.dumps(rules, indent=2)}

Return an object with two arrays:

1. `matchGroups`: matched transaction groups with confidence scores.
A match group can be:
- 1:1 (one from A, one from B)
- 1:Many (one from A, multiple from B)
- Many:1 (multiple from A, one from B)
- Many:Many (multiple from A, multiple from B)

For each group, provide a clear explanation referencing dates, descriptions, and absolute amounts. Provide a unique ID for each match group starting at g1000. For groups, sum the absolute amounts of A to verify it equals the sum of absolute amounts of B.

2. `unmatchedExceptions`: every transaction id from either source that is NOT included in any match group. For each, classify the reason using one of:
- TIMING — likely matches across a different cutoff period (date crosses period boundary).
- BANK_FEE — small charge from the bank side with no corresponding ledger entry.
- AMOUNT_MISMATCH — a 1:1-like counterpart exists but the amounts differ by a small delta.
- MISSING_COMPONENT — a 1:Many would have matched but one or more components on the multi side are absent (the partial sum is short or over).
- RECON_VARIANCE — a Many:1 would have matched but the components on the multi side don't sum to the target (a delta remains after summing).
- COMPLEX_VARIANCE — a Many:Many candidate where no valid subset of either side sums to a clean match.
- MISSING — counterpart appears entirely absent from the other source.

For each exception, include `id`, `source` ("A" or "B"), `exceptionCategory`, and a one-sentence `exceptionReasoning` that names the specific evidence.
Every unmatched transaction must appear in exactly one of `unmatchedExceptions`. Do not leave matched transactions in `unmatchedExceptions`.
"""

    match_group_schema = types.Schema(
        type="OBJECT",
        properties={
            "id": types.Schema(type="STRING"),
            "type": types.Schema(
                type="STRING",
                enum=["1:1", "1:Many", "Many:1", "Many:Many"],
            ),
            "sourceAIds": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
            "sourceBIds": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
            "totalA": types.Schema(type="NUMBER"),
            "totalB": types.Schema(type="NUMBER"),
            "confidence": types.Schema(type="NUMBER"),
            "explanation": types.Schema(type="STRING"),
            "status": types.Schema(type="STRING", enum=["suggested", "approved"]),
        },
        required=[
            "id",
            "type",
            "sourceAIds",
            "sourceBIds",
            "totalA",
            "totalB",
            "confidence",
            "explanation",
            "status",
        ],
    )

    exception_schema = types.Schema(
        type="OBJECT",
        properties={
            "id": types.Schema(type="STRING"),
            "source": types.Schema(type="STRING", enum=["A", "B"]),
            "exceptionCategory": types.Schema(
                type="STRING",
                enum=[
                    "TIMING",
                    "BANK_FEE",
                    "AMOUNT_MISMATCH",
                    "MISSING_COMPONENT",
                    "RECON_VARIANCE",
                    "COMPLEX_VARIANCE",
                    "MISSING",
                ],
            ),
            "exceptionReasoning": types.Schema(type="STRING"),
        },
        required=["id", "source", "exceptionCategory", "exceptionReasoning"],
    )

    response_schema = types.Schema(
        type="OBJECT",
        properties={
            "matchGroups": types.Schema(type="ARRAY", items=match_group_schema),
            "unmatchedExceptions": types.Schema(type="ARRAY", items=exception_schema),
        },
        required=["matchGroups", "unmatchedExceptions"],
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    if not isinstance(parsed, dict):
        parsed = {"matchGroups": parsed if isinstance(parsed, list) else [], "unmatchedExceptions": []}
    parsed.setdefault("matchGroups", [])
    parsed.setdefault("unmatchedExceptions", [])
    return parsed, _get_usage_counts(resp)


async def reconcile_basic(
    source_a: List[Dict[str, Any]],
    source_b: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Optional[int]]]:
    """Simple reconciliation without a rule library — used as a fallback path."""
    client = get_client()
    prompt = f"""You are an expert accountant. Reconcile these two lists of transactions.

Source A (Bank Statement):
{json.dumps(source_a)}

Source B (Ledger):
{json.dumps(source_b)}

Find matches between Source A and Source B. Some might be 1:1, 1:Many, Many:1, or Many:Many.
Return a JSON array of match groups. Each group should have:
- id: a unique string ID
- sourceAIds: array of string IDs from Source A
- sourceBIds: array of string IDs from Source B
- matchType: "1:1", "1:Many", "Many:1", or "Many:Many"
- confidence: number between 0 and 100
- reason: string explaining why they match
- status: "suggested"
"""
    response_schema = types.Schema(
        type="ARRAY",
        items=types.Schema(
            type="OBJECT",
            properties={
                "id": types.Schema(type="STRING"),
                "sourceAIds": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
                "sourceBIds": types.Schema(type="ARRAY", items=types.Schema(type="STRING")),
                "matchType": types.Schema(type="STRING"),
                "confidence": types.Schema(type="NUMBER"),
                "reason": types.Schema(type="STRING"),
                "status": types.Schema(type="STRING"),
            },
            required=["id", "sourceAIds", "sourceBIds", "matchType", "confidence", "reason", "status"],
        ),
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


# ---------------------------------------------------------------------------
# Amortization extraction + compliance check
# ---------------------------------------------------------------------------

async def extract_amortization(
    document_text: str,
) -> Tuple[Dict[str, Any], Dict[str, Optional[int]]]:
    client = get_client()
    prompt = f"""Extract amortization or lease details from the following document text.

Document Text:
{document_text}

Return a JSON object with the extracted fields and confidence scores."""

    response_schema = types.Schema(
        type="OBJECT",
        properties={
            "form": types.Schema(
                type="OBJECT",
                properties={
                    "assetName": types.Schema(type="STRING"),
                    "assetType": types.Schema(type="STRING"),
                    "vendor": types.Schema(type="STRING"),
                    "costBasis": types.Schema(type="NUMBER"),
                    "startDate": types.Schema(type="STRING"),
                    "usefulLifeMonths": types.Schema(type="NUMBER"),
                    "gaapMethod": types.Schema(type="STRING"),
                    "leaseClassification": types.Schema(type="STRING"),
                    "paymentAmount": types.Schema(type="NUMBER"),
                    "paymentFrequency": types.Schema(type="STRING"),
                    "paymentTiming": types.Schema(type="STRING"),
                    "ibr": types.Schema(type="NUMBER"),
                },
            ),
            "confidenceScores": types.Schema(
                type="OBJECT",
                properties={
                    "assetName": types.Schema(type="NUMBER"),
                    "assetType": types.Schema(type="NUMBER"),
                    "vendor": types.Schema(type="NUMBER"),
                    "startDate": types.Schema(type="NUMBER"),
                    "usefulLifeMonths": types.Schema(type="NUMBER"),
                    "paymentAmount": types.Schema(type="NUMBER"),
                    "ibr": types.Schema(type="NUMBER"),
                },
            ),
        },
        required=["form", "confidenceScores"],
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


async def amortization_compliance_check(
    form: Dict[str, Any],
) -> Tuple[str, Dict[str, Optional[int]]]:
    client = get_client()
    prompt = f"""You are a strict CPA AI assistant. The user is registering a new asset:
- Asset Type: {form.get('assetType')}
- GAAP Method: {form.get('gaapMethod')}
- Useful Life (Months): {form.get('usefulLifeMonths')}
- Cost Basis: {form.get('costBasis')}

Provide a brief (max 2 sentences) compliance insight based on US GAAP and ASC guidelines. Mention relevant ASC codes like ASC 350-40, ASC 842 or ASC 360 if applicable. Be professional and concise. Don't use markdown bold text asterisks."""

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
    )
    text = _get_resp_text(resp) or ""
    return text, _get_usage_counts(resp)


# ---------------------------------------------------------------------------
# Document extraction (research bots) and waterfall extraction
# ---------------------------------------------------------------------------

_MAX_DOCUMENT_EXTRACT_CHARS = 120_000


def _coerce_summary(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


async def extract_document(
    document_text: str,
    doc_type: str,
) -> Tuple[Dict[str, Any], Dict[str, Optional[int]]]:
    """Extract structured key/value data from a tax or financial document.

    The original Firestore server used `additionalProperties` for extractedData.
    Vertex AI's structured-output Schema doesn't reliably support open-ended
    maps, so we ask for an array of {key, value} pairs and convert to a dict.
    """
    client = get_client()
    label = "Tax" if doc_type == "IRS" else "Financial"
    body = document_text or ""
    truncated_note = ""
    if len(body) > _MAX_DOCUMENT_EXTRACT_CHARS:
        body = body[:_MAX_DOCUMENT_EXTRACT_CHARS]
        truncated_note = (
            f"\n(Note: document text was truncated to the first {_MAX_DOCUMENT_EXTRACT_CHARS} characters.)"
        )
    prompt = f"""Analyze the following document and extract key data for a {label} context.
Document text:
{body}{truncated_note}

Provide a short "summary" describing the document type and a high-level overview.
Also provide "extractedData", which should be a comprehensive array of key-value pairs covering all important fields, amounts, entities, dates, structural points, and numerical data found in the document. Each item must be an object with "key" and "value" (both strings).

Return a JSON object conforming strictly to the schema provided."""

    response_schema = types.Schema(
        type="OBJECT",
        properties={
            "summary": types.Schema(type="STRING"),
            "extractedData": types.Schema(
                type="ARRAY",
                items=types.Schema(
                    type="OBJECT",
                    properties={
                        "key": types.Schema(type="STRING"),
                        "value": types.Schema(type="STRING"),
                    },
                    required=["key", "value"],
                ),
            ),
        },
        required=["summary", "extractedData"],
    )

    try:
        resp = await client.aio.models.generate_content(
            model=ANALYTICS_MODEL,
            contents=prompt,
            config=_structured_json_config(response_schema=response_schema),
        )
    except Exception as exc:
        raise RuntimeError(f"Document extraction model call failed: {exc}") from exc

    text = _get_resp_text(resp)
    if not text or not text.strip():
        raise ValueError("Analytics AI model returned empty document extraction response")

    try:
        parsed = _parse_json_text(text)
    except Exception as first_parse_exc:
        # One retry without schema enforcement if the model returned malformed JSON.
        logger.warning("Document extract JSON parse failed, retrying: %s", first_parse_exc)
        retry = await client.aio.models.generate_content(
            model=ANALYTICS_MODEL,
            contents=prompt + "\n\nRespond with valid JSON only.",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                max_output_tokens=_MIN_OUTPUT_TOKENS,
                thinking_config=_LOW_THINKING,
            ),
        )
        resp = retry
        text = _get_resp_text(retry)
        parsed = _parse_json_text(text)

    pairs = parsed.get("extractedData", []) if isinstance(parsed, dict) else []
    if isinstance(parsed, dict) and isinstance(parsed.get("extractedData"), dict):
        # Some model turns return a map instead of an array — normalize it.
        pairs = [{"key": k, "value": v} for k, v in parsed["extractedData"].items()]

    extracted_map: Dict[str, str] = {}
    for pair in pairs:
        if isinstance(pair, dict):
            k = pair.get("key")
            v = pair.get("value")
            if isinstance(k, str) and k:
                extracted_map[k] = "" if v is None else str(v)

    return (
        {
            "summary": _coerce_summary(parsed.get("summary") if isinstance(parsed, dict) else None),
            "extractedData": extracted_map,
        },
        _get_usage_counts(resp),
    )


async def extract_waterfall(
    document_text: str,
) -> Tuple[Dict[str, Any], Dict[str, Optional[int]]]:
    client = get_client()
    fallback = "Acme Corp SaaS License Agreement. Customer: Acme Corp. Total Value: $120,000. Term: Jan 1, 2026 to Dec 31, 2026. Billed upfront."
    body = document_text or fallback
    prompt = f"""You are an accounting document extraction specialist for revenue recognition and expense scheduling. Given a financial document, extract fields needed to create a waterfall schedule.

For REVENUE CONTRACTS, extract: Contract parties, effective dates, term, Total consideration, Performance obligations.
For PREPAID EXPENSE INVOICES, extract: Vendor, invoice number, payment date, Total amount, coverage/benefit period.
For COMMISSION PLANS/STATEMENTS, extract: Sales rep name, deal/customer reference, Commission amount, rate, payment date, Contract term.
For ACCRUAL DOCUMENTATION, extract: Expense type, estimated total, accrual period.

Document Text:
{body}

Return structured JSON with the extracted fields and confidence scores (0-100)."""

    response_schema = types.Schema(
        type="OBJECT",
        properties={
            "type": types.Schema(
                type="STRING",
                description="One of: Deferred Revenue, Prepaid Expenses, Accrued Expenses, Deferred Commission",
            ),
            "name": types.Schema(type="STRING"),
            "partyName": types.Schema(type="STRING"),
            "totalAmount": types.Schema(type="NUMBER"),
            "startDate": types.Schema(type="STRING"),
            "endDate": types.Schema(type="STRING"),
            "confidenceScores": types.Schema(
                type="OBJECT",
                properties={
                    "name": types.Schema(type="NUMBER"),
                    "partyName": types.Schema(type="NUMBER"),
                    "totalAmount": types.Schema(type="NUMBER"),
                    "startDate": types.Schema(type="NUMBER"),
                    "endDate": types.Schema(type="NUMBER"),
                },
            ),
        },
        required=[
            "type",
            "name",
            "partyName",
            "totalAmount",
            "startDate",
            "endDate",
            "confidenceScores",
        ],
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


# ---------------------------------------------------------------------------
# Variance analysis: threshold suggestion, per-account analysis, memo
# ---------------------------------------------------------------------------

def _amount_for_threshold(row: Dict[str, Any]) -> float:
    for key in row.keys():
        low = key.lower()
        if "amount" in low or "balance" in low:
            raw = row.get(key)
            if raw is None:
                return 0.0
            cleaned = "".join(ch for ch in str(raw) if ch.isdigit() or ch in (".", "-"))
            try:
                return float(cleaned) if cleaned else 0.0
            except ValueError:
                return 0.0
    return 0.0


async def variance_suggest_threshold(
    data: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, Optional[int]]]:
    client = get_client()
    amounts = [a for a in (_amount_for_threshold(row) for row in data) if a != 0]
    sample = ", ".join(str(a) for a in amounts[:100])
    truncated = " ... (truncated)" if len(amounts) > 100 else ""
    max_amount = max(amounts) if amounts else 0
    min_amount = min(amounts) if amounts else 0

    prompt = f"""
You are an expert CPA and auditor. Based on the following financial data amounts from a client's trial balance or GL, suggest an appropriate materiality threshold for a variance analysis.

Total Accounts: {len(data)}
Non-zero Amounts: {sample}{truncated}
Max Amount: {max_amount}
Min Amount: {min_amount}

Suggest:
1. A dollar threshold (e.g., 10000, 50000, 100000)
2. A percentage threshold (e.g., 5, 10, 15)
3. The logic to use: exactly "Either" (Dollar OR Percent) or "Both" (Dollar AND Percent)
4. A brief explanation for your recommendation.

Return ONLY a JSON object with the following keys:
- thresholdDollar (number)
- thresholdPercent (number)
- logic (string — must be exactly "Either" or "Both")
- explanation (string)
"""
    response_schema = types.Schema(
        type="OBJECT",
        properties={
            "thresholdDollar": types.Schema(type="NUMBER"),
            "thresholdPercent": types.Schema(type="NUMBER"),
            "logic": types.Schema(type="STRING", enum=["Either", "Both"]),
            "explanation": types.Schema(type="STRING"),
        },
        required=["thresholdDollar", "thresholdPercent", "logic", "explanation"],
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=_structured_json_config(response_schema=response_schema),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


async def variance_analyze(
    data: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Optional[int]]]:
    client = get_client()
    prompt = f"""
You are a variance analysis assistant for CPAs. You are generating flux explanations for a financial analysis.

For each flagged account, provide:
1. A clear, professional explanation of the most likely driver(s) of the variance based on the provided description/memo and department (if available).
2. A confidence level (High, Medium, Low) based on how obvious the driver is from the data alone.
3. A suggested follow-up action the preparer should take.

Rules:
- Reference specific dollar amounts and percentages in your explanation.
- Use professional accounting language appropriate for workpapers.
- Never fabricate a specific transaction or event.
- Accounting Logic: A positive amount represents a debit, and a negative amount represents a credit.
- For Asset and Expense accounts, a debit (positive amount) represents an increase.
- For Liability, Equity, and Revenue accounts, a credit (negative amount) represents an increase.
- Use the provided 'description' field (transaction memo) and 'department' field to explain the flux.

Data: {json.dumps(data)}

Return ONLY a JSON array of objects with the following keys:
- id: The original id of the item
- explanation: The explanation string
- confidence: "High", "Medium", or "Low"
- followUp: The follow-up action string
"""
    response_schema = types.Schema(
        type="ARRAY",
        items=types.Schema(
            type="OBJECT",
            properties={
                "id": types.Schema(type="STRING"),
                "explanation": types.Schema(type="STRING"),
                "confidence": types.Schema(type="STRING"),
                "followUp": types.Schema(type="STRING"),
            },
            required=["id", "explanation", "confidence", "followUp"],
        ),
    )

    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    text = _get_resp_text(resp)
    parsed = _parse_json_text(text)
    return parsed, _get_usage_counts(resp)


async def variance_memo(
    data: List[Dict[str, Any]],
    config: Dict[str, Any],
    *,
    analysis_name: str = "Not provided",
    client_name: str = "Not provided",
    as_of_date: Optional[str] = None,
) -> Tuple[str, Dict[str, Optional[int]]]:
    client = get_client()
    generation_date = as_of_date or date.today().isoformat()
    flagged = [d for d in data if d.get("isFlagged")]
    flagged_details = [
        {
            "account": d.get("accountName"),
            "accountType": d.get("accountType"),
            "department": d.get("department"),
            "base": d.get("baseAmount"),
            "comp": d.get("compAmount"),
            "variance": d.get("variance"),
            "variancePercent": d.get("variancePercent"),
            "description": d.get("description"),
            "explanation": d.get("explanation") or "Requires manual review",
        }
        for d in flagged
    ]

    prompt = f"""
You are a Senior CPA. Generate a formal Variance Analysis Memorandum based on the following data.

Authoritative workpaper context:
- Client: {client_name}
- Analysis: {analysis_name}
- Base period: {config.get('basePeriodStart') or 'Not provided'} through {config.get('basePeriodEnd') or 'Not provided'}
- Comparison period: {config.get('compPeriodStart') or 'Not provided'} through {config.get('compPeriodEnd') or 'Not provided'}
- As-of / generation date: {generation_date}

Configuration:
- Thresholds: ${config.get('thresholdDollar')} or {config.get('thresholdPercent')}%
- Logic: {config.get('logic')}

Total Accounts: {len(data)}
Flagged Accounts: {len(flagged)}

Flagged Data Details:
{json.dumps(flagged_details)}

Format the output as a professional Markdown document with the following sections:
1. EXECUTIVE SUMMARY
2. MATERIALITY & METHODOLOGY
3. MATERIAL VARIANCE DETAIL (make every account a level-three heading using its exact provided account name; list top variances with explanations. Note: Positive amounts are debits, negative are credits. Debits increase Assets/Expenses, Credits increase Liabilities/Equity/Revenue)
4. CONCLUSION & RECOMMENDATIONS

Evidence rules:
- Use only facts explicitly present in the authoritative context or Flagged Data Details.
- Never infer or invent dates, transactions, causes, business events, account names, amounts, percentages, client facts, or conclusions.
- If support for a cause, fact, or recommendation is absent, write "Not provided" and recommend reviewer follow-up.
- Preserve account names exactly as provided. Express monetary values with a dollar sign and full digits (no K/M abbreviations).
- Use ISO YYYY-MM-DD dates exactly as supplied. Do not introduce fiscal years, quarter labels, or other dates.
- Do not add a title or client/date header; the application adds a validated header.

Use professional, objective tone suitable for an audit workpaper or management reporting. This is a review-required draft, not a finalized workpaper.
"""
    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
    )
    body = _get_resp_text(resp) or ""
    header = (
        "# Variance Analysis Memorandum\n\n"
        f"**Client:** {client_name}\n\n"
        f"**Analysis:** {analysis_name}\n\n"
        f"**Base period:** {config.get('basePeriodStart') or 'Not provided'} through "
        f"{config.get('basePeriodEnd') or 'Not provided'}\n\n"
        f"**Comparison period:** {config.get('compPeriodStart') or 'Not provided'} through "
        f"{config.get('compPeriodEnd') or 'Not provided'}\n\n"
        f"**As of:** {generation_date}\n\n"
        "**Status:** Draft — reviewer approval required\n\n"
    )
    return header + body.strip(), _get_usage_counts(resp)


# ---------------------------------------------------------------------------
# Streaming routes: AI assistant, IRS research, GAAP research, basic chat
# ---------------------------------------------------------------------------

def _to_gemini_contents(messages: List[Dict[str, Any]]) -> List[types.Content]:
    """Convert frontend role/content messages to Gemini content list.

    Drops leading model messages (Gemini requires the first turn to be 'user')
    and skips messages without content.
    """
    filtered = [m for m in messages if m.get("content")]
    while filtered and filtered[0].get("role") == "model":
        filtered = filtered[1:]
    contents: List[types.Content] = []
    for m in filtered:
        role = "user" if m.get("role") == "user" else "model"
        contents.append(
            types.Content(role=role, parts=[types.Part.from_text(text=m["content"])])
        )
    return contents


def _safety_settings_assistant() -> List[types.SafetySetting]:
    return [
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH,
        ),
    ]


def _ai_assistant_system_instruction(
    active_module: Optional[str],
    module_data: Optional[Any],
) -> str:
    data_context = "Tailor your response to this context if applicable."
    if module_data is not None:
        try:
            serialized = json.dumps(module_data, default=str)[:30000]
            data_context = (
                f"Current Screen/Project Data Context:\n{serialized}\n"
                "Use the provided Data Context to give extremely specific, data-driven answers. "
                "You can refer to exact account names, dollar amounts, match IDs, and configuration rules you observe in the JSON context."
            )
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"Failed to serialize module data for AI assistant context: {e}")

    module_label = active_module or "Platform"
    return f"""You are the AI Assistant for CPA Analytics Platform, a professional tool
used by Certified Public Accountants and accounting teams. You are an expert
in US GAAP (ASC 606, ASC 842, ASC 350, ASC 340-40, ASC 835), tax
regulations (MACRS, Section 179, bonus depreciation), variance & flux
analysis, financial reconciliation, fixed assets, and revenue/expense
waterfall scheduling.

Rules:
- Always provide accurate, professional accounting guidance
- Cite specific ASC standards when relevant
- If uncertain, say so and recommend consulting authoritative guidance
- Never fabricate financial figures or journal entries not based on user data
- Use plain professional language; avoid jargon unless the user uses it first
- When referencing the user's data, be specific (account names, amounts, dates)
- Format responses with markdown: use tables, bold, bullet points for clarity
- Keep responses concise unless the user asks for detailed explanation

Current Context:
The user is currently in the {module_label} module.
{data_context}

Module-Specific Behaviors:
- Variance & Flux Analysis: Explain top variances citing account names/amounts, compare to historical patterns/industry norms, draft formatted variance memos, recommend materiality thresholds.
- Intelligent Reconciliation: Analyze unmatched transactions, suggest matches based on description/amount, calculate/explain reconciling differences, classify timing differences, recommend tolerances.
  SPECIAL FEATURE: If the user explicitly asks you to add, create, or suggest a new rule/pass in the Matching Configuration, you must append an action tag at the very end of your response exactly like this: [ACTION:ADD_RECON_PASS: <rule logic summary>]. For example: "I will add a fuzzy matching rule for invoices. [ACTION:ADD_RECON_PASS: Fuzzy match description and exact match amount]"
- Fixed Assets: Recommend GAAP/Tax methods, explain GAAP vs Tax differences, calculate ROU assets, explain lease modifications, verify schedule math.
- AI Waterfall Schedule: Sum upcoming recognition, evaluate contract terms against ASC 606, aggregate remaining performance obligations, explain deferred balances, model early terminations.
- IRS Researcher Bot: If asked general tax questions, provide brief answers with IRC citations and suggest opening a full research session in the IRS Researcher Bot.
- GAAP Bot: If asked general GAAP questions, provide brief answers with ASC citations and suggest opening a full research session in the GAAP Bot."""


async def stream_ai_assistant(
    messages: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
) -> AsyncGenerator[Tuple[str, Any], None]:
    """Stream the AI assistant response.

    Yields ("chunk", str) for each text chunk and a final ("usage", dict).
    """
    client = get_client()
    context = context or {}
    system_instruction = _ai_assistant_system_instruction(
        active_module=context.get("activeModule"),
        module_data=context.get("moduleData"),
    )

    contents = _to_gemini_contents(messages)
    if not contents:
        contents = [types.Content(role="user", parts=[types.Part.from_text(text="Hello")])]

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        max_output_tokens=_MIN_OUTPUT_TOKENS,
        safety_settings=_safety_settings_assistant(),
    )

    last_resp: Any = None
    stream = await client.aio.models.generate_content_stream(
        model=ANALYTICS_MODEL,
        contents=contents,
        config=config,
    )
    async for chunk in stream:
        last_resp = chunk
        text = _get_resp_text(chunk)
        if text:
            yield ("chunk", text)

    yield ("usage", _get_usage_counts(last_resp))


def _research_system_instruction(bot: str, output_style: str, document_context: Optional[str]) -> str:
    if bot == "irs":
        domain_block = f"""You are the IRS Researcher Bot for CPA Analytics Platform, a professional
tax research assistant used by Certified Public Accountants and tax
professionals. You are an expert in:

- Internal Revenue Code (IRC) — all titles and sections
- Treasury Regulations (Treas. Reg.) — proposed, temporary, and final
- IRS Revenue Rulings (Rev. Rul.) and Revenue Procedures (Rev. Proc.)
- IRS Notices, Announcements, and Information Letters
- Private Letter Rulings (PLR) and Technical Advice Memoranda (TAM)
- Tax Court cases, Circuit Court decisions, and Supreme Court tax cases
- IRS Publications and Instructions
- MACRS depreciation tables and conventions
- Section 179, Bonus Depreciation, and cost recovery rules
- Individual tax (Form 1040 series), Corporate tax (1120),
  Partnership (1065), S-Corp (1120-S), Trust/Estate (1041)
- Employment tax (941, 940), Information returns (1099 series, W-2)
- International tax provisions (GILTI, BEAT, FDII, Subpart F)
- State tax conformity with federal IRC

Rules:
- ALWAYS cite the specific IRC section, Treasury Regulation, or
  authoritative guidance supporting your answer
- Use the format: IRC §XXX(a)(1), Treas. Reg. §1.XXX-X, Rev. Rul. YYYY-XX
- Render citations as **highlighted inline references** (e.g., `IRC §162(a)`)
- Each citation must include a brief parenthetical explaining its relevance
- When analyzing uploaded documents, reference specific line items,
  amounts, and form fields by name. The ENTIRE text of each uploaded document is in Document Context.
{_RESEARCH_WEB_SEARCH_BLOCK}
- If the law is ambiguous or there are conflicting authorities, present
  both sides and indicate the weight of authority
- If uncertain, state so explicitly and recommend the user consult
  primary sources or engage a tax attorney
- Never fabricate IRC sections, case citations, or regulatory references
- Clearly distinguish between current law, proposed regulations,
  and expired/sunset provisions
- Note effective dates and any phase-in/phase-out thresholds
- Format responses with markdown for readability"""
        memo_section = """IF Output Style is "Tax Research Memo":
# TAX RESEARCH MEMORANDUM
**Prepared by:** CPA Analytics — IRS Researcher Bot
**Date:** [Current date]
**Re:** [Auto-generated subject line based on the research question]
---
## I. ISSUE(S)
[Precise statement of the tax issue(s) to be researched, framed as questions. Numbered if multiple.]
## II. SHORT ANSWER
[Brief, definitive answer to each issue — typically 1-2 sentences per issue.]
## III. FACTS
[Relevant facts extracted from uploaded documents and user-provided information. Specific amounts, dates, entities, and transactions.]
## IV. APPLICABLE AUTHORITY
### A. Internal Revenue Code
- IRC §XXX — [Section title and relevant subsection text, paraphrased]
### B. Treasury Regulations
- Treas. Reg. §1.XXX-X — [Regulation description and application]
### C. IRS Guidance
- Rev. Rul. YYYY-XX — [Holding and relevance]
### D. Case Law (if applicable)
- [Case name], [Court], [Year] — [Holding and relevance]
## V. ANALYSIS
[Detailed analysis applying the authority to the facts. Addresses each issue separately. Discusses conflicting authority.]
## VI. CONCLUSION
[Final conclusion for each issue with recommended treatment.]
## VII. RECOMMENDED ACTIONS
1. [Specific action items — filing positions, elections, disclosures, etc.]
## VIII. CAVEATS & LIMITATIONS
- This memo is based on current tax law as of [date] and the facts as provided
- AI-generated research — should be reviewed by a qualified tax professional
- [Any specific caveats about ambiguous areas or pending legislation]"""
        qa_authority = "- IRC §XXX(a)(1) — [brief description]\n- Treas. Reg. §1.XXX-X(b) — [brief description]"
        summary_table = "| IRC §XXX | [Why it applies] | [Dollar or compliance impact] |"
        summary_provisions_header = "## Applicable Tax Provisions"
        summary_issue_ref = "See IRC §XXX"
    else:
        domain_block = f"""You are the GAAP Bot for CPA Analytics Platform, a professional
accounting standards research assistant used by Certified Public
Accountants and accounting professionals. You are an expert in:

- FASB Accounting Standards Codification (ASC) — all topics
- FASB Accounting Standards Updates (ASUs) — current and historical
- SEC Regulation S-X, Regulation S-K, and Staff Accounting Bulletins (SABs)
- PCAOB Auditing Standards (AS) and Staff Guidance
- AICPA Professional Standards and Technical Practice Aids
- Key ASC Topics in depth:
  - Revenue: ASC 606 — five-step model, performance obligations, variable consideration, contract modifications, principal vs. agent, licensing, warranties, bill-and-hold, consignment
  - Leases: ASC 842 — classification, measurement, modifications, sale-leaseback, sublease, remeasurement triggers, short-term elections, practical expedients
  - Financial Instruments: ASC 320/321/326 — debt/equity securities, impairment, CECL, hedge accounting (ASC 815)
  - Business Combinations: ASC 805 — acquisition method, purchase price allocation, goodwill, bargain purchases, contingent consideration
  - Income Taxes: ASC 740 — deferred taxes, uncertain tax positions (FIN 48/ASC 740-10), valuation allowance, interperiod allocation
  - Consolidation: ASC 810 — VIE model, voting interest model, NCI, intercompany eliminations
  - Compensation: ASC 718 — stock options, RSUs, performance awards, ESPPs, modifications
  - Intangibles: ASC 350 — goodwill impairment (qualitative & quantitative), indefinite-lived intangibles, internal-use software (ASC 350-40)
  - Contingencies: ASC 450 — loss contingencies, gain contingencies, guarantees
  - Debt: ASC 470 — classification, modifications/extinguishments (TDR guidance), convertible instruments, warrants
  - Fair Value: ASC 820 — hierarchy, valuation techniques, Level 1/2/3, nonrecurring
  - Segment Reporting: ASC 280
  - Subsequent Events: ASC 855
- IFRS standards (for comparison/convergence context)
- Common industry-specific accounting (software, SaaS, real estate,
  construction, healthcare, not-for-profit)

Rules:
- ALWAYS cite the specific ASC topic, subtopic, section, and paragraph
  (e.g., ASC 606-10-25-1 through 25-5)
- Reference the relevant ASU number when discussing recent standard changes
  (e.g., ASU 2014-09 for revenue recognition)
- Render citations as **highlighted inline references** (e.g., `ASC 606-10-25-1`)
- Each citation must include a brief parenthetical explaining its relevance
- When analyzing uploaded documents, reference specific line items,
  accounts, amounts, and contractual terms. The ENTIRE text of each uploaded document is in Document Context.
{_RESEARCH_WEB_SEARCH_BLOCK}
- Present the authoritative guidance first, then apply it to the user's
  specific facts and circumstances
- If there are judgment areas or alternative treatments, present both
  with the basis for each conclusion
- Distinguish between required accounting treatments and permissible
  policy elections
- If uncertain, state so explicitly and recommend the user consult
  the ASC directly or engage a technical accounting advisor
- Never fabricate ASC paragraph references, ASU numbers, or SAB citations
- Note any transition/effective date considerations for recent ASUs
- Format responses with markdown for readability"""
        memo_section = """IF Output Style is "Tax Research Memo" or "Technical Accounting Memo":
# TECHNICAL ACCOUNTING MEMORANDUM
**Prepared by:** CPA Analytics — GAAP Bot
**Date:** [Current date]
**Re:** [Auto-generated subject line based on the research question]
---
## I. ISSUE(S)
[Precise statement of the accounting issue(s) to be researched, framed as questions. Numbered if multiple.]
## II. SHORT ANSWER
[Brief, definitive answer to each issue — typically 1-2 sentences per issue.]
## III. FACTS
[Relevant facts extracted from uploaded documents and user-provided information. Specific amounts, dates, entities, and transactions.]
## IV. APPLICABLE GUIDANCE
### A. FASB Accounting Standards Codification
- ASC XXX-XX-XX-X — [Section title and relevant text, paraphrased]
### B. SEC Guidance (if applicable)
- SAB Topic X — [Description and application]
### C. Other Guidance (if applicable)
- [AICPA/PCAOB guidance] — [Description and relevance]
## V. ANALYSIS
[Detailed analysis applying the guidance to the facts. Addresses each issue separately. Discusses alternative treatments.]
## VI. CONCLUSION
[Final conclusion for each issue with recommended accounting treatment.]
## VII. FINANCIAL STATEMENT IMPACT
[Specific impact on balance sheet, income statement, and cash flows. Required disclosures.]
## VIII. CAVEATS & LIMITATIONS
- This memo is based on current US GAAP as of [date] and the facts as provided
- AI-generated research — should be reviewed by a qualified technical accounting professional
- [Any specific caveats about ambiguous areas or pending ASUs]"""
        qa_authority = "- ASC XXX-XX-XX-X — [brief description]\n- ASU YYYY-XX — [brief description]"
        summary_table = "| ASC XXX | [Why it applies] | [Financial statement impact] |"
        summary_provisions_header = "## Applicable Accounting Standards"
        summary_issue_ref = "See ASC XXX"

    doc_block = f"\nDocument Context:\n{document_context}" if document_context else ""

    return f"""{domain_block}

Current Output Style Requested: {output_style}

Based on the requested output style, you MUST strictly follow the corresponding format below:

IF Output Style is "Q&A":
**Question:** [User's question]
**Answer:** [Direct answer — typically 1-3 paragraphs]
**Authority:**
{qa_authority}
**Practical Consideration:** [Any caveats, effective dates, phase-outs, or practice tips]

IF Output Style is "Summary":
# Summary: [Title based on document/topic]
## Document(s) Analyzed
- [Document 1 name] — [type, key identifiers]
## Key Findings
1. **[Finding title]** — [Description with specific amounts/line items]
## Potential Issues & Flags
- ⚠️ [Issue description] — {summary_issue_ref}
{summary_provisions_header}
| Provision | Relevance | Impact |
|---|---|---|
{summary_table}
## Recommended Actions
1. [Action item with priority and deadline if applicable]
## Confidence Assessment
[Overall confidence level and verification recommendations]

{memo_section}
{doc_block}
"""


async def stream_research(
    bot: str,
    messages: List[Dict[str, Any]],
    output_style: str,
    document_context: Optional[str] = None,
) -> AsyncGenerator[Tuple[str, Any], None]:
    """Stream IRS or GAAP research responses with Google Search grounding.

    `bot` must be 'irs' or 'gaap'. Yields ("chunk", str), optional ("grounding", dict),
    and a final ("usage", dict).
    """
    if bot not in ("irs", "gaap"):
        raise ValueError(f"Unknown research bot: {bot!r}")

    client = get_client()
    contents = _to_gemini_contents(messages)
    if not contents:
        # Without a user turn there is nothing to research; signal usage and stop.
        yield ("usage", _empty_usage())
        return

    system_instruction = _research_system_instruction(bot, output_style, document_context)
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        max_output_tokens=_MIN_OUTPUT_TOKENS,
        tools=[types.Tool(google_search=types.GoogleSearch())],
    )

    last_resp: Any = None
    stream = await client.aio.models.generate_content_stream(
        model=ANALYTICS_MODEL,
        contents=contents,
        config=config,
    )
    async for chunk in stream:
        last_resp = chunk
        text = _get_resp_text(chunk)
        if text:
            yield ("chunk", text)

    grounding = _serialize_grounding_metadata(last_resp)
    if grounding:
        yield ("grounding", grounding)

    yield ("usage", _get_usage_counts(last_resp))


async def stream_basic_chat(
    messages: List[Dict[str, Any]],
) -> AsyncGenerator[Tuple[str, Any], None]:
    """Simple AI Accounting Assistant fallback (matches server.ts /api/chat)."""
    client = get_client()
    contents = _to_gemini_contents(messages)
    if not contents:
        yield ("usage", _empty_usage())
        return

    config = types.GenerateContentConfig(
        system_instruction=(
            "You are a helpful AI Accounting Assistant for CPAs. You provide guidance on "
            "accounting standards, tax regulations, and financial analysis. Be professional, "
            "precise, and helpful."
        ),
    )

    last_resp: Any = None
    stream = await client.aio.models.generate_content_stream(
        model=ANALYTICS_MODEL,
        contents=contents,
        config=config,
    )
    async for chunk in stream:
        last_resp = chunk
        text = _get_resp_text(chunk)
        if text:
            yield ("chunk", text)

    yield ("usage", _get_usage_counts(last_resp))


# ---------------------------------------------------------------------------
# Session title generation (mirrors CPAAnalytics' /api/chat title prompt)
# ---------------------------------------------------------------------------

async def generate_session_title(
    first_user_message: str,
) -> Tuple[str, Dict[str, Optional[int]]]:
    """Generate a short, descriptive title (<= 5 words) for a chat session.

    Returns (title, usage_counts). Raises on transport errors so callers can
    fall back to a truncated title.
    """
    query = (first_user_message or "").strip()
    if not query:
        return "", _empty_usage()

    client = get_client()
    prompt = (
        "Based on the following query, generate a short, descriptive title for a "
        "research session (maximum 5 words, just the title text, no quotes):\n"
        f'"{query[:1000]}"'
    )
    resp = await client.aio.models.generate_content(
        model=ANALYTICS_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            max_output_tokens=_MIN_OUTPUT_TOKENS,
            thinking_config=_LOW_THINKING,
        ),
    )
    text = (_get_resp_text(resp) or "").strip().strip('"').strip()
    title = text.splitlines()[0][:200] if text else ""
    return title, _get_usage_counts(resp)

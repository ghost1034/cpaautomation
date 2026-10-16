"""Vertex-backed Tasklytic assistant with server-derived context."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from google.genai import types
from sqlalchemy.orm import Session

from models.tasklytic import TasklyticAiMessage, TasklyticAiThread, TasklyticAiUsageEvent, TasklyticEntityRecord
from services.analytics_ai_service import _get_resp_text, _get_usage_counts, get_client
from services.billing_service import BillingService
from services.tasklytic_ai_contracts import AI_RESPONSE_SCHEMA, PROPOSAL_TYPES, select_vertex_model
from services.tasklytic_ai_persistence import (
    authorize_ai_scope,
    get_or_create_settings,
    persist_generated_exchange,
    validate_proposal_for_workspace,
)
from services.tasklytic_service import authorize_record


logger = logging.getLogger(__name__)
ALLOWED_PROPOSALS = PROPOSAL_TYPES


def build_authorized_context(db: Session, user_id: str, scope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    workspace_id, anchor = authorize_ai_scope(db, user_id, scope)

    # Keep context bounded and only include records the caller may read.
    context: dict[str, Any] = {"scope": scope, "anchor": anchor, "collections": {}}
    for entity_kind in ("projects", "tasks", "sections", "goals", "portfolios", "statusUpdates", "users"):
        rows = db.query(TasklyticEntityRecord).filter_by(
            entity_kind=entity_kind, workspace_id=workspace_id
        ).limit(500).all()
        visible = []
        for row in rows:
            try:
                authorize_record(db, entity_kind, row.payload or {}, workspace_id, user_id)
            except Exception:
                continue
            visible.append(row.payload)
        context["collections"][entity_kind] = visible
    return workspace_id, context


def validate_proposals(db: Session, user_id: str, workspace_id: str, proposals: Any) -> list[dict[str, Any]]:
    if not isinstance(proposals, list) or len(proposals) > 20:
        raise ValueError("Model returned an invalid proposals collection")
    result = []
    for proposal in proposals:
        result.append(validate_proposal_for_workspace(db, user_id, workspace_id, proposal))
    return result


async def generate_tasklytic_response(
    db: Session,
    user_id: str,
    prompt: str,
    history: list[dict[str, str]],
    model: str | None,
    scope: dict[str, Any],
    thread_id: str | None = None,
    operation_id: str | None = None,
) -> dict[str, Any]:
    workspace_id, context = build_authorized_context(db, user_id, scope)
    settings = get_or_create_settings(db, workspace_id, user_id)
    if not settings.enabled or settings.paused:
        raise ValueError("Tasklytic AI is paused")
    selected_model = select_vertex_model(model or settings.model)
    BillingService(db).require_limit(user_id, "token", 1)
    operation_id = operation_id or thread_id or str(uuid.uuid4())
    if thread_id:
        thread = db.get(TasklyticAiThread, thread_id)
        if thread is None or thread.user_id != user_id or thread.workspace_id != workspace_id:
            raise ValueError("AI thread does not belong to this scope")
        stored = db.query(TasklyticAiMessage).filter_by(thread_id=thread_id).order_by(
            TasklyticAiMessage.created_at.desc()
        ).limit(20).all()
        history = [{"role": item.role, "content": item.content} for item in reversed(stored)]
    history_text = "\n".join(f"{row['role']}: {row['content']}" for row in history[-20:])
    instruction = f"""You are Tasklytic's project-management assistant. Use only the authorized JSON context below.
Return JSON with keys text (string), optional reasoning (string), and proposals (array). Proposal types may only be:
{', '.join(sorted(PROPOSAL_TYPES))}.
Never invent record IDs; proposals must reuse IDs from context. A create_task payload must use workspaceId {workspace_id!r}.

AUTHORIZED CONTEXT:
{json.dumps(context, separators=(',', ':'), default=str)}

RECENT HISTORY:
{history_text}

USER REQUEST:
{prompt}
"""
    if selected_model == "gemini-4-argon":
        # Argon ignores sampling parameters and spends output tokens on thinking.
        sampling: dict[str, Any] = {"max_output_tokens": 32_768}
    else:
        sampling = {"temperature": 0.2, "max_output_tokens": 8192}
    response = await get_client().aio.models.generate_content(
        model=selected_model,
        contents=instruction,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AI_RESPONSE_SCHEMA,
            **sampling,
        ),
    )
    usage = _get_usage_counts(response)
    try:
        BillingService(db).record_analytics_usage(
            user_id,
            "tasklytic_assistant",
            usage.get("prompt_tokens"),
            usage.get("output_tokens"),
            usage.get("total_tokens"),
            notes=f"workspace={workspace_id};model={selected_model}",
            operation_id=operation_id,
            product="tasklytic",
        )
    except Exception:
        logger.exception("Unable to meter Tasklytic AI usage for %s", user_id)
        raise
    text = _get_resp_text(response)
    if not text:
        raise RuntimeError("Vertex AI returned an empty response")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Vertex AI returned malformed JSON") from exc
    if not isinstance(parsed, dict) or not isinstance(parsed.get("text"), str):
        raise ValueError("Vertex AI returned an invalid response")
    parsed["proposals"] = validate_proposals(db, user_id, workspace_id, parsed.get("proposals", []))
    if thread_id:
        return persist_generated_exchange(
            db,
            thread_id=thread_id,
            user_id=user_id,
            prompt=prompt,
            response=parsed,
            model=selected_model,
            usage=usage,
        )
    db.add(TasklyticAiUsageEvent(
        workspace_id=workspace_id,
        user_id=user_id,
        event_type="assistant",
        model=selected_model,
        prompt_tokens=max(0, int(usage.get("prompt_tokens") or 0)),
        output_tokens=max(0, int(usage.get("output_tokens") or 0)),
        total_tokens=max(0, int(usage.get("total_tokens") or 0)),
    ))
    db.flush()
    return parsed

"""Canonical server-owned Tasklytic Vertex and structured-output contracts."""

from __future__ import annotations

from typing import Any


SUPPORTED_VERTEX_MODELS = (
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "default": True},
    {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro"},
    {"id": "gemini-4-argon", "label": "Gemini 4 Argon"},
)
SUPPORTED_VERTEX_MODEL_IDS = frozenset(model["id"] for model in SUPPORTED_VERTEX_MODELS)
DEFAULT_VERTEX_MODEL = next(model["id"] for model in SUPPORTED_VERTEX_MODELS if model.get("default"))

PROPOSAL_TYPES = frozenset({
    "create_task",
    "create_subtasks",
    "update_description",
    "draft_status_update",
    "add_custom_field",
    "create_rule",
    "add_chart_to_dashboard",
    "summarize",
    "propose_assignees",
})

AI_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["text", "proposals"],
    "properties": {
        "text": {"type": "string"},
        "reasoning": {"type": "string"},
        "proposals": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "required": ["type", "title", "preview", "payload"],
                "properties": {
                    "type": {"type": "string", "enum": sorted(PROPOSAL_TYPES)},
                    "title": {"type": "string"},
                    "preview": {"type": "string"},
                    "reasoning": {"type": "string"},
                    "payload": {"type": "object"},
                },
            },
        },
    },
}

PROPOSAL_PAYLOAD_SCHEMAS: dict[str, dict[str, Any]] = {
    "create_task": {"required": ["workspaceId", "name"]},
    "create_subtasks": {"required": ["parentTaskId", "names"]},
    "update_description": {"required": ["taskId", "nextNotes"]},
    "draft_status_update": {"required": ["projectId", "title", "summaryHtml", "status"]},
    "add_custom_field": {"required": ["name", "fieldType"]},
    "create_rule": {"required": ["projectId", "name", "trigger", "actions"]},
    "add_chart_to_dashboard": {"required": ["dashboardId", "chart"]},
    "summarize": {"required": ["summary"]},
    "propose_assignees": {"required": ["taskId", "assigneeIds"]},
}


def select_vertex_model(requested: Any) -> str:
    return requested if isinstance(requested, str) and requested in SUPPORTED_VERTEX_MODEL_IDS else DEFAULT_VERTEX_MODEL


def validate_proposal_payload(proposal_type: str, payload: Any) -> dict[str, Any]:
    if proposal_type not in PROPOSAL_TYPES:
        raise ValueError("Unsupported AI proposal type")
    if not isinstance(payload, dict):
        raise ValueError("AI proposal payload must be an object")
    missing = [key for key in PROPOSAL_PAYLOAD_SCHEMAS[proposal_type]["required"] if payload.get(key) in (None, "")]
    if missing:
        raise ValueError(f"AI proposal payload is missing: {', '.join(missing)}")
    if proposal_type == "create_subtasks":
        names = payload.get("names")
        if not isinstance(names, list) or not 1 <= len(names) <= 20 or any(not isinstance(v, str) or not v.strip() for v in names):
            raise ValueError("Subtask proposals require 1 to 20 names")
    if proposal_type == "propose_assignees":
        assignees = payload.get("assigneeIds")
        if not isinstance(assignees, list) or not 1 <= len(assignees) <= 20 or any(not isinstance(v, str) for v in assignees):
            raise ValueError("Assignee proposals require 1 to 20 user ids")
    if proposal_type == "draft_status_update" and payload.get("status") not in {
        "on_track", "at_risk", "off_track", "on_hold", "complete"
    }:
        raise ValueError("Status proposal has an invalid status")
    if proposal_type == "add_custom_field" and payload.get("fieldType") not in {
        "text", "number", "date", "single_select", "multi_select", "people", "checkbox", "currency", "formula"
    }:
        raise ValueError("Custom-field proposal has an invalid field type")
    return dict(payload)

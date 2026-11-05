"""Admin endpoints for system management, setup, and data oversight."""
import csv
import io
import logging
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import LargeBinary, String, cast, false, func, literal, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.database import get_db
from dependencies.auth import get_current_user_id
from models.db_models import Base, User
# Register Inkwise's models on the shared SQLAlchemy metadata before the
# database explorer enumerates it.
from models import inkwise_models as _inkwise_models  # noqa: F401
from services.gmail_subscription_service import gmail_subscription_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# Console sections are intentionally defined server-side. This keeps product
# totals and navigation stable while still making every newly registered table
# available from the Database section automatically.
ADMIN_TABLE_GROUPS: dict[str, dict[str, Any]] = {
    "users": {
        "label": "Users & firms",
        "description": "Accounts, firms, invitations, and activation records.",
        "tables": [
            "users", "firms", "firm_invite_codes", "activation_keys",
            "activation_codes",
        ],
    },
    "extraction": {
        "label": "Document extraction",
        "description": "Jobs, runs, files, tasks, fields, results, and exports.",
        "tables": [
            "extraction_jobs", "job_runs", "source_files", "extraction_tasks",
            "source_files_to_tasks", "job_fields", "extraction_results",
            "job_exports", "templates", "template_fields", "data_types",
            "system_prompts",
        ],
    },
    "form-fill": {
        "label": "Form Fill",
        "description": "Target templates, source files, runs, and generated outputs.",
        "tables": [
            "form_fill_runs", "form_fill_templates", "form_fill_source_files",
            "form_fill_outputs",
        ],
    },
    "inkwise": {
        "label": "Inkwise",
        "description": "Writing documents, references, ingestion, retrieval, and chat.",
        "tables": [
            "inkwise_documents", "inkwise_document_folders",
            "inkwise_document_revisions", "inkwise_sources",
            "inkwise_source_ingestions", "inkwise_document_source_bindings",
            "inkwise_chat_threads", "inkwise_chat_messages",
            "inkwise_source_pages", "inkwise_source_segments",
            "inkwise_source_segment_embeddings", "inkwise_retrieval_runs",
            "inkwise_generation_attempts", "inkwise_retrieval_evidence",
            "inkwise_templates", "inkwise_system_template_categories",
            "inkwise_system_templates",
        ],
    },
    "analytics": {
        "label": "Analytics",
        "description": "Clients, projects, analyses, reconciliations, assets, and research.",
        "tables": [
            "clients", "projects", "analyses", "reconciliations",
            "amortizations", "chat_sessions", "journal_entries",
            "analytics_comments", "analytics_audit_logs",
        ],
    },
    "chrona": {
        "label": "Chrona",
        "description": "Paired devices, pairing codes, and timeline activity.",
        "tables": ["chrona_devices", "chrona_pairing_codes", "chrona_timeline_cards"],
    },
    "e-sign": {
        "label": "E-Signature",
        "description": "Envelopes, recipients, fields, templates, delivery, and administration.",
        "tables": [
            "esign_envelopes", "esign_documents", "esign_recipients",
            "esign_recipient_changes", "esign_guest_invitations",
            "esign_guest_sessions", "esign_fields", "esign_signer_attachments",
            "esign_signature_records", "esign_consent_records", "esign_events",
            "esign_templates", "esign_template_documents", "esign_template_fields",
            "esign_template_versions", "esign_bulk_jobs", "esign_bulk_rows",
            "esign_powerforms", "esign_powerform_submissions", "esign_work_items",
            "esign_email_deliveries", "esign_firm_settings", "esign_brand_assets",
            "esign_brand_profiles", "esign_permission_profiles",
            "esign_permission_assignments", "esign_envelope_grants",
            "esign_webhook_configurations", "esign_webhook_deliveries",
            "esign_webhook_attempts", "esign_admin_events",
        ],
    },
    "automations": {
        "label": "Automations",
        "description": "Automation definitions, executions, and processed messages.",
        "tables": [
            "automations", "automation_runs", "automation_processed_messages",
            "central_mailbox_state",
        ],
    },
    "platform": {
        "label": "Platform",
        "description": "Billing, usage, integrations, and connector infrastructure.",
        "tables": [
            "subscription_plans", "billing_accounts", "feedback_submissions", "usage_events",
            "usage_counters", "integration_accounts", "connector_connections",
            "connector_oauth_configs", "connector_tokens", "connector_action_logs",
            "hosted_claw_slack_installations", "hosted_claw_slack_links",
            "hosted_claw_oauth_states", "hosted_claw_link_tokens",
            "hosted_claw_entitlements", "hosted_claw_configs",
            "hosted_claw_channel_sessions",
            "hosted_claw_product_sessions", "hosted_claw_jobs",
            "hosted_claw_artifacts", "hosted_claw_approvals",
            "hosted_claw_read_only_actions", "hosted_claw_worker_leases",
            "hosted_claw_usage_summaries",
        ],
    },
}

# A deliberately small, metadata-only projection of activity-bearing tables.
# The console never returns JSON payloads, document contents, IP addresses, or
# other evidence fields from these records. ``owner`` describes an optional
# join used to attribute child records (runs and device syncs) to a user.
_ACTIVITY_SOURCES: tuple[dict[str, Any], ...] = (
    {"table": "analytics_audit_logs", "product": "analytics", "kind": "Analytics audit", "title": "action", "action": "action", "timestamp": "created_at", "user": "user_id"},
    {"table": "esign_events", "product": "e-sign", "kind": "E-Signature event", "title": "event_type", "action": "event_type", "timestamp": "created_at", "user": "actor_user_id", "actor_email": "actor_email"},
    {"table": "esign_admin_events", "product": "e-sign", "kind": "E-Signature admin", "title": "event_type", "action": "event_type", "timestamp": "created_at", "user": "actor_user_id", "actor_email": "actor_email"},
    {"table": "connector_action_logs", "product": "platform", "kind": "Connector action", "title": "action_id", "action": "action_id", "timestamp": "created_at", "user": "user_id", "status": "success", "boolean_status": True, "status_true": "Succeeded", "status_false": "Failed"},
    {"table": "usage_events", "product": "platform", "kind": "Usage event", "title": "source", "action_value": "Usage recorded", "timestamp": "occurred_at", "user": "user_id"},
    {"table": "extraction_jobs", "product": "extraction", "kind": "Extraction job", "title": "name", "action_value": "Job created", "timestamp": "created_at", "user": "user_id"},
    {"table": "job_runs", "product": "extraction", "kind": "Extraction run", "title_value": "Extraction run", "action_value": "Run started", "timestamp": "created_at", "status": "status", "owner": ("extraction_jobs", "job_id", "id", "user_id", "name")},
    {"table": "form_fill_runs", "product": "form-fill", "kind": "Form Fill run", "title": "target_filename", "action_value": "Run started", "timestamp": "created_at", "status": "status", "user": "user_id"},
    {"table": "inkwise_documents", "product": "inkwise", "kind": "Inkwise document", "title": "title", "action_value": "Document activity", "timestamp": "updated_at", "user": "user_id"},
    {"table": "inkwise_retrieval_runs", "product": "inkwise", "kind": "Inkwise retrieval", "title_value": "Reference search", "action_value": "Retrieval run", "timestamp": "created_at", "user": "user_id"},
    {"table": "analyses", "product": "analytics", "kind": "Analysis", "title": "name", "action_value": "Analysis activity", "timestamp": "updated_at", "status": "status", "user": "created_by_user_id"},
    {"table": "reconciliations", "product": "analytics", "kind": "Reconciliation", "title": "name", "action_value": "Reconciliation activity", "timestamp": "updated_at", "status": "status", "user": "created_by_user_id"},
    {"table": "amortizations", "product": "analytics", "kind": "Amortization", "title": "asset_name", "action_value": "Schedule activity", "timestamp": "updated_at", "status": "status", "user": "created_by_user_id"},
    {"table": "chat_sessions", "product": "analytics", "kind": "Research session", "title": "title", "action_value": "Session activity", "timestamp": "updated_at", "user": "user_id"},
    {"table": "analytics_comments", "product": "analytics", "kind": "Comment", "title_value": "Comment posted", "action_value": "Comment posted", "timestamp": "created_at", "user": "author_user_id"},
    {"table": "esign_envelopes", "product": "e-sign", "kind": "E-Signature envelope", "title": "title", "action_value": "Envelope activity", "timestamp": "updated_at", "status": "status", "user": "user_id"},
    {"table": "automations", "product": "automations", "kind": "Automation", "title": "name", "action_value": "Automation activity", "timestamp": "updated_at", "status": "is_enabled", "boolean_status": True, "status_true": "Enabled", "status_false": "Disabled", "user": "user_id"},
    {"table": "automation_runs", "product": "automations", "kind": "Automation run", "title_value": "Automation run", "action_value": "Run triggered", "timestamp": "triggered_at", "status": "status", "owner": ("automations", "automation_id", "id", "user_id", "name")},
    {"table": "chrona_timeline_cards", "product": "chrona", "kind": "Chrona timeline", "title": "title", "action_value": "Timeline synced", "timestamp": "synced_at", "owner": ("chrona_devices", "device_id", "id", "paired_by_user_id", "display_name")},
)

_SENSITIVE_EXACT = {
    "access_token", "refresh_token", "token", "token_hash", "key_hash",
    "secret", "secret_hash", "encrypted_credentials", "encrypted_token",
    "password", "token_sha256", "public_token_sha256", "verification_token_sha256",
    "bot_token_ciphertext", "payload_ciphertext", "interaction_token_hash",
    "grant_token_hash", "state_hash",
}
_SENSITIVE_PARTS = ("access_token", "refresh_token", "secret", "password", "key_hash")
_SENSITIVE_TABLE_COLUMNS = {
    ("activation_codes", "code"),
    ("firm_invite_codes", "code"),
    ("chrona_pairing_codes", "code"),
}


async def require_system_admin(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> User:
    """Require the platform-wide user permission used by the admin console.

    This permission is intentionally independent of ``User.role``. That role is
    scoped to a firm, so even a firm administrator must not gain platform-wide
    access to other firms' records.
    """
    from services.system_admin_access import ensure_system_admin

    user = db.query(User).filter(User.id == user_id).first()
    return ensure_system_admin(user)


def _table_or_404(table_name: str):
    table = Base.metadata.tables.get(table_name)
    if table is None:
        raise HTTPException(status_code=404, detail="Unknown database table")
    return table


def _is_sensitive(column_name: str, table_name: str | None = None) -> bool:
    name = column_name.lower()
    return (
        (table_name, name) in _SENSITIVE_TABLE_COLUMNS
        or name in _SENSITIVE_EXACT
        or any(part in name for part in _SENSITIVE_PARTS)
    )


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[binary data: {len(value)} bytes]"
    if isinstance(value, (dict, list)):
        return value
    return str(value)


def _serialize_mapping(mapping: Any, table: Any) -> dict[str, Any]:
    row: dict[str, Any] = {}
    for column in table.columns:
        value = mapping.get(column.name)
        if value is not None and _is_sensitive(column.name, table.name):
            row[column.name] = "[redacted]"
        else:
            row[column.name] = _json_value(value)
    return row


def _table_schema(table: Any) -> list[dict[str, Any]]:
    return [
        {
            "name": column.name,
            "type": str(column.type),
            "nullable": bool(column.nullable),
            "primary_key": bool(column.primary_key),
            "redacted": _is_sensitive(column.name, table.name),
        }
        for column in table.columns
    ]


def _default_order_column(table: Any):
    for name in ("created_at", "updated_at", "triggered_at", "synced_at", "started_at", "id"):
        if name in table.c:
            return table.c[name]
    primary_key = list(table.primary_key.columns)
    return primary_key[0] if primary_key else None


def _table_search_clause(table: Any, search: str):
    """Match ``search`` against every non-redacted, text-castable column.

    Redacted columns are excluded so search cannot be used as an oracle to
    reveal values the console intentionally hides.
    """
    escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    needle = f"%{escaped}%"
    searchable = [
        column
        for column in table.columns
        if not _is_sensitive(column.name, table.name) and not isinstance(column.type, LargeBinary)
    ]
    if not searchable:
        return false()
    return or_(*(cast(column, String).ilike(needle, escape="\\") for column in searchable))


def _safe_count(db: Session, table: Any, where: Any = None) -> int | None:
    try:
        statement = select(func.count()).select_from(table)
        if where is not None:
            statement = statement.where(where)
        return int(db.execute(statement).scalar_one())
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Admin console could not count table %s", table.name)
        return None


def _activity_status(source: dict[str, Any], value: Any) -> str | None:
    if value is None:
        return None
    if source.get("boolean_status"):
        return source.get("status_true", "Succeeded") if bool(value) else source.get("status_false", "Failed")
    return str(value)


def _activity_query_parts(
    source: dict[str, Any],
    *,
    user_id: str | None,
    from_time: datetime | None,
    to_time: datetime | None,
    status: str | None,
    search: str | None,
) -> dict[str, Any] | None:
    """Build the shared joins and filters used by activity rows and charts."""
    table = Base.metadata.tables.get(source["table"])
    users = Base.metadata.tables.get("users")
    if table is None or users is None:
        return None

    from_clause = table
    owner_table = None
    effective_user_column = table.c.get(source.get("user", ""))
    owner = source.get("owner")
    if owner:
        owner_table = Base.metadata.tables.get(owner[0])
        if owner_table is None:
            return None
        from_clause = from_clause.outerjoin(owner_table, table.c[owner[1]] == owner_table.c[owner[2]])
        effective_user_column = owner_table.c[owner[3]]

    from_clause = from_clause.outerjoin(users, effective_user_column == users.c.id)
    timestamp_column = table.c[source["timestamp"]]
    title_column = table.c.get(source.get("title", ""))
    if title_column is None and owner_table is not None and len(owner) > 4:
        title_column = owner_table.c.get(owner[4])
    status_column = table.c.get(source.get("status", ""))
    action_column = table.c.get(source.get("action", ""))
    actor_email_column = table.c.get(source.get("actor_email", ""))

    filters = []
    if user_id == "system":
        filters.append(effective_user_column.is_(None))
    elif user_id:
        filters.append(effective_user_column == user_id)
    if from_time is not None:
        filters.append(timestamp_column >= from_time)
    if to_time is not None:
        filters.append(timestamp_column <= to_time)
    if status:
        if status_column is None:
            return None
        if source.get("boolean_status"):
            true_label = source.get("status_true", "Succeeded").lower()
            false_label = source.get("status_false", "Failed").lower()
            if status.lower() == true_label:
                filters.append(status_column.is_(True))
            elif status.lower() == false_label:
                filters.append(status_column.is_(False))
            else:
                return None
        else:
            filters.append(cast(status_column, String).ilike(status.replace(" ", "_")))

    if search:
        needle = f"%{search}%"
        fixed_text = " ".join(str(source.get(key, "")) for key in ("kind", "title_value", "action_value"))
        if search.lower() not in fixed_text.lower():
            searchable = [column for column in (title_column, action_column, status_column, actor_email_column, users.c.email, users.c.display_name) if column is not None]
            if not searchable:
                return None
            filters.append(or_(*(cast(column, String).ilike(needle) for column in searchable)))

    return {
        "table": table,
        "users": users,
        "from_clause": from_clause,
        "effective_user_column": effective_user_column,
        "timestamp_column": timestamp_column,
        "title_column": title_column,
        "status_column": status_column,
        "action_column": action_column,
        "actor_email_column": actor_email_column,
        "filters": filters,
    }


def _activity_source_query(
    db: Session,
    source: dict[str, Any],
    *,
    fetch_limit: int,
    user_id: str | None,
    from_time: datetime | None,
    to_time: datetime | None,
    status: str | None,
    search: str | None,
) -> tuple[int, list[dict[str, Any]]]:
    """Return a filtered, normalized slice from one configured activity table."""
    parts = _activity_query_parts(
        source,
        user_id=user_id,
        from_time=from_time,
        to_time=to_time,
        status=status,
        search=search,
    )
    if parts is None:
        return 0, []

    table = parts["table"]
    users = parts["users"]
    from_clause = parts["from_clause"]
    effective_user_column = parts["effective_user_column"]
    timestamp_column = parts["timestamp_column"]
    title_column = parts["title_column"]
    status_column = parts["status_column"]
    action_column = parts["action_column"]
    actor_email_column = parts["actor_email_column"]
    filters = parts["filters"]

    count_statement = select(func.count()).select_from(from_clause)
    if filters:
        count_statement = count_statement.where(*filters)
    total = int(db.execute(count_statement).scalar_one())
    if total == 0:
        return 0, []

    statement = select(
        table.c.id.label("record_id"),
        timestamp_column.label("activity_timestamp"),
        (title_column if title_column is not None else literal(source.get("title_value"))).label("activity_title"),
        (action_column if action_column is not None else literal(source.get("action_value"))).label("activity_action"),
        (status_column if status_column is not None else literal(None)).label("activity_status"),
        effective_user_column.label("activity_user_id"),
        users.c.email.label("activity_user_email"),
        users.c.display_name.label("activity_user_name"),
        (actor_email_column if actor_email_column is not None else literal(None)).label("activity_actor_email"),
    ).select_from(from_clause)
    if filters:
        statement = statement.where(*filters)
    statement = statement.order_by(timestamp_column.desc().nullslast()).limit(fetch_limit)

    rows = []
    product = ADMIN_TABLE_GROUPS[source["product"]]
    for row in db.execute(statement).mappings():
        timestamp = _json_value(row["activity_timestamp"])
        rows.append({
            "id": f'{source["table"]}:{_json_value(row["record_id"])}',
            "record_id": _json_value(row["record_id"]),
            "table": source["table"],
            "product": source["product"],
            "product_label": product["label"],
            "kind": source["kind"],
            "title": _json_value(row["activity_title"]) or source["kind"],
            "action": _json_value(row["activity_action"]) or source["kind"],
            "status": _activity_status(source, row["activity_status"]),
            "timestamp": timestamp,
            "user": {
                "id": _json_value(row["activity_user_id"]),
                "email": _json_value(row["activity_user_email"] or row["activity_actor_email"]),
                "display_name": _json_value(row["activity_user_name"]),
            } if row["activity_user_id"] or row["activity_user_email"] or row["activity_actor_email"] else None,
        })
    return total, rows


def _activity_timeline_granularity(
    from_time: datetime | None,
    to_time: datetime | None,
) -> str:
    """Choose a readable number of chart buckets for the selected range."""
    if from_time is None:
        return "month"
    now = datetime.now(timezone.utc) if from_time.tzinfo else datetime.now()
    span = (to_time or now) - from_time
    if span <= timedelta(days=3):
        return "hour"
    if span <= timedelta(days=90):
        return "day"
    if span <= timedelta(days=730):
        return "week"
    return "month"


def _activity_source_timeline_query(
    db: Session,
    source: dict[str, Any],
    *,
    granularity: str,
    user_id: str | None,
    from_time: datetime | None,
    to_time: datetime | None,
    status: str | None,
    search: str | None,
) -> list[dict[str, Any]]:
    """Return database-aggregated activity buckets for one source."""
    parts = _activity_query_parts(
        source,
        user_id=user_id,
        from_time=from_time,
        to_time=to_time,
        status=status,
        search=search,
    )
    if parts is None:
        return []

    timestamp_column = parts["timestamp_column"]
    bucket_column = func.date_trunc(granularity, timestamp_column)
    statement = (
        select(bucket_column.label("activity_bucket"), func.count().label("activity_count"))
        .select_from(parts["from_clause"])
        .where(timestamp_column.is_not(None), *parts["filters"])
        .group_by(bucket_column)
        .order_by(bucket_column)
    )
    return [
        {
            "timestamp": _json_value(row["activity_bucket"]),
            "count": int(row["activity_count"]),
        }
        for row in db.execute(statement).mappings()
    ]


@router.get("/console/auth")
async def verify_console_access(_: User = Depends(require_system_admin)):
    return {"authenticated": True}


@router.get("/console/catalog")
async def get_console_catalog(
    db: Session = Depends(get_db),
    _: User = Depends(require_system_admin),
):
    tables = []
    grouped_names = {
        name for group in ADMIN_TABLE_GROUPS.values() for name in group["tables"]
    }
    for table in sorted(Base.metadata.tables.values(), key=lambda item: item.name):
        tables.append({
            "name": table.name,
            "columns": len(table.columns),
            "count": _safe_count(db, table),
            "grouped": table.name in grouped_names,
        })

    by_name = {item["name"]: item for item in tables}
    groups = []
    for slug, group in ADMIN_TABLE_GROUPS.items():
        group_tables = [by_name[name] for name in group["tables"] if name in by_name]
        groups.append({
            "slug": slug,
            "label": group["label"],
            "description": group["description"],
            "tables": group_tables,
            "row_count": sum(item["count"] or 0 for item in group_tables),
        })
    return {"groups": groups, "tables": tables}


@router.get("/console/overview")
async def get_console_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_system_admin),
):
    table_counts: dict[str, int | None] = {}
    for table in Base.metadata.tables.values():
        table_counts[table.name] = _safe_count(db, table)

    product_counts = []
    for slug, group in ADMIN_TABLE_GROUPS.items():
        product_counts.append({
            "slug": slug,
            "label": group["label"],
            "count": sum(table_counts.get(name) or 0 for name in group["tables"]),
            "tables": len([name for name in group["tables"] if name in table_counts]),
        })

    activity = []
    activity_tables = [
        ("extraction_jobs", "Extraction job", "name"),
        ("form_fill_runs", "Form Fill run", "target_filename"),
        ("inkwise_documents", "Inkwise document", "title"),
        ("esign_envelopes", "E-Signature envelope", "title"),
        ("automation_runs", "Automation run", "status"),
        ("chrona_timeline_cards", "Chrona timeline card", "title"),
    ]
    for table_name, kind, title_column in activity_tables:
        table = Base.metadata.tables.get(table_name)
        if table is None:
            continue
        order_column = _default_order_column(table)
        try:
            statement = select(table)
            if order_column is not None:
                statement = statement.order_by(order_column.desc().nullslast())
            rows = db.execute(statement.limit(4)).mappings().all()
            for row in rows:
                timestamp = (
                    row.get("created_at") or row.get("updated_at")
                    or row.get("triggered_at") or row.get("synced_at")
                    or row.get("started_at")
                )
                activity.append({
                    "table": table_name,
                    "kind": kind,
                    "id": _json_value(row.get("id")),
                    "title": _json_value(row.get(title_column)) or kind,
                    "status": _json_value(row.get("status")),
                    "timestamp": _json_value(timestamp),
                })
        except SQLAlchemyError:
            db.rollback()
            logger.exception("Admin console could not load activity from %s", table_name)

    activity.sort(key=lambda item: item["timestamp"] or "", reverse=True)
    return {
        "table_count": len(Base.metadata.tables),
        "row_count": sum(value or 0 for value in table_counts.values()),
        "product_counts": product_counts,
        "table_counts": table_counts,
        "recent_activity": activity[:12],
    }


@router.get("/console/activity")
async def get_console_activity(
    page: int = Query(default=1, ge=1, le=500),
    limit: int = Query(default=50, ge=1, le=100),
    include_timeline: bool = Query(default=False),
    user_id: str | None = Query(default=None),
    product: str | None = Query(default=None),
    source_table: str | None = Query(default=None),
    status: str | None = Query(default=None, max_length=80),
    search: str | None = Query(default=None, max_length=200),
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(require_system_admin),
):
    """Return a unified, filterable stream of safe operational metadata."""
    if from_time and to_time and from_time > to_time:
        raise HTTPException(status_code=422, detail="The start time must be before the end time")
    if product and product not in ADMIN_TABLE_GROUPS:
        raise HTTPException(status_code=422, detail="Unknown product filter")
    known_sources = {source["table"] for source in _ACTIVITY_SOURCES}
    if source_table and source_table not in known_sources:
        raise HTTPException(status_code=422, detail="Unknown activity source")

    selected_sources = [
        source for source in _ACTIVITY_SOURCES
        if (not product or source["product"] == product)
        and (not source_table or source["table"] == source_table)
    ]
    fetch_limit = page * limit
    total = 0
    rows: list[dict[str, Any]] = []
    source_counts: dict[str, int] = {}
    granularity = _activity_timeline_granularity(from_time, to_time)
    timeline_by_timestamp: dict[str, dict[str, Any]] = {}
    for source in selected_sources:
        try:
            source_total, source_rows = _activity_source_query(
                db,
                source,
                fetch_limit=fetch_limit,
                user_id=user_id,
                from_time=from_time,
                to_time=to_time,
                status=status.strip() if status else None,
                search=search.strip() if search else None,
            )
            total += source_total
            source_counts[source["table"]] = source_total
            rows.extend(source_rows)
            if include_timeline and source_total:
                for bucket in _activity_source_timeline_query(
                    db,
                    source,
                    granularity=granularity,
                    user_id=user_id,
                    from_time=from_time,
                    to_time=to_time,
                    status=status.strip() if status else None,
                    search=search.strip() if search else None,
                ):
                    point = timeline_by_timestamp.setdefault(bucket["timestamp"], {
                        "timestamp": bucket["timestamp"],
                        "total": 0,
                        "product_counts": {},
                    })
                    point["total"] += bucket["count"]
                    product_counts_for_point = point["product_counts"]
                    product_counts_for_point[source["product"]] = (
                        product_counts_for_point.get(source["product"], 0) + bucket["count"]
                    )
        except SQLAlchemyError:
            db.rollback()
            source_counts[source["table"]] = 0
            logger.exception("Admin console could not load activity from %s", source["table"])

    rows.sort(key=lambda item: item["timestamp"] or "", reverse=True)
    offset = (page - 1) * limit
    page_rows = rows[offset:offset + limit]

    user_options = []
    users = Base.metadata.tables.get("users")
    if users is not None:
        try:
            user_rows = db.execute(
                select(users.c.id, users.c.email, users.c.display_name)
                .order_by(func.lower(func.coalesce(users.c.display_name, users.c.email)))
            ).mappings()
            user_options = [
                {
                    "id": _json_value(row["id"]),
                    "email": _json_value(row["email"]),
                    "display_name": _json_value(row["display_name"]),
                }
                for row in user_rows
            ]
        except SQLAlchemyError:
            db.rollback()
            logger.exception("Admin console could not load activity user filters")

    product_counts: dict[str, int] = {}
    for source in _ACTIVITY_SOURCES:
        product_counts[source["product"]] = product_counts.get(source["product"], 0) + source_counts.get(source["table"], 0)

    generated_at = datetime.now(timezone.utc)
    return {
        "rows": page_rows,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": max(1, (total + limit - 1) // limit),
        "generated_at": generated_at.isoformat(),
        "source_counts": source_counts,
        "product_counts": product_counts,
        "timeline": {
            "granularity": granularity,
            "from": _json_value(from_time),
            "to": _json_value(to_time or generated_at),
            "points": [timeline_by_timestamp[key] for key in sorted(timeline_by_timestamp)],
        },
        "filters": {
            "users": user_options,
            "products": [
                {"value": slug, "label": group["label"]}
                for slug, group in ADMIN_TABLE_GROUPS.items()
                if any(source["product"] == slug for source in _ACTIVITY_SOURCES)
            ],
            "sources": [
                {
                    "value": source["table"],
                    "label": source["kind"],
                    "product": source["product"],
                }
                for source in _ACTIVITY_SOURCES
            ],
            "statuses": [
                "Succeeded", "Failed", "Completed", "Running", "Processing",
                "Pending", "Draft", "Active", "Enabled", "Disabled",
                "In progress", "Partially completed",
            ],
        },
    }


@router.get("/console/tables/{table_name}")
async def get_console_table(
    table_name: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    search: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_system_admin),
):
    table = _table_or_404(table_name)
    search = search.strip() if search else None
    where = _table_search_clause(table, search) if search else None
    total = _safe_count(db, table, where)
    if total is None:
        raise HTTPException(status_code=503, detail="Table is unavailable")

    statement = select(table)
    if where is not None:
        statement = statement.where(where)
    order_column = _default_order_column(table)
    if order_column is not None:
        statement = statement.order_by(order_column.desc().nullslast())
    rows = db.execute(statement.offset((page - 1) * limit).limit(limit)).mappings().all()
    return {
        "table": table_name,
        "columns": _table_schema(table),
        "rows": [_serialize_mapping(row, table) for row in rows],
        "page": page,
        "limit": limit,
        "total": total,
        "pages": max(1, (total + limit - 1) // limit),
    }


@router.get("/console/tables/{table_name}/export")
async def export_console_table(
    table_name: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_system_admin),
):
    table = _table_or_404(table_name)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[column.name for column in table.columns])
    writer.writeheader()
    order_column = _default_order_column(table)
    statement = select(table)
    if order_column is not None:
        statement = statement.order_by(order_column.desc().nullslast())
    for mapping in db.execute(statement).mappings():
        writer.writerow(_serialize_mapping(mapping, table))
    output.seek(0)
    headers = {"Content-Disposition": f'attachment; filename="{table_name}.csv"'}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)

@router.post("/setup-gmail-pubsub")
async def setup_gmail_pubsub(
    db: Session = Depends(get_db),
    admin_token: str = Query(..., description="Admin token for authentication")
):
    """
    Set up Gmail Pub/Sub infrastructure and watch for all users
    
    This endpoint should be called once during deployment to set up:
    1. Google Cloud Pub/Sub topic and subscription
    2. Gmail watch for all existing users with Google integrations
    """
    try:
        # Validate admin token
        import os
        expected_token = os.getenv('ADMIN_TOKEN')
        if not expected_token or admin_token != expected_token:
            raise HTTPException(status_code=401, detail="Invalid admin token")
        
        # Validate configuration first
        config_status = gmail_subscription_service.validate_configuration()
        if not config_status['valid']:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid configuration: {config_status['errors']}"
            )
        
        # Set up Pub/Sub infrastructure
        logger.info("Setting up Gmail Pub/Sub infrastructure...")
        pubsub_success = gmail_subscription_service.setup_pubsub_infrastructure()
        
        if not pubsub_success:
            raise HTTPException(
                status_code=500, 
                detail="Failed to set up Pub/Sub infrastructure"
            )
        
        # Set up Gmail watch for all users
        logger.info("Setting up Gmail watch for all users...")
        watch_results = gmail_subscription_service.setup_gmail_watch_for_all_users(db)
        
        return {
            "status": "success",
            "message": "Gmail Pub/Sub setup completed",
            "pubsub_setup": "successful",
            "gmail_watch_results": watch_results,
            "configuration": {
                "topic_name": gmail_subscription_service.get_topic_name(),
                "webhook_url": gmail_subscription_service.get_webhook_url()
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Gmail Pub/Sub setup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Setup failed: {str(e)}")

@router.post("/setup-gmail-watch/{user_id}")
async def setup_gmail_watch_for_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin_token: str = Query(..., description="Admin token for authentication")
):
    """
    Set up Gmail watch for a specific user
    
    This can be used to set up Gmail watch for new users or retry failed setups.
    """
    try:
        # Validate admin token
        import os
        expected_token = os.getenv('ADMIN_TOKEN')
        if not expected_token or admin_token != expected_token:
            raise HTTPException(status_code=401, detail="Invalid admin token")
        
        # Set up Gmail watch for the user
        success = gmail_subscription_service.setup_gmail_watch_for_user(db, user_id)
        
        if success:
            return {
                "status": "success",
                "message": f"Gmail watch setup successful for user {user_id}",
                "user_id": user_id
            }
        else:
            raise HTTPException(
                status_code=500, 
                detail=f"Gmail watch setup failed for user {user_id}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Gmail watch setup failed for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Setup failed: {str(e)}")

@router.get("/gmail-pubsub-status")
async def get_gmail_pubsub_status(
    admin_token: str = Query(..., description="Admin token for authentication")
):
    """
    Get Gmail Pub/Sub configuration status
    """
    try:
        # Validate admin token
        import os
        expected_token = os.getenv('ADMIN_TOKEN')
        if not expected_token or admin_token != expected_token:
            raise HTTPException(status_code=401, detail="Invalid admin token")
        
        # Get configuration status
        config_status = gmail_subscription_service.validate_configuration()
        
        return {
            "configuration": config_status,
            "settings": {
                "topic_name": gmail_subscription_service.get_topic_name(),
                "webhook_url": gmail_subscription_service.get_webhook_url(),
                "project_id": os.getenv('GOOGLE_CLOUD_PROJECT_ID')
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get Gmail Pub/Sub status: {e}")
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")

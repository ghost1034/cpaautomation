# CPAAutomation

A web platform for extracting structured fields from documents using LLMs (default Google Gemini), with CSV/XLSX exports, Google Drive/Gmail integrations, and automation via Gmail attachment triggers. Built with Next.js (frontend) and FastAPI (backend), using Firebase for authentication, PostgreSQL for persistence, and Google Cloud (Run, Tasks, Scheduler, GCS, Pub/Sub) for infrastructure.

Table of contents
- [Overview](#overview)
- [System Architecture](#system-architecture)
  - [Components](#components)
  - [Architecture Diagram](#architecture-diagram)
- [Core Workflows](#core-workflows)
  - [Uploads and Imports](#uploads-and-imports)
  - [Extraction Pipeline](#extraction-pipeline)
  - [Exports](#exports)
  - [Automations (Gmail attachments)](#automations-gmail-attachments-trigger)
  - [Folders and Processing Modes](#folders-and-processing-modes)
- [Local Development](#local-development)
- [Deployment and Operations](#deployment-and-operations)
- [Security and Data Management](#security-and-data-management)
- [Reference Appendix](#reference-appendix)
- [Contributing](#contributing)

## Overview

FirmCRM is available under `/dashboard/firmcrm` for firm members. See [FirmCRM integration and release guide](docs/firmcrm.md) for roles, shared-client behavior, migration, and verification.

CPAAutomation lets users define extraction templates composed of fields (name, data type, and an AI prompt) and apply them to documents. Documents can be uploaded from a computer, imported from Google Drive, or ingested automatically from Gmail attachments. The system runs extractions using Google Gemini and produces structured results that can be reviewed and edited in-app (spreadsheet-style), then downloaded as CSV/XLSX or exported to Google Drive. Automations allow continuous, rule-based ingestion and processing.

Key technologies
- Frontend: Next.js, React, Tailwind, shadcn/ui, Firebase Auth client
- Backend: FastAPI, SQLAlchemy/Alembic, Firebase Admin token verification
- AI: Model-agnostic LLMs. Default: Google Gemini via google-genai (Vertex AI)
- Storage/Infra: Google Cloud Storage, Cloud Run, Cloud Tasks, Cloud Scheduler, Pub/Sub (Gmail push)
- Database: PostgreSQL
- Billing: Stripe (subscriptions and metered usage)
- Types: openapi-typescript generates shared types for lib/api.ts and lib/api-types.ts

## System Architecture

### Components
- Frontend (Next.js)
  - Uses openapi-typescript generated types and a typed client in `lib/api.ts` and `lib/api-types.ts`.
  - In development, `/api/*` is proxied to `http://localhost:8000/api/*`; in production to the deployed FastAPI service.
  - Firebase Auth on the client; sends ID token to backend on protected endpoints.

- Backend API (FastAPI)
  - Endpoints under `/api/*` for jobs, extraction, templates, automations, integrations (Google Drive/Gmail), billing/stripe, and webhooks.
  - Verifies Firebase ID tokens.
  - Persists state in PostgreSQL (SQLAlchemy + Alembic).

- Storage and AI
  - Google Cloud Storage (GCS) stores uploads and artifacts.
  - AI extraction uses a pluggable LLM interface. Default provider is Google Gemini (google-genai) with GCS URIs for document inputs.

- Background processing
  - Cloud Run Task services: extract, io, automation, maintenance.
  - Cloud Tasks and Cloud Scheduler orchestrate async and scheduled work.
  - Pub/Sub (Gmail push) to backend webhooks, which enqueue automation processing.

- Billing and usage
  - Stripe for subscriptions and usage reconciliation.
  - Usage events and counters recorded in PostgreSQL.

- Identity and security
  - Firebase Admin SDK verifies tokens server-side.
  - Google OAuth for Drive and Gmail (drive.file scope, Gmail push).

### Architecture Diagram
```mermaid
flowchart LR
  subgraph Client
    U["User (Web)"] --> N["Next.js Frontend"]
  end

  subgraph Backend
    N -->|/api/*| A["FastAPI API"]
    A -->|JWT verify| F["Firebase Admin"]
    A -->|SQLAlchemy| P[(PostgreSQL)]
    A -->|files/artifacts| GCS[(Google Cloud Storage)]
    A -->|enqueue tasks| CT["Cloud Tasks"]
    A -->|webhooks| WH["Webhook Handlers"]
  end

  subgraph "Task Services (Cloud Run)"
    CT --> T1["Extract Task Service"]
    CT --> T2["IO Task Service"]
    CT --> T3["Automation Task Service"]
    CT --> T4["Maintenance Task Service"]
    T1 --> GCS
    T1 --> LLM["LLM Provider"]
    T2 --> GD["Google Drive API"]
    T3 --> GM["Gmail API"]
    T4 --> STR["Stripe API"]
    T4 --> SCHED["Cloud Scheduler"]
  end

  subgraph Integrations
    WH <-->|push| PUBSUB["Pub/Sub (Gmail push)"]
    A --> STRIPE["Stripe (billing)"]
  end
```

## Core Workflows

### Uploads and Imports
This section covers all ingestion paths: direct uploads, Google Drive imports, and Gmail attachments. It also details ZIP handling, page counting, and status reporting.

- Local uploads (files/folders/ZIP)
  - Two supported upload modes:
    1) Direct-to-API (multipart)
       - Endpoint: `POST /api/jobs/{jobId}/files`
       - Body: `multipart/form-data` with `files[]`
       - Behavior:
         - Backend streams content to GCS using `GCSService.upload_file_content`.
         - Creates `SourceFile` rows with `original_filename`, `original_path`, `file_type`, initial `status='uploading'`.
         - ZIP detection triggers an async unpack via IO Task Service (`unpack_zip_file_task`), creating `SourceFile` entries for unpacked files, and excluding the archive file from processing.
         - Page counting occurs from file content using `PageCountingService` (PDF: page count; non-PDF defaults to 1).
       - Response: `{ files: Array<{ id, original_path, ... }>, message }` (simplified for docs; see UI usage).

    2) Direct-to-GCS (pre-signed URLs)
       - Endpoint: `POST /api/jobs/initiate`
       - Request model: `JobInitiateRequest` with `files` containing client paths; server returns normalized paths and signed PUT URLs.
       - Behavior:
         - Backend records planned files for the job run and returns `upload_url` per file (via `GCSService.generate_presigned_put_url`).
         - Client uploads directly to GCS using the signed URL (supports large files and resumability strategies client-side).
         - Page counting is performed after the upload completes (asynchronously), and `SourceFile.page_count` is set when available.
       - Response model: `JobInitiateResponse` including `{ files: [{ original_path, upload_url }...] }` and the job/run IDs.

  - ZIP handling and normalization
    - Archives uploaded via either mode are detected (`file_type` like `application/zip`).
    - IO Task Service unpacks archives (`unpack_zip_file_task`), creates `SourceFile` rows for extracted files, and sets folder-like `original_path` based on the ZIP’s internal structure.
    - The archive `SourceFile` is excluded from extraction workflows; only unpacked files are considered processable.

  - Conversions and page counting
    - DOCX→PDF conversion can run before extraction when enabled via `DocumentConversionService` (LibreOffice headless, timeout configurable).
    - `PageCountingService` counts pages for PDFs (PyPDF2, with PyMuPDF fallback); non-PDF defaults to 1 page. Results are used for usage metering.

  - SourceFile metadata and statuses
    - `SourceFile.original_path` preserves folder structure; used for grouping and processing mode selection.
    - `SourceFile.source_type` indicates origin: `upload` (default), `gdrive`, `gmail`.
    - `SourceFile.status` tracks lifecycle (e.g., `uploading`, `ready`, `failed`); import status endpoint aggregates by status and source.

- Google Drive imports
  - Endpoint: `POST /api/jobs/{jobId}/files:gdrive`
  - Body: `{ "file_ids": string[] }`
  - Behavior:
    - Validates job ownership, then enqueues an IO task via Cloud Run Tasks: `task_type="import_drive_files"` with Drive file IDs.
    - IO Task Service downloads file content using the Drive API, writes to GCS, and creates `SourceFile` rows (`source_type='gdrive'`).
    - `original_path` is inferred from Drive metadata; page counting and conversions apply as with local uploads.
  - Response: `{ success: true, import_task_name, message, file_count }`.

- Gmail attachment imports
  - Manual API:
    - Endpoint: `POST /api/jobs/{jobId}/files:gmail`
    - Body: `{ "attachments": Array<{ messageId, attachmentId, filename }> }` (all fields required per item)
    - Behavior: Enqueues IO task `task_type="import_gmail_attachments"`. IO Task fetches attachments via Gmail API, uploads to GCS, creates `SourceFile` rows (`source_type='gmail'`).
    - Response: `{ success: true, import_task_name, message, attachment_count }`.
  - Automated via Gmail push:
    - See Automations: Gmail push to `/api/webhooks/gmail-push` triggers matching automation(s); resulting import path is identical to the manual flow and produces `SourceFile` entries in the target job/run.

- Import status and file listing
  - Endpoint: `GET /api/jobs/{jobId}/import-status`
  - Behavior: Verifies ownership, queries `SourceFile` rows, and returns counts by `source_type` and `status`, plus a per-file list including size and timestamps.
  - Example response shape:
    - `{ total_files, by_source: { upload, gdrive, gmail }, by_status: { uploading, ready, failed, ... }, files: [{ id, filename, source_type, status, file_size, updated_at }] }`

Mermaid: Drive import flow
```mermaid
sequenceDiagram
  participant UI as Frontend
  participant API as FastAPI /api/jobs
  participant CT as Cloud Tasks
  participant IO as IO Task Service
  participant GD as Google Drive
  participant GCS as GCS
  participant DB as Postgres

  UI->>API: POST /jobs/{jobId}/files:gdrive (file_ids[])
  API->>CT: enqueue import_drive_files (jobId, runId, file_ids[])
  CT-->>IO: deliver task
  IO->>GD: fetch file content/metadata
  IO->>GCS: store file blobs
  IO->>DB: create SourceFile records
  IO-->>API: status available via job import status
```

### Extraction Pipeline
This section details how we transform files into structured results, including conversion, page counting, schema construction, AI calls, persistence, and metering.

- Field configuration and validation
  - A field consists of: `name` (unique per template), `data_type` (references canonical DataType), and an optional `prompt`.
  - Validation rules (see `AIExtractionService.validate_field_config`):
    - At least one field is required
    - No duplicate field names
    - Prompt length <= 1500 characters

- Preprocessing: conversions and page counting
  - Conversions
    - DOCX→PDF conversion is supported via headless LibreOffice (`DocumentConversionService`).
    - Enabled by default; can be disabled with `DOCX_CONVERSION_ENABLED=false`. Timeout configurable via `DOCX_CONVERSION_TIMEOUT` (default 120s).
    - Flow: download DOCX from GCS → convert locally → upload PDF back to GCS → downstream uses the PDF URI for extraction.
  - Page counting
    - `PageCountingService.count_pages_from_content` counts pages from bytes.
    - PDF: PyPDF2 first, then PyMuPDF fallback, finally temp-file fallback.
    - Non-PDF: assumed 1 page.
    - Stored on `SourceFile.page_count` and used for usage metering.

- Task creation and processing mode
  - Tasks are created per file (individual) or per folder (combined). See “Folders and Processing Modes” for task creation rules and append behaviors.
  - Each task has `processing_mode` ('individual'|'combined'|'manual') and `result_set_index` (append ordering).
  - `manual` tasks are not AI-processed; they exist to store user-created “manual rows” that are still exportable.

- AI schema construction
  - `AIExtractionService.create_tabular_json_schema(fields)` produces a compact `types.Schema` for a single JSON object: `{ "results": any[][] }`.
  - Each row in `results` is an array aligned to the run’s field order (the `job_fields` snapshot order).

- AI calls (pluggable)
  - The extraction service invokes the configured LLM provider through a pluggable interface.
  - Client (default): `google-genai` (Vertex integration) initialized with `GOOGLE_CLOUD_PROJECT_ID` and `GOOGLE_CLOUD_LOCATION`.
  - Model: `gemini-4-argon` (default).
  - Inputs: list of file parts built from GCS URIs (`types.Part.from_uri(uri, mime_type)`), plus a system prompt derived from field configuration.
  - Individual processing: one file per request; model returns `{ "results": [[...], ...] }`.
  - Combined processing: multiple files in one request; model returns a unified `{ "results": ... }` table across all input documents.
  - Fallback: if combined processing returns an error or empty data, we log and fall back to individual processing for the same files.

- Persistence
  - An `ExtractionTask` is linked to one or more `SourceFile` records via `SourceFileToTask`.
  - After AI returns data, an `ExtractionResult` row is saved per task with the structured JSON in `extracted_data`.
    - The model output is tabular (`{ "results": any[][] }`) and is persisted as an array-based table with a column snapshot.
    - `extracted_data` uses: `{ columns: string[], results: any[][] }`.
    - For editability, results also include stable row identifiers: `{ row_ids: string[], row_sources: ('ai'|'manual')[] }`.
  - The job run’s status reflects aggregate task states; completed tasks may be preserved in append runs.

- Usage metering and billing
  - For each processed task, we compute total pages by summing `SourceFile.page_count` linked via `SourceFileToTask`.
  - The per-user ledger has independent `page` and `token` units. Free/Basic/Pro include 100/500/5,000 pages and 200,000/1,000,000/10,000,000 platform AI tokens each period.
  - Basic/Pro page overages are $0.15/$0.05 per page; token overages are $0.25/$0.10 per 10,000 provider-reported tokens. Free users cannot start more work after the relevant allowance is exhausted.
  - `UsageEvent` stores product, source, unit, quantity, operation ID, provider token details, and explicit Stripe outbox state. Workspace and firm IDs are reporting/authorization metadata, never billing owners.
  - Inkwise ingestion and generation are token-only. It aggregates embeddings, helpers, retries, and primary generations; it never converts tokens or source pages into billable pages.
  - Maintenance drains pending/failed ledger events to the page or token Stripe meter using the usage-event UUID as the idempotent identifier.

- Errors, retries, and observability
  - Cloud Tasks retries failed tasks based on configured backoff; task status transitions to `failed` after exhaustion.
  - We persist errors in task/result metadata where available; a task may be partially successful (e.g., combined mode with some empty documents).
  - Logs include model name, file counts, and key identifiers; use Cloud Logging to correlate API and task logs.

Mermaid: file extraction
```mermaid
sequenceDiagram
  participant EX as Extract Task Service
  participant GCS as GCS
  participant LLM as LLM Provider
  participant DB as Postgres

  EX->>DB: read JobRun + SourceFiles
  EX->>EX: build JSON schema from FieldConfig/DataTypes
  EX->>GCS: construct gs:// URIs for files
  EX->>LLM: request(model=gemini-4-argon, schema, gs:// URIs)
  LLM-->>EX: structured JSON results
  EX->>DB: write ExtractionTask/ExtractionResult, update statuses
  EX->>DB: record UsageEvent, update UsageCounter
```

### Exports
This section details CSV/XLSX generation, large result handling, Drive export semantics, and idempotent export references.

- Download (CSV/XLSX)
  - Endpoints
    - CSV: `GET /api/jobs/{jobId}/export/csv?run_id=...`
    - Excel: `GET /api/jobs/{jobId}/export/excel?run_id=...`
  - Content generation
    - CSV: `export_service.generate_csv_content(results_response)`
    - Excel: `export_service.generate_excel_content(results_response)` using openpyxl
  - Unified schema
    - We construct a unified column list across all results in the run, preserving the first-seen order.
    - A leading column "Source File Path(s)" is always included to show provenance for each row.
      - Unattached manual rows are exported with source "(manual)".
    - For result arrays, values map from the local result's `columns` array; missing values become empty strings so a rectangular table is guaranteed.
  - Filenames
    - Server sets Content-Disposition to a safe filename generated by `generate_export_filename(job_name, timestamp, ext)`; e.g. `my_job_20250130_142355Z.csv`.
  - Large result considerations
    - CSV streaming writes header + rows incrementally in memory; for very large runs consider Drive export to avoid browser memory constraints.
    - Excel is held in memory before returning; large runs may be better exported to Drive.

- Google Drive export (async)
  - Endpoints (enqueue tasks)
    - CSV: `GET /api/jobs/{jobId}/export/gdrive/csv?run_id=...&folder_id=...`
    - Excel: `GET /api/jobs/{jobId}/export/gdrive/excel?run_id=...&folder_id=...`
  - Behavior
    - Verifies job ownership, then enqueues a Cloud Run Task `enqueue_export_task(jobId, userId, file_type, folder_id, run_id)`.
    - IO/Task Service fetches results, generates CSV/XLSX using the same helpers, and uploads to Drive.
    - Upsert semantics: exporter may create or update a Drive file in the target folder; resulting file ID and links are recorded.
  - Export references
    - Canonical refs stored in `job_exports` include `external_id` (Drive file ID), `file_type` (csv|xlsx), dest `gdrive`, and status.
    - Fetch canonical links with `GET /api/jobs/{jobId}/runs/{runId}/export-refs` which returns webView/webContent links per file type when available.
  - Idempotency and repeat exports
    - Re-invoking export for the same run/type updates the canonical Drive file (same external_id) rather than creating duplicates when possible.
    - This keeps links stable for downstream consumers.

Mermaid: export to Google Drive
```mermaid
sequenceDiagram
  participant UI as Frontend
  participant API as FastAPI /api/jobs
  participant CT as Cloud Tasks
  participant IO as IO Task Service
  participant DB as Postgres
  participant GD as Google Drive

  UI->>API: GET /jobs/{jobId}/export/gdrive/{csv|excel}
  API->>CT: enqueue export_job_to_google_drive(jobId, runId, type)
  CT-->>IO: deliver task
  IO->>DB: read results for run
  IO->>IO: generate CSV/XLSX content
  IO->>GD: upload or update file (dest folder/name)
  IO->>DB: persist JobExport with external_id and links
  UI->>API: GET /jobs/{jobId}/export/refs
  API-->>UI: return Drive links
```

### Automations (Gmail attachments trigger)
This section explains configuration, matching, Gmail push/watch lifecycle, idempotency, and error handling for automations.

- Configuration
  - Users define an Automation with:
    - `trigger_type = 'gmail_attachment'`
    - `trigger_config`: Gmail search query (e.g., `from:supplier@domain.com has:attachment newer_than:7d`)
    - `job_id` (target job), `processing_mode` (`individual`|`combined`), `append_results` (bool)
    - Optional export config: `dest_type='gdrive'` with `file_type` and `folder_id`
  - Editing an automation updates stored `processing_mode` and `append_results` applied to each run.

- Central mailbox model
  - Public alias: `document@cpaautomation.ai` forwards to the actual central mailbox.
  - Gmail API access uses a service account; mailbox is watched via Gmail Pub/Sub.
  - Pub/Sub topic/subscription/webhook are configured by `gmail_subscription_service` using env vars:
    - `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `GMAIL_WEBHOOK_URL`, `GOOGLE_CLOUD_PROJECT_ID`.

- Gmail push and watch lifecycle
  - Push destination: `/api/webhooks/gmail-push` (POST). Verification supported via GET.
  - `gmail_pubsub_service.process_push_notification` decodes the push and logs basic info.
  - `process_history_with_cursor(db)` fetches changes since last `historyId` and returns parsed messages, handling pagination.
  - Watch renewal: Cloud Scheduler periodically calls a maintenance task to renew the Gmail watch before the 7‑day expiry.

- Matching and triggering
  - For each parsed message, we extract: sender, subject, body, attachments (name, id, mime).
  - We map the sender to a user (if needed) and then select automations where the Gmail query matches; filters are evaluated using Gmail API search semantics.
  - For each matching automation:
    - Create a job run if needed, copying previous results when `append_results=true`.
    - Create extraction tasks using the automation’s `processing_mode` (individual or combined).
    - Enqueue imports for all attachments (IO task: `import_gmail_attachments`) followed by extraction and optional export.
  - The actual trigger is enqueued via Cloud Run Tasks (`enqueue_automation_task`), ensuring async processing and retries.

- Idempotency and cursoring
  - We maintain a mailbox history cursor; only new `historyId` deltas are processed.
  - If a 404 occurs for an old cursor, `_recover_from_404` performs a full sync (limited window) and resets watch.
  - Import workers de-duplicate attachments per message ID and filename when creating `SourceFile` rows to avoid duplicates.

- Error handling and observability
  - Webhook auth in development accepts localhost or a `GMAIL_PUBSUB_DEV_TOKEN`; production should enforce Google-signed JWT verification.
  - Failures in import/extraction/export paths are retried by Cloud Tasks; permanent errors are logged and surfaced in job run status.
  - Logs include `user_id`, task names, and Gmail `messageId`s for traceability across webhook → automation task → IO → extraction.

Mermaid: automation trigger flow
```mermaid
sequenceDiagram
  participant GM as Gmail
  participant PUB as Pub/Sub
  participant WH as "FastAPI /api/webhooks/gmail-push"
  participant DB as Postgres
  participant CT as Cloud Tasks
  participant AUTO as Automation Task Service
  participant IO as IO Task Service
  participant EX as Extract Task Service

  GM-->>PUB: push notification
  PUB-->>WH: HTTP push body
  WH->>DB: process_history_with_cursor(), find new messages
  WH->>DB: find automations with trigger_type=gmail_attachment
  WH->>CT: enqueue automation processing (per matched email)
  CT-->>AUTO: deliver automation task
  AUTO->>CT: enqueue import_gmail_attachments (job/run)
  CT-->>IO: deliver import task
  IO->>DB: create SourceFiles, store blobs in GCS
  IO->>CT: enqueue extraction for run
  CT-->>EX: deliver extract task
  EX->>DB: write results, usage
  EX->>CT: enqueue optional export
```

### Folders and Processing Modes
- Source file paths
  - Each file keeps an `original_path` (and `original_filename`) to preserve folder structure for grouping.
  - ZIPs are unpacked by the IO Task Service; unpacked files inherit archive paths.
  - Drive/Gmail imports populate `original_path` based on available filename/path context.

- Folder extraction strategies
  - Individual mode
    - One `ExtractionTask` per file with `processing_mode='individual'`.
    - Uses `AIExtractionService.extract_data_individual` (one file per Gemini request with the configured schema).
    - Exports include a “Source File Path(s)” column containing that file’s path.
  - Combined mode
    - Files are grouped by folder; a single `ExtractionTask` is created per folder with `processing_mode='combined'`.
    - Uses `AIExtractionService.extract_data_combined` (multiple files per Gemini request with a combined schema that includes source attribution).
    - The combined task links to all files in the folder; exported rows include the set of contributing source paths.
    - Fallback: If combined processing fails, the system falls back to individual processing for those files.
  - Manual mode
    - A `processing_mode='manual'` task stores user-entered rows.
    - Manual rows can be attached to an existing task (file/folder provenance) or left unattached; unattached rows display/export as “(manual)”.

- How folders are determined
  - `_get_folder_path(original_path)` extracts the folder portion; `_group_files_by_folder` builds `{ folder_path: [files...] }`.
  - Nested handling for overrides: a mapping entry applies to `folder_path == target_path` or `folder_path` starting with `target_path + '/'`.

- Per-folder processing mode overrides (manual jobs)
  - The frontend can send `processing_modes` with job field updates: `{ "folder/path": "individual" | "combined", ... }`.
  - For each entry, the service creates tasks accordingly:
    - `individual`: one task per file.
    - `combined`: one task for the entire folder.
  - Result sets: The service sets `result_set_index` to keep ordering consistent, particularly in append mode.

- Automation-level processing mode
  - Automations store a single `processing_mode` (default `'individual'`) that is applied when creating tasks per run.
  - Combined mode groups files by folder at automation time; one task per folder.

- Append mode and result sets
  - `append_results=true` on a job run copies completed tasks/results from the previous run and sets `append_from_run_id`.
  - New tasks get a higher `result_set_index` so appended results appear after original results.
  - In fresh runs (non-append), previously completed tasks are removed so the run reprocesses with the current configuration.

- Exports and folder context
  - CSV/XLSX include a unified set of columns across results and always include “Source File Path(s)”.
  - Individual rows contain a single path; combined rows include merged paths for that folder task.

Mermaid: folder grouping and task creation
```mermaid
flowchart TB
  subgraph Grouping
    F1["SourceFiles (with original_path)"] --> GP["_get_folder_path + _group_files_by_folder"]
    GP --> MAP["{ folder_path: [files...] }"]
  end

  subgraph Strategy
    MODE{"Mode?"}
    MODE -- "individual" --> IND["Create 1 task per file"]
    MODE -- "combined" --> COMB["Create 1 task per folder"]
  end

  MAP --> MODE
  IND --> T1["ExtractionTask(processing_mode='individual')"]
  COMB --> T2["ExtractionTask(processing_mode='combined', links all files in folder)"]
```

## Local Development

Local development is self-contained by default. It uses PostgreSQL in Docker,
filesystem object storage, local HTTP workers, an automatically signed-in local
developer identity, and a log-only email sink. Firebase, GCS, Cloud Tasks,
Stripe, Gmail, and the production API are not contacted.

Prerequisites

- Node.js 20+
- Python 3.11+
- Docker Desktop
- LibreOffice (`soffice`) only when testing DOCX-to-PDF conversion

Start the complete stack:

```bash
npm install
npm run dev
```

The first run creates `backend/.venv`, installs Python dependencies, starts
PostgreSQL, applies all Alembic migrations, seeds required reference data, and
starts these processes:

- Frontend: http://localhost:3000
- API and docs: http://127.0.0.1:8000 and http://127.0.0.1:8000/api/docs
- Local task services: ports 8001 through 8004

Uploaded objects are stored under `.local/storage/` and are ignored by Git.
PostgreSQL data lives in the Docker Compose volume. Stop the application with
Ctrl-C; stop PostgreSQL separately with `docker compose down` when desired.
If the pre-Compose `bytereview-postgres-dev` container exists, the launcher
reuses it to preserve its development data; stop that legacy container with
`docker stop bytereview-postgres-dev`.

### Local safety model

`npm run dev` overrides safety-sensitive inherited values. In particular it
sets `ENVIRONMENT=local`, `STORAGE_BACKEND=local`, `TASK_BACKEND=local`, and a
local authentication identity. It clears production Firebase, Stripe, Google
Cloud, and OpenConnector credentials. The Next.js API rewrite also defaults to
`http://127.0.0.1:8000`; a production rewrite is selected only when
`NEXT_PUBLIC_APP_ENV=production` is explicitly present in the production image.

Cloud integrations are opt-in. Copy the relevant names from `.env.example` and
use the `CPAA_LOCAL_*` variables for a dedicated non-production project or a
localhost OpenConnector runtime. Do not put production credentials in these
variables. AI extraction remains unavailable until a non-production Google
Cloud project is opted in.

The launcher automatically reads `CPAA_LOCAL_*` entries from the ignored root
`.env.local` and `.env` files when they exist. Start from `.env.example`.
Values already exported in the shell take precedence, followed by `.env.local`
and then `.env`, so the complete stack still starts with `npm run dev` without
a separate `source` command.

Useful commands

- `npm run dev:frontend` — frontend only (expects an API already on port 8000)
- `npm run backend` — API only using the bootstrapped virtual environment
- `npm run generate-types` — regenerate `lib/api-types.ts`
- `npm run test:unit` — frontend unit tests
- `cd backend && .venv/bin/pytest tests` — backend tests

Troubleshooting

- If startup says Docker is unavailable, start Docker Desktop and rerun `npm run dev`.
- If ports 3000 or 8000–8004 are occupied, stop the older development stack.
- Delete `backend/.venv` and rerun `npm run dev` to rebuild Python dependencies.
- AI endpoints intentionally report missing configuration until a dedicated
  development cloud project is supplied through `CPAA_LOCAL_*` variables.

## Deployment and Operations

Overview
- Deploys to Google Cloud Run (API + Task services) with Google Cloud Tasks, Cloud Scheduler, Pub/Sub, GCS, and Cloud SQL (Postgres)
- Scripts:
  - scripts/deploy.sh (unified entry point for building images, deploying services, or both; run this for routine deploys)
  - scripts/deploy-services.sh (API/frontend Cloud Run services, incl. Inkwise config + Alembic migrations; invoked by deploy.sh)
  - scripts/deploy-cloud-run-tasks.sh (task services: extract/io/automation/maintenance; invoked by deploy.sh)
  - scripts/setup-infrastructure.sh (one-time bootstrap: Cloud SQL, VPC connector, runner service account + IAM, GCS bucket, Artifact Registry — not part of routine deploys)
  - scripts/configure-artifact-registry-cleanup.sh (applies active cleanup to `cpa-docker` and `hosted-claw`: delete versions older than 30 days while retaining at least the 10 newest versions per package; set `CLEANUP_DRY_RUN=true` to test without deletion)
  - scripts/setup-secrets.sh (one-time Secret Manager provisioning for TASK_* URLs)

Environments and services
- Cloud Run services:
  - API service (FastAPI)
  - Task services: task-extract, task-io, task-automation, task-maintenance
- Cloud Tasks queues:
  - extract-tasks, io-tasks, automation-tasks, maintenance-tasks
- Cloud Scheduler jobs:
  - gmail-watch-renewal, stripe-usage-reconciliation, usage/artifact cleanup, abandoned/opt-out cleanup
- Pub/Sub topics/subscriptions:
  - Gmail push topic/subscription for webhook `/api/webhooks/gmail-push`
- GCS buckets:
  - Primary data bucket (e.g., cpaautomation-files-<env>)
  - Object naming: `jobs/{jobId}/...` and `jobs/{jobId}/runs/{runId}/...`
  - Lifecycle: see `backend/gcs-lifecycle.json` as a template and adjust prefixes to your retention policy (e.g., prune transient artifacts after N days)

IAM and identities
- Service accounts
  - Cloud Run runtime SA (e.g., cpaautomation-runner@PROJECT.iam.gserviceaccount.com)
  - Grant least privileges: Storage Object Admin (bucket), Cloud Tasks Enqueuer, Pub/Sub Publisher/Subscriber (as needed), Cloud SQL Client, Secret Manager Accessor
- Access and scopes
  - Frontend uses Firebase client SDK; backend verifies tokens via Firebase Admin (service account key)
  - Google OAuth client for Drive/Gmail user actions; service account for central mailbox

Core environment and secrets
- PROJECT and region
  - GOOGLE_CLOUD_PROJECT_ID, CLOUD_RUN_REGION
- Database
  - DATABASE_URL (Cloud SQL connection string via connector)
- Storage and AI
  - GCS_BUCKET_NAME
  - GOOGLE_APPLICATION_CREDENTIALS path (mounted secret or workload identity), GOOGLE_CLOUD_LOCATION
- Tasks and Scheduler
  - TASK_EXTRACT_URL, TASK_IO_URL, TASK_AUTOMATION_URL, TASK_MAINTENANCE_URL
- Billing
  - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PAGE_METER_EVENT_NAME, STRIPE_TOKEN_METER_EVENT_NAME
- Gmail Pub/Sub
  - GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_SUBSCRIPTION, GMAIL_WEBHOOK_URL, GMAIL_PUBSUB_DEV_TOKEN (dev only)

Step-by-step GCP setup (high level)
1) Project and APIs
  - Create/choose a GCP project
  - Enable: Cloud Run, Cloud Tasks, Cloud Scheduler, Cloud Pub/Sub, Secret Manager, Cloud SQL Admin, Vertex AI, Cloud Storage, IAM
2) Storage
  - Create a GCS bucket (e.g., cpaautomation-files-<env>)
  - Apply lifecycle rules (see `backend/gcs-lifecycle.json`)
3) Database
  - Create a Cloud SQL Postgres instance; create database and user
  - Configure private connectivity (VPC connector) if needed
4) Secrets and credentials
  - Store STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in Secret Manager
  - Store Firebase service account JSON; mount as `/var/secrets/google/service-account.json`
  - Store TASK_* URLs (or set post-deploy when URLs are known)
5) Build & deploy services
  - Run `./scripts/deploy.sh` to build images and deploy the API/frontend + task services
  - Use `./scripts/deploy.sh --frontend-only` to build and deploy only the frontend
  - Use `./scripts/deploy.sh --backend-only` to build and deploy only the API + task services
  - Use `./scripts/deploy.sh --build-only` to build and push application images without deploying
  - Use `./scripts/deploy.sh --deploy-only` to deploy existing images without rebuilding
  - Add `--with-taxatlas` to include the TaxAtlas browser image, jobs, seed, schedules, and monitoring (production backend deployments only); routine deploys leave existing TaxAtlas jobs and schedules unchanged
  - Target flags can be combined with phase flags, for example `./scripts/deploy.sh --frontend-only --deploy-only`
  - Set env vars and secret mounts per service
6) Tasks and queues
  - Ensure Cloud Tasks queues exist; run `cloud_run_task_service.setup_task_queues()` once or create via gcloud
7) Pub/Sub and Gmail push
  - Create Pub/Sub topic/subscription; set push endpoint to `/api/webhooks/gmail-push`
  - Configure Gmail watch (central mailbox) with the topic
  - For users’ Gmail watches (if applicable), use gmail_subscription_service helpers
8) Cloud Scheduler
  - Create jobs that POST to the task-maintenance service `/execute` with task_type payloads (see service code)
9) OAuth and integrations
  - Create Google OAuth client: set redirect URI to https://<frontend>/integrations/google/callback and local http://localhost:3000/integrations/google/callback
  - Stripe: configure products/prices and webhook endpoint `/api/webhooks/stripe` with STRIPE_WEBHOOK_SECRET

Migrations in CI/CD
- Use Alembic: `alembic upgrade head` during deploy or via a short-lived Cloud Run job

Operational practices
- Logging/Monitoring
  - Cloud Logging for all services; set LOG_LEVEL appropriately
  - Health checks: `/health` on API and task services
- Scaling and costs
  - Task services scale to zero when idle; tune min/max instances per service
- Backups and retention
  - Ensure Cloud SQL backups enabled; verify GCS lifecycle rules for temp data
- Incident response
  - Track task failure logs; adjust Cloud Tasks retry/backoff as necessary

Command examples (gcloud)
- Pub/Sub push (Gmail)
  - Create topic and push subscription to API webhook
```
PROJECT_ID=your-project
REGION=us-central1
TOPIC=gmail-notifications
SUB=gmail-notifications-sub
WEBHOOK_URL="https://api.yourdomain.com/api/webhooks/gmail-push"
SA_EMAIL="cpaautomation-runner@$PROJECT_ID.iam.gserviceaccount.com"

gcloud pubsub topics create $TOPIC --project=$PROJECT_ID || true

gcloud pubsub subscriptions create $SUB \
  --topic=$TOPIC \
  --push-endpoint=$WEBHOOK_URL \
  --push-auth-service-account=$SA_EMAIL \
  --project=$PROJECT_ID || true
```
- Cloud Tasks queues (if not created by code)
```
for Q in extract-tasks io-tasks automation-tasks maintenance-tasks; do 
  gcloud tasks queues create $Q --location=$REGION --project=$PROJECT_ID || true
done

gcloud tasks queues update extract-tasks \
  --location=$REGION \
  --project=$PROJECT_ID \
  --max-attempts=3 \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-retry-duration=900s \
  --max-doublings=5
```
- Cloud Scheduler jobs (call maintenance task service)
```
REGION=us-central1
PROJECT_ID=your-project
MAINTENANCE_URL="https://task-maintenance-$PROJECT_ID.$REGION.run.app/execute"
SA_EMAIL="cpaautomation-runner@$PROJECT_ID.iam.gserviceaccount.com"

# Gmail watch renewal (daily)
gcloud scheduler jobs create http cpaautomation-gmail-watch-renewal \
  --location=$REGION --schedule="45 6 * * *" --time-zone="UTC" \
  --uri="$MAINTENANCE_URL" --http-method=POST \
  --headers="Content-Type=application/json" \
  --oidc-service-account-email="$SA_EMAIL" \
  --message-body='{"task_type":"run_gmail_watch_renewal"}' || true

# Stripe usage reconciliation (every 2 hours)
gcloud scheduler jobs create http cpaautomation-stripe-usage-reconciliation \
  --location=$REGION --schedule="15 */2 * * *" --time-zone="UTC" \
  --uri="$MAINTENANCE_URL" --http-method=POST \
  --headers="Content-Type=application/json" \
  --oidc-service-account-email="$SA_EMAIL" \
  --message-body='{"task_type":"run_stripe_usage_reconciliation"}' || true
```
- Secret Manager (store required secrets)
```
PROJECT_ID=your-project

for NAME in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET TASK_EXTRACT_URL TASK_IO_URL TASK_AUTOMATION_URL TASK_MAINTENANCE_URL; do
  gcloud secrets create $NAME --project=$PROJECT_ID || true
  # Add a version (interactive)
  echo -n "<value>" | gcloud secrets versions add $NAME --data-file=- --project=$PROJECT_ID
done

# Access a secret
gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=$PROJECT_ID
```
- Service account roles (least privilege starting point)
```
PROJECT_ID=your-project
SA_EMAIL="cpaautomation-runner@$PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.invoker"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudtasks.enqueuer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/pubsub.subscriber"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/pubsub.publisher"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```



## Security and Data Management

Authentication and authorization
- Client-side: Firebase Auth issues ID tokens; frontend attaches Bearer tokens to API requests.
- Backend verification: `dependencies/auth.py` initializes Firebase Admin using GOOGLE_APPLICATION_CREDENTIALS and verifies ID tokens via `firebase_admin.auth.verify_id_token`.
- Route dependencies: `get_current_user_id`/`get_current_user_email` enforce authenticated requests; 401s on invalid/expired tokens.

Webhook security
- Stripe: `/api/webhooks/stripe` validates signatures using `STRIPE_WEBHOOK_SECRET` and `stripe.Webhook.construct_event`; rejects invalid signatures.
- Gmail push (dev): `/api/webhooks/gmail-push` allows localhost or `Authorization: Bearer ${GMAIL_PUBSUB_DEV_TOKEN}`. For production, implement Google-signed JWT verification for Pub/Sub push.

Secrets management
- Local/dev: .env used by backend/main.py (dotenv). Do not commit secrets.
- Production: store secrets in Secret Manager; mount as env vars or files (e.g., Firebase service account JSON at `/var/secrets/google/service-account.json`).
- Encryption of stored OAuth tokens and sensitive data:
  - Development: Fernet via `ENCRYPTION_KEY` (generated if missing in non-prod)
  - Production: Google Cloud KMS (`KMS_KEY_RESOURCE_NAME`) with fallback to Fernet if lib not available

Data handling and privacy
- File storage: GCS bucket stores uploads and artifacts using object names like `jobs/{jobId}/...` and `jobs/{jobId}/runs/{runId}/...`.
- Lifecycle and retention: use `backend/gcs-lifecycle.json` as a template and adjust its `matchesPrefix` to target transient artifacts (e.g., intermediate conversions) per your retention policy.
- PII considerations: extracted data may include PII. Ensure IAM on buckets restricts access; prefer per-environment buckets and least-privileged service accounts.
- In-transit encryption: HTTPS for all external endpoints; signed URLs used for direct uploads to GCS.
- At-rest encryption: GCS and Cloud SQL default encryption; sensitive tokens encrypted at application layer via EncryptionService.

IAM scopes and permissions
- Service accounts should have minimal roles required:
  - Cloud Run runtime SA: Cloud SQL Client, Secret Manager Accessor, Storage Object Admin (specific bucket), Cloud Tasks Enqueuer, Pub/Sub roles as needed
  - Task services may need Drive API scope via user OAuth (drive.file) and Gmail readonly for central mailbox via service account
- OAuth scopes:
  - Google Drive: drive.file (create and manage files created by the app)
  - Gmail (central mailbox): gmail.readonly for push processing

Usage metering and billing
- Usage events recorded per task (pages processed) in `usage_events`; cached totals in `usage_counters` for period UI.
- Stripe usage reporting: maintenance tasks reconcile and mark events as `stripe_reported`.

Compliance notes
- Access logs: retain Cloud Logging for API/task services; review access to webhooks and sensitive operations.
- Data residency: ensure project and bucket regions meet organizational requirements; configure CLOUD_RUN_REGION and GCS bucket region appropriately.
- Data deletion:
  - Jobs can be deleted (DB cascade); GCS cleanup is partially implemented (some paths still rely on background cleanup).
  - Results and files are coupled at the task level (no per-row provenance):
    - Deleting a row never deletes files unless the task becomes rowless.
    - Deleting a file never deletes rows unless the task becomes fileless.
  - Normal jobs do not allow direct file deletion in previous runs; the CPE tracker can delete files across prior runs.

## Reference Appendix

Data model overview (key tables)
- Users and integrations
  - users: Firebase-linked profile (id/email/display_name)
  - integration_accounts: Google account linkage and tokens (encrypted)
- Templates and data types
  - data_types: canonical field types (name/display/json format)
  - system_prompts: system-level AI prompts
  - templates, template_fields: reusable extraction templates
- Jobs and runs
  - extraction_jobs: top-level job (name, user_id, config_step)
  - job_runs: one execution; supports append via append_from_run_id and result_set_index
  - job_fields: field configuration captured per run
  - source_files: uploaded/imported files (original_path, file_type, page_count, source_type)
- Tasks and results
  - extraction_tasks: unit of work (processing_mode, status, result_set_index)
  - source_files_to_tasks: many-to-many linking files to tasks
  - extraction_results: structured JSON results per task
- Exports and automations
  - job_exports: CSV/XLSX to download/Drive with canonical refs
  - automations, automation_runs, automation_processed_messages: Gmail-triggered processing
- Billing and usage
  - subscription_plans, billing_accounts
  - usage_events (authoritative per-user page/token ledger and Stripe outbox), usage_counters (cached per-unit totals)

API surfaces
- Interactive API docs: /api/docs (OpenAPI JSON at /api/openapi.json)
- Major groups
  - /api/jobs: create/list, files (upload/gdrive/gmail), runs, results, export, export-refs
    - Results editing: create manual rows, edit cells, delete rows (last-row deletion may delete task files).
  - /api/jobs: primary extraction workflow (uploads, runs, results, export)
  - /api/integrations: Google OAuth/Drive/Gmail helpers
  - /api/automations: CRUD and execution
  - /api/stripe, /api/billing: subscription and usage
  - /api/webhooks: stripe, gmail-push
- Frontend types
  - Generated types: lib/api-types.ts (via openapi-typescript)
  - Typed client helpers: lib/api.ts

Environment variables (summary)
- Core
  - ENVIRONMENT, LOG_LEVEL, INIT_DB_AT_STARTUP
  - DATABASE_URL
- Google Cloud and AI
  - GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_LOCATION
  - GOOGLE_APPLICATION_CREDENTIALS, GCS_BUCKET_NAME, GCS_TEMP_FOLDER
  - GEMINI_MAX_OUTPUT_TOKENS
- OAuth/Integrations
  - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
  - GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_SUBSCRIPTION, GMAIL_WEBHOOK_URL, GMAIL_PUBSUB_DEV_TOKEN
- Stripe
  - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- Tasks/Scheduler
  - CLOUD_RUN_REGION, TASK_EXTRACT_URL, TASK_IO_URL, TASK_AUTOMATION_URL, TASK_MAINTENANCE_URL
- Security/crypto
  - ENCRYPTION_KEY (dev), KMS_KEY_RESOURCE_NAME (prod)

Glossary
- FieldConfig: { name, data_type, prompt } defining what to extract
- Processing Mode: strategy for extraction tasks; individual (per file), combined (per folder), or manual (user-entered rows)
- Job vs Run: job holds configuration; run is a specific execution (append can copy from previous run)
- Result Set Index: ordering and grouping index within a run (0 = original, 1+ = appended)
- Export Ref: canonical record of exported files (e.g., Drive file IDs) per run/type

FAQ and troubleshooting
- Why do I get Invalid token? Ensure frontend attaches Firebase ID token; backend validates via Admin SDK and requires GOOGLE_APPLICATION_CREDENTIALS.
- AI extraction fails with client not configured. Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS; ensure Vertex access and region.
- CSV/XLSX missing columns. Exporter unifies columns across results; verify extracted_data.columns populated by extraction.
- Gmail push webhook unauthorized. In dev, set GMAIL_PUBSUB_DEV_TOKEN or call from localhost. In prod, implement Pub/Sub JWT verification.
- Combined mode returns empty. Service falls back to individual mode; check schema/prompt and input file validity.

## Contributing

We welcome contributions that improve documentation, reliability, and developer experience.

- Branching and PRs
  - Create a feature branch from main, e.g., `docs/readme-improvements` or `feat/<area>`
  - Open a pull request with a clear summary; link any related issues
- Coding standards
  - Frontend: TypeScript, React hooks, typed API calls (lib/api.ts + lib/api-types.ts)
  - Backend: Pydantic models, FastAPI routers, SQLAlchemy sessions via core/database, Alembic migrations for schema changes
- Types and API contracts
  - After changing backend endpoints/models, regenerate OpenAPI types: `npm run generate-types`
  - Ensure `lib/api-types.ts` compiles and update any affected frontend code
- Local environment
  - Follow Local Development section to run Postgres, apply migrations, and start services
  - Update `.env.example` (if present) when adding new env vars
- Tests and verification
  - Validate OpenAPI docs at `/api/docs`
  - Smoke test file uploads/imports, extraction, and exports locally before merging
- Documentation
  - Update README sections relevant to your change (e.g., new workflow or env vars)
  - For complex changes, consider adding a page under `/docs` and linking it here

Thank you for contributing to CPAAutomation!

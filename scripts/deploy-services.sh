#!/bin/bash
# CPAAutomation services deployment (frontend + backend).
#
# This is THE deploy script for the cpa-api (backend) and cpa-web (frontend)
# Cloud Run services. It builds the images, ensures supporting infrastructure
# (secrets + Cloud Tasks queue), creates the base services if they don't exist
# yet, then deploys both services — re-asserting the FULL desired set of env
# vars and secrets on every run so configuration cannot silently drift.
#
# It supersedes the previous split between deploy-services.sh (base create) and
# deploy-inkwise.sh (incremental Inkwise update): the base CPAAutomation config
# (DATABASE_URL, Firebase, Stripe, Google OAuth, GCS, enqueue tuning, …) and the
# Inkwise/Cloud-Tasks config now live together here.
#
# Other Cloud Run services (workers, task handlers) are deployed by
# scripts/deploy-cloud-run-tasks.sh — not this script.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT_ID="${PROJECT_ID:-ace-rider-383100}"
REGION="${REGION:-us-central1}"
ENVIRONMENT="${ENVIRONMENT:-production}"
ARTIFACT_REGISTRY_REPO="${ARTIFACT_REGISTRY_REPO:-cpa-docker}"
ARTIFACT_REGISTRY_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-cpaautomation-runner@${PROJECT_ID}.iam.gserviceaccount.com}"
VPC_CONNECTOR="${VPC_CONNECTOR:-cpa-svpc}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-${PROJECT_ID}:${REGION}:cpaautomation-db}"
ESIGN_KMS_SIGNING_KEY_VERSION="${ESIGN_KMS_SIGNING_KEY_VERSION:-projects/${PROJECT_ID}/locations/${REGION}/keyRings/esign/cryptoKeys/esign-seal/cryptoKeyVersions/2}"
ESIGN_SIGNING_CERT_SECRET="${ESIGN_SIGNING_CERT_SECRET:-esign-signing-cert}"

# --- Base backend tuning (carried over from the previous deploy-services.sh) ---
EXTRACTION_ENQUEUE_BATCH_SIZE="${EXTRACTION_ENQUEUE_BATCH_SIZE:-5}"
EXTRACTION_ENQUEUE_BATCH_DELAY_SECONDS="${EXTRACTION_ENQUEUE_BATCH_DELAY_SECONDS:-15}"
EXTRACTION_ENQUEUE_MAX_DELAY_SECONDS="${EXTRACTION_ENQUEUE_MAX_DELAY_SECONDS:-900}"
EXTRACTION_ENQUEUE_JITTER_SECONDS="${EXTRACTION_ENQUEUE_JITTER_SECONDS:-5}"
FORM_FILL_OUTPUT_ENQUEUE_BATCH_SIZE="${FORM_FILL_OUTPUT_ENQUEUE_BATCH_SIZE:-5}"
FORM_FILL_OUTPUT_ENQUEUE_BATCH_DELAY_SECONDS="${FORM_FILL_OUTPUT_ENQUEUE_BATCH_DELAY_SECONDS:-15}"
FORM_FILL_OUTPUT_ENQUEUE_MAX_DELAY_SECONDS="${FORM_FILL_OUTPUT_ENQUEUE_MAX_DELAY_SECONDS:-900}"
FORM_FILL_OUTPUT_ENQUEUE_JITTER_SECONDS="${FORM_FILL_OUTPUT_ENQUEUE_JITTER_SECONDS:-5}"
API_CONCURRENCY="${API_CONCURRENCY:-15}"
DB_POOL_SIZE="${DB_POOL_SIZE:-5}"
DB_MAX_OVERFLOW="${DB_MAX_OVERFLOW:-10}"
DB_POOL_TIMEOUT_SECONDS="${DB_POOL_TIMEOUT_SECONDS:-5}"
DB_POOL_RECYCLE_SECONDS="${DB_POOL_RECYCLE_SECONDS:-1800}"

GCS_BUCKET_NAME="${GCS_BUCKET_NAME:-cpaautomation-files-prod}"
GCS_TEMP_FOLDER="${GCS_TEMP_FOLDER:-temp_uploads}"
FIREBASE_CREDENTIALS_PATH="/var/secrets/google/service-account.json"

# --- Inkwise runtime config ---
INKWISE_DERIVED_BUCKET="${INKWISE_DERIVED_BUCKET:-cpaautomation-files-prod}"
INKWISE_MAX_UPLOAD_MB="${INKWISE_MAX_UPLOAD_MB:-100}"
INKWISE_MAX_VIDEO_UPLOAD_MB="${INKWISE_MAX_VIDEO_UPLOAD_MB:-1000}"
INKWISE_MAX_BOUND_SOURCES="${INKWISE_MAX_BOUND_SOURCES:-100}"
INKWISE_GEMINI_MODEL="${INKWISE_GEMINI_MODEL:-gemini-3.7-flash}"
INKWISE_GROUNDED_MODEL="${INKWISE_GROUNDED_MODEL:-$INKWISE_GEMINI_MODEL}"
INKWISE_EMBEDDING_MODEL="${INKWISE_EMBEDDING_MODEL:-gemini-embedding-2-preview}"
INKWISE_EMBEDDING_LOCATION="${INKWISE_EMBEDDING_LOCATION:-us-central1}"
INKWISE_EMBEDDING_DIMENSION="${INKWISE_EMBEDDING_DIMENSION:-1536}"
INKWISE_EMBEDDING_QUERY_TASK_TYPE="${INKWISE_EMBEDDING_QUERY_TASK_TYPE:-RETRIEVAL_QUERY}"
INKWISE_EMBEDDING_DOCUMENT_TASK_TYPE="${INKWISE_EMBEDDING_DOCUMENT_TASK_TYPE:-RETRIEVAL_DOCUMENT}"
INKWISE_USE_LEXICAL_FUSION="${INKWISE_USE_LEXICAL_FUSION:-false}"
INKWISE_USE_VECTOR_RERANK="${INKWISE_USE_VECTOR_RERANK:-false}"
INKWISE_VECTOR_SEARCH_TOP_K="${INKWISE_VECTOR_SEARCH_TOP_K:-24}"
INKWISE_LEXICAL_SEARCH_TOP_K="${INKWISE_LEXICAL_SEARCH_TOP_K:-16}"
INKWISE_DIVERSITY_PER_SOURCE_TOP_K="${INKWISE_DIVERSITY_PER_SOURCE_TOP_K:-2}"
INKWISE_MAX_BALANCED_EVIDENCE_PER_SOURCE="${INKWISE_MAX_BALANCED_EVIDENCE_PER_SOURCE:-3}"
INKWISE_DIVERSITY_VECTOR_SCORE_MARGIN="${INKWISE_DIVERSITY_VECTOR_SCORE_MARGIN:-0.05}"
INKWISE_RERANK_TOP_K="${INKWISE_RERANK_TOP_K:-12}"
INKWISE_VECTOR_RERANK_MODEL="${INKWISE_VECTOR_RERANK_MODEL:-$INKWISE_GEMINI_MODEL}"
INKWISE_SEGMENT_PDF_WINDOW_PAGES="${INKWISE_SEGMENT_PDF_WINDOW_PAGES:-4}"
INKWISE_SEGMENT_PDF_WINDOW_OVERLAP_PAGES="${INKWISE_SEGMENT_PDF_WINDOW_OVERLAP_PAGES:-1}"
INKWISE_SEGMENT_TEXT_CHUNK_CHARS="${INKWISE_SEGMENT_TEXT_CHUNK_CHARS:-3000}"
API_TIMEOUT="${API_TIMEOUT:-900}"
# Universal Document Analysis tools on the Claw MCP gateway.
CLAW_UDA_MCP_ENABLED="${CLAW_UDA_MCP_ENABLED:-true}"
HOSTED_CLAW_ENABLED="${HOSTED_CLAW_ENABLED:-true}"
HOSTED_CLAW_CRON_ENABLED="${HOSTED_CLAW_CRON_ENABLED:-true}"
HOSTED_CLAW_KMS_KEY="${HOSTED_CLAW_KMS_KEY:-projects/${PROJECT_ID}/locations/${REGION}/keyRings/hosted-claw/cryptoKeys/control-plane}"
HOSTED_CLAW_ARTIFACT_BUCKET="${HOSTED_CLAW_ARTIFACT_BUCKET:-${PROJECT_ID}-hosted-claw-artifacts}"
HOSTED_CLAW_PUBSUB_TOPIC="${HOSTED_CLAW_PUBSUB_TOPIC:-hosted-claw-jobs}"
HOSTED_CLAW_WORKER_SERVICE_ACCOUNT="${HOSTED_CLAW_WORKER_SERVICE_ACCOUNT:-hosted-claw-worker@${PROJECT_ID}.iam.gserviceaccount.com}"

# AccountingClaw bundle decryption secret (Secret Manager). The same value must
# be used to build the AccountingClaw image; the activation /resolve endpoint
# returns it to containers. Seeded from backend/.env on first deploy (see
# ensure_bundle_secret) and wired into the API as a mounted secret.
BUNDLE_SECRET_NAME="${BUNDLE_SECRET_NAME:-CPAA_BUNDLE_SECRET}"

# AccountingClaw desktop bundle (non-secret): private GCS object that the
# /api/activation/bundle endpoint serves via short-lived signed URLs to desktop
# installs. Publish/update the object with scripts/publish-accountingclaw-bundle.sh.
CPAA_BUNDLE_GCS_BUCKET="${CPAA_BUNDLE_GCS_BUCKET:-cpaa-accountingclaw-bundles}"
CPAA_BUNDLE_GCS_OBJECT="${CPAA_BUNDLE_GCS_OBJECT:-accountingclaw/accountingclaw-profile.tar.gz}"

# LegalClaw bundle decryption secret (Secret Manager) and desktop bundle object
# (same private bucket as AccountingClaw). The secret must match the value the
# LegalClaw image was built with (scripts/build-legalclaw-image.sh); the object
# is published with scripts/publish-legalclaw-bundle.sh. Both are optional until
# LegalClaw is rolled out: the secret is mounted only when it exists.
LEGALCLAW_BUNDLE_SECRET_NAME="${LEGALCLAW_BUNDLE_SECRET_NAME:-CPAA_LEGALCLAW_BUNDLE_SECRET}"
CPAA_LEGALCLAW_BUNDLE_GCS_OBJECT="${CPAA_LEGALCLAW_BUNDLE_GCS_OBJECT:-legalclaw/legalclaw-profile.tar.gz}"

SKIP_BUILD=false
SKIP_MIGRATE=false
WITH_TAXATLAS=false
ROTATE_TASK_TOKEN=false
DEPLOY_TARGET="all"

if git -C "$ROOT_DIR" rev-parse --short HEAD >/dev/null 2>&1; then
  IMAGE_TAG_DEFAULT="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
else
  IMAGE_TAG_DEFAULT="latest"
fi
IMAGE_TAG="${IMAGE_TAG:-$IMAGE_TAG_DEFAULT}"

normalize_bucket_name() {
  local value="${1:-}"
  value="${value#gs://}"
  value="${value%/}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

INKWISE_DERIVED_BUCKET="$(normalize_bucket_name "$INKWISE_DERIVED_BUCKET")"

usage() {
  cat <<EOF
Usage: ./scripts/deploy-services.sh [options]
       ./scripts/deploy-services.sh [IMAGE_TAG] [ENVIRONMENT]   # positional, back-compat

Deploys the cpa-api (backend) and cpa-web (frontend) Cloud Run services.

Options:
  --project-id ID           GCP project id (default: ${PROJECT_ID})
  --region REGION           GCP region (default: ${REGION})
  --image-tag TAG           Docker image tag to deploy (default: git sha)
  --environment ENV         production or staging (default: ${ENVIRONMENT})
  --frontend-only           Build/deploy only cpa-web
  --backend-only            Build/deploy only cpa-api and backend resources
  --skip-build              Reuse existing backend/frontend images
  --skip-migrate            Skip Alembic migration job
  --with-taxatlas           Include TaxAtlas browser image, jobs, seed, schedules, and monitoring (production backend only)
  --rotate-task-token       Force a new Inkwise task token secret version
  -h, --help                Show this help text
EOF
}

section() {
  echo -e "${YELLOW}===================================================${NC}"
  echo -e "${YELLOW}$1${NC}"
  echo -e "${YELLOW}===================================================${NC}"
}

info() {
  echo -e "${BLUE}$1${NC}"
}

ok() {
  echo -e "${GREEN}$1${NC}"
}

warn() {
  echo -e "${YELLOW}$1${NC}"
}

die() {
  echo -e "${RED}$1${NC}"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

service_exists() {
  local service_name="$1"
  gcloud run services describe "$service_name" --region="$REGION" >/dev/null 2>&1
}

secret_exists() {
  local secret_name="$1"
  gcloud secrets describe "$secret_name" >/dev/null 2>&1
}

queue_exists() {
  local queue_name="$1"
  gcloud tasks queues describe "$queue_name" --location="$REGION" >/dev/null 2>&1
}

random_token() {
  openssl rand -hex 32
}

# Join env-var "k=v" items using a delimiter that does not occur in any item.
# The leading "^DELIMITER^" tells gcloud not to split values on commas. Do not
# use a fixed delimiter here: env values commonly contain commas, URLs, and
# service-account email addresses (and therefore '@').
join_env_vars() {
  local delimiter=""
  local candidate
  local item

  for candidate in '|' '%' ';' '~' '#'; do
    delimiter="$candidate"
    for item in "$@"; do
      if [[ "$item" == *"$candidate"* ]]; then
        delimiter=""
        break
      fi
    done
    if [ -n "$delimiter" ]; then
      break
    fi
  done

  [ -n "$delimiter" ] || die "Could not encode Cloud Run environment variables: no safe gcloud delimiter found"

  local IFS="$delimiter"
  printf '^%s^%s' "$delimiter" "$*"
}

ensure_secret_value() {
  local secret_name="$1"
  local should_rotate="$2"
  local token

  if ! secret_exists "$secret_name"; then
    token="$(random_token)"
    printf '%s' "$token" | gcloud secrets create "$secret_name" --data-file=- >/dev/null
    ok "Created secret ${secret_name}"
    return
  fi

  if [ "$should_rotate" = true ]; then
    token="$(random_token)"
    printf '%s' "$token" | gcloud secrets versions add "$secret_name" --data-file=- >/dev/null
    ok "Rotated secret ${secret_name}"
  else
    ok "Secret ${secret_name} already exists"
  fi
}

# Ensure the AccountingClaw bundle secret exists in Secret Manager. Created only
# if absent (an existing value is never overwritten), seeded from the
# CPAA_BUNDLE_SECRET value in backend/.env so the deployed backend hands out the
# same secret that the image was encrypted with.
ensure_bundle_secret() {
  if secret_exists "$BUNDLE_SECRET_NAME"; then
    ok "Secret ${BUNDLE_SECRET_NAME} already exists (left unchanged)"
    return
  fi

  local env_file="$ROOT_DIR/backend/.env"
  local value=""
  if [ -f "$env_file" ]; then
    value="$(grep -E '^CPAA_BUNDLE_SECRET=' "$env_file" | head -n1 | cut -d= -f2-)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
  fi

  if [ -z "$value" ] || [ "$value" = "replace-with-the-build-time-bundle-secret" ]; then
    die "Cannot create ${BUNDLE_SECRET_NAME}: set a real CPAA_BUNDLE_SECRET in backend/.env first (it must match the value the AccountingClaw image was built with)."
  fi

  printf '%s' "$value" | gcloud secrets create "$BUNDLE_SECRET_NAME" --data-file=- >/dev/null
  ok "Created secret ${BUNDLE_SECRET_NAME} from backend/.env"
}

# Ensure the LegalClaw bundle secret exists in Secret Manager, seeded from
# CPAA_LEGALCLAW_BUNDLE_SECRET in backend/.env. Unlike the AccountingClaw
# secret this is optional: if it isn't configured yet we warn and the API is
# deployed without it (LegalClaw /resolve then returns 503 until it's set).
ensure_legalclaw_bundle_secret() {
  if secret_exists "$LEGALCLAW_BUNDLE_SECRET_NAME"; then
    ok "Secret ${LEGALCLAW_BUNDLE_SECRET_NAME} already exists (left unchanged)"
    return
  fi

  local env_file="$ROOT_DIR/backend/.env"
  local value=""
  if [ -f "$env_file" ]; then
    value="$(grep -E '^CPAA_LEGALCLAW_BUNDLE_SECRET=' "$env_file" | head -n1 | cut -d= -f2-)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
  fi

  if [ -z "$value" ] || [ "$value" = "replace-with-the-build-time-bundle-secret" ]; then
    warn "Skipping ${LEGALCLAW_BUNDLE_SECRET_NAME}: set CPAA_LEGALCLAW_BUNDLE_SECRET in backend/.env (matching the LegalClaw image build) to enable LegalClaw activation."
    return
  fi

  printf '%s' "$value" | gcloud secrets create "$LEGALCLAW_BUNDLE_SECRET_NAME" --data-file=- >/dev/null
  ok "Created secret ${LEGALCLAW_BUNDLE_SECRET_NAME} from backend/.env"
}

ensure_queue() {
  local queue_name="$1"

  if queue_exists "$queue_name"; then
    gcloud tasks queues update "$queue_name" \
      --location="$REGION" \
      --max-dispatches-per-second=2 \
      --max-concurrent-dispatches=2 \
      --max-attempts=5 >/dev/null
    ok "Cloud Tasks queue ${queue_name} updated"
  else
    gcloud tasks queues create "$queue_name" \
      --location="$REGION" \
      --max-dispatches-per-second=2 \
      --max-concurrent-dispatches=2 \
      --max-attempts=5 >/dev/null
    ok "Cloud Tasks queue ${queue_name} created"
  fi
}

# Create the base API/web services if they don't exist yet so the later
# `gcloud run services update` re-assertion has something to update. The full
# base config is applied here for fresh environments; existing services are
# left untouched at this step and re-asserted by deploy_api/deploy_web.
ensure_base_services() {
  local api_service="$1"
  local web_service="$2"

  if [ "$DEPLOY_BACKEND" = true ] && ! service_exists "$api_service"; then
    warn "Base API service ${api_service} missing; creating it"
    gcloud run deploy "$api_service" \
      --image="$BACKEND_IMAGE" \
      --region="$REGION" \
      --platform=managed \
      --allow-unauthenticated \
      --port=8000 \
      --memory=2Gi \
      --cpu=2 \
      --cpu-boost \
      --min-instances="$API_MIN_INSTANCES" \
      --max-instances=10 \
      --concurrency="$API_CONCURRENCY" \
      --timeout="$API_TIMEOUT" \
      --add-cloudsql-instances="$CLOUD_SQL_INSTANCE" \
      --vpc-connector="$VPC_CONNECTOR" \
      --vpc-egress=private-ranges-only \
      --service-account="$SERVICE_ACCOUNT" \
      --update-secrets="$BACKEND_BASE_SECRETS" \
      --update-env-vars="$(join_env_vars "${BACKEND_BASE_ENV[@]}")" \
      >/dev/null
    ok "Created ${api_service}"
  fi

  if [ "$DEPLOY_FRONTEND" = true ] && ! service_exists "$web_service"; then
    warn "Base web service ${web_service} missing; creating it"
    gcloud run deploy "$web_service" \
      --image="$FRONTEND_IMAGE" \
      --region="$REGION" \
      --platform=managed \
      --allow-unauthenticated \
      --port=3000 \
      --memory=1Gi \
      --cpu=1 \
      --cpu-boost \
      --min-instances="$WEB_MIN_INSTANCES" \
      --max-instances=5 \
      --concurrency=100 \
      --timeout=60 \
      --update-env-vars="NODE_ENV=production" \
      >/dev/null
    ok "Created ${web_service}"
  fi
}

deploy_api() {
  local service_name="$1"
  local image_url="$2"
  local api_url="$3"
  local queue_name="$4"
  local token_secret_name="$5"
  local env_items
  local env_vars
  local secrets

  # Full desired env: base CPAAutomation config + Inkwise runtime config.
  # Re-asserted on every deploy via --update-env-vars (merge semantics — env
  # vars set elsewhere are preserved, declared ones are brought back in sync).
  env_items=(
    "${BACKEND_BASE_ENV[@]}"
    "INKWISE_ENABLED=true"
    "HOSTED_CLAW_ENABLED=${HOSTED_CLAW_ENABLED}"
    "HOSTED_CLAW_CRON_ENABLED=${HOSTED_CLAW_CRON_ENABLED}"
    "HOSTED_CLAW_INTERNAL_AUDIENCE=${api_url}"
    "INKWISE_DERIVED_BUCKET=${INKWISE_DERIVED_BUCKET}"
    "INKWISE_MAX_UPLOAD_MB=${INKWISE_MAX_UPLOAD_MB}"
    "INKWISE_MAX_VIDEO_UPLOAD_MB=${INKWISE_MAX_VIDEO_UPLOAD_MB}"
    "INKWISE_MAX_BOUND_SOURCES=${INKWISE_MAX_BOUND_SOURCES}"
    "INKWISE_GEMINI_MODEL=${INKWISE_GEMINI_MODEL}"
    "INKWISE_GROUNDED_MODEL=${INKWISE_GROUNDED_MODEL}"
    "INKWISE_EMBEDDING_MODEL=${INKWISE_EMBEDDING_MODEL}"
    "INKWISE_EMBEDDING_LOCATION=${INKWISE_EMBEDDING_LOCATION}"
    "INKWISE_EMBEDDING_DIMENSION=${INKWISE_EMBEDDING_DIMENSION}"
    "INKWISE_EMBEDDING_QUERY_TASK_TYPE=${INKWISE_EMBEDDING_QUERY_TASK_TYPE}"
    "INKWISE_EMBEDDING_DOCUMENT_TASK_TYPE=${INKWISE_EMBEDDING_DOCUMENT_TASK_TYPE}"
    "INKWISE_QUERY_REWRITE_MODEL=${INKWISE_QUERY_REWRITE_MODEL:-${INKWISE_GEMINI_MODEL}}"
    "INKWISE_QUERY_REWRITE_ENABLED=${INKWISE_QUERY_REWRITE_ENABLED:-true}"
    "INKWISE_USE_LEXICAL_FUSION=${INKWISE_USE_LEXICAL_FUSION}"
    "INKWISE_USE_VECTOR_RERANK=${INKWISE_USE_VECTOR_RERANK}"
    "INKWISE_VECTOR_SEARCH_TOP_K=${INKWISE_VECTOR_SEARCH_TOP_K}"
    "INKWISE_LEXICAL_SEARCH_TOP_K=${INKWISE_LEXICAL_SEARCH_TOP_K}"
    "INKWISE_DIVERSITY_PER_SOURCE_TOP_K=${INKWISE_DIVERSITY_PER_SOURCE_TOP_K}"
    "INKWISE_MAX_BALANCED_EVIDENCE_PER_SOURCE=${INKWISE_MAX_BALANCED_EVIDENCE_PER_SOURCE}"
    "INKWISE_DIVERSITY_VECTOR_SCORE_MARGIN=${INKWISE_DIVERSITY_VECTOR_SCORE_MARGIN}"
    "INKWISE_RERANK_TOP_K=${INKWISE_RERANK_TOP_K}"
    "INKWISE_VECTOR_RERANK_MODEL=${INKWISE_VECTOR_RERANK_MODEL}"
    "INKWISE_SEGMENT_PDF_WINDOW_PAGES=${INKWISE_SEGMENT_PDF_WINDOW_PAGES}"
    "INKWISE_SEGMENT_PDF_WINDOW_OVERLAP_PAGES=${INKWISE_SEGMENT_PDF_WINDOW_OVERLAP_PAGES}"
    "INKWISE_SEGMENT_TEXT_CHUNK_CHARS=${INKWISE_SEGMENT_TEXT_CHUNK_CHARS}"
    "CLOUD_TASKS_PROJECT=${PROJECT_ID}"
    "CLOUD_TASKS_LOCATION=${REGION}"
    "CLOUD_TASKS_QUEUE_INGEST=${queue_name}"
    "CLOUD_TASKS_SERVICE_URL=${api_url}"
    "INKWISE_INLINE_INGEST_FALLBACK_ENABLED=false"
    "INKWISE_TASKS_QUEUE=${queue_name}"
    "INKWISE_TASKS_SERVICE_URL=${api_url}"
  )

  env_vars="$(join_env_vars "${env_items[@]}")"

  # Full desired secrets: base CPAAutomation secrets (incl. CPAA_BUNDLE_SECRET)
  # plus the Inkwise task token. Re-asserted via --update-secrets (merge).
  secrets="${BACKEND_BASE_SECRETS},INKWISE_TASKS_TOKEN=${token_secret_name}:latest,TASKS_TOKEN=${token_secret_name}:latest"

  gcloud run services update "$service_name" \
    --region="$REGION" \
    --image="$image_url" \
    --cpu-boost \
    --min-instances="$API_MIN_INSTANCES" \
    --concurrency="$API_CONCURRENCY" \
    --timeout="${API_TIMEOUT}" \
    --update-env-vars="$env_vars" \
    --update-secrets="$secrets" \
    >/dev/null

  ok "Updated ${service_name} (base + Inkwise config re-asserted)"
}

deploy_web() {
  local service_name="$1"
  local image_url="$2"

  gcloud run services update "$service_name" \
    --region="$REGION" \
    --image="$image_url" \
    --cpu-boost \
    --min-instances="$WEB_MIN_INSTANCES" \
    --update-env-vars="NODE_ENV=production" \
    >/dev/null

  ok "Updated ${service_name} with the latest frontend image"
}

run_migrations() {
  local image_url="$1"
  local job_name="$2"

  local common_args=(
    --image="$image_url"
    --region="$REGION"
    --service-account="$SERVICE_ACCOUNT"
    --set-cloudsql-instances="$CLOUD_SQL_INSTANCE"
    --vpc-connector="$VPC_CONNECTOR"
    --vpc-egress=private-ranges-only
    --set-secrets=DATABASE_URL=DATABASE_URL:latest
    --command=alembic
    --args=-c,alembic.ini,upgrade,head
    --tasks=1
    --parallelism=1
    --max-retries=1
    --task-timeout=1200
  )

  if gcloud run jobs describe "$job_name" --region="$REGION" >/dev/null 2>&1; then
    gcloud run jobs update "$job_name" "${common_args[@]}" >/dev/null
  else
    gcloud run jobs create "$job_name" "${common_args[@]}" >/dev/null
  fi

  gcloud run jobs execute "$job_name" --region="$REGION" --wait >/dev/null
  ok "Alembic migrations executed via Cloud Run job ${job_name}"
}

# Positional back-compat: `deploy-services.sh <IMAGE_TAG> <ENVIRONMENT>` (as
# called historically by deploy.sh and build-images.sh). Flags below take
# precedence and are the preferred interface.
if [[ "${1:-}" != "" && "${1:-}" != -* ]]; then
  IMAGE_TAG="$1"
  if [[ "${2:-}" != "" && "${2:-}" != -* ]]; then
    ENVIRONMENT="$2"
    shift 2
  else
    shift
  fi
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id)
      PROJECT_ID="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --frontend-only)
      if [ "$DEPLOY_TARGET" != "all" ] && [ "$DEPLOY_TARGET" != "frontend" ]; then
        die "Cannot combine frontend-only and backend-only options"
      fi
      DEPLOY_TARGET="frontend"
      shift
      ;;
    --backend-only)
      if [ "$DEPLOY_TARGET" != "all" ] && [ "$DEPLOY_TARGET" != "backend" ]; then
        die "Cannot combine frontend-only and backend-only options"
      fi
      DEPLOY_TARGET="backend"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=true
      shift
      ;;
    --with-taxatlas)
      WITH_TAXATLAS=true
      shift
      ;;
    --rotate-task-token)
      ROTATE_TASK_TOKEN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

if [ "$WITH_TAXATLAS" = true ] && { [ "$DEPLOY_TARGET" = "frontend" ] || [ "$ENVIRONMENT" != "production" ]; }; then
  die "--with-taxatlas requires a production deployment that includes the backend"
fi

DEPLOY_BACKEND=false
DEPLOY_FRONTEND=false
if [ "$DEPLOY_TARGET" = "all" ] || [ "$DEPLOY_TARGET" = "backend" ]; then
  DEPLOY_BACKEND=true
fi
if [ "$DEPLOY_TARGET" = "all" ] || [ "$DEPLOY_TARGET" = "frontend" ]; then
  DEPLOY_FRONTEND=true
fi

ARTIFACT_REGISTRY_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-cpaautomation-runner@${PROJECT_ID}.iam.gserviceaccount.com}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-${PROJECT_ID}:${REGION}:cpaautomation-db}"

API_SERVICE="cpa-api"
WEB_SERVICE="cpa-web"
QUEUE_NAME="inkwise-ingest"
TASK_TOKEN_SECRET="INKWISE_TASKS_TOKEN"
MIGRATION_JOB_NAME="cpa-migrate"
API_MIN_INSTANCES=1
WEB_MIN_INSTANCES=1
if [ "$ENVIRONMENT" = "staging" ]; then
  API_SERVICE="cpa-api-staging"
  WEB_SERVICE="cpa-web-staging"
  QUEUE_NAME="inkwise-ingest-staging"
  TASK_TOKEN_SECRET="INKWISE_TASKS_TOKEN_STAGING"
  MIGRATION_JOB_NAME="cpa-migrate-staging"
  API_MIN_INSTANCES=0
  WEB_MIN_INSTANCES=0
fi

BACKEND_IMAGE="${ARTIFACT_REGISTRY_URL}/backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${ARTIFACT_REGISTRY_URL}/frontend:${IMAGE_TAG}"

# Full backend secret set (Secret Manager name -> in-container target), applied
# to cpa-api on both create and every update. The mounted FIREBASE_SERVICE_ACCOUNT
# secret backs GOOGLE_APPLICATION_CREDENTIALS, and CPAA_BUNDLE_SECRET decrypts the
# AccountingClaw image at activation time.
BACKEND_BASE_SECRETS="DATABASE_URL=DATABASE_URL:latest"
BACKEND_BASE_SECRETS+=",GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest"
BACKEND_BASE_SECRETS+=",GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest"
BACKEND_BASE_SECRETS+=",GOOGLE_REDIRECT_URI=GOOGLE_REDIRECT_URI:latest"
BACKEND_BASE_SECRETS+=",APP_SECRET=APP_SECRET:latest"
BACKEND_BASE_SECRETS+=",GEMINI_API_KEY=GEMINI_API_KEY:latest"
BACKEND_BASE_SECRETS+=",STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest"
BACKEND_BASE_SECRETS+=",STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest"
BACKEND_BASE_SECRETS+=",ENCRYPTION_KEY=ENCRYPTION_KEY:latest"
BACKEND_BASE_SECRETS+=",ADMIN_TOKEN=ADMIN_TOKEN:latest"
BACKEND_BASE_SECRETS+=",TASK_EXTRACT_URL=TASK_EXTRACT_URL:latest"
BACKEND_BASE_SECRETS+=",TASK_IO_URL=TASK_IO_URL:latest"
BACKEND_BASE_SECRETS+=",TASK_AUTOMATION_URL=TASK_AUTOMATION_URL:latest"
BACKEND_BASE_SECRETS+=",TASK_MAINTENANCE_URL=TASK_MAINTENANCE_URL:latest"
BACKEND_BASE_SECRETS+=",ESIGN_SIGNING_CERT_PEM=${ESIGN_SIGNING_CERT_SECRET}:latest"
BACKEND_BASE_SECRETS+=",OPENCONNECTOR_URL=OPENCONNECTOR_URL:latest"
BACKEND_BASE_SECRETS+=",OPENCONNECTOR_ADMIN_TOKEN=OPENCONNECTOR_ADMIN_TOKEN:latest"
BACKEND_BASE_SECRETS+=",OPENCONNECTOR_RUNTIME_TOKEN=OPENCONNECTOR_RUNTIME_TOKEN:latest"
BACKEND_BASE_SECRETS+=",${BUNDLE_SECRET_NAME}=${BUNDLE_SECRET_NAME}:latest"
BACKEND_BASE_SECRETS+=",${FIREBASE_CREDENTIALS_PATH}=FIREBASE_SERVICE_ACCOUNT:latest"

# Full backend base env set (non-secret), applied to cpa-api on create + update.
BACKEND_BASE_ENV=(
  "ENVIRONMENT=${ENVIRONMENT}"
  "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"
  "GOOGLE_CLOUD_PROJECT_ID=${PROJECT_ID}"
  "GCS_BUCKET_NAME=${GCS_BUCKET_NAME}"
  "GCS_TEMP_FOLDER=${GCS_TEMP_FOLDER}"
  "GOOGLE_APPLICATION_CREDENTIALS=${FIREBASE_CREDENTIALS_PATH}"
  "ESIGN_KMS_SIGNING_KEY_VERSION=${ESIGN_KMS_SIGNING_KEY_VERSION}"
  "ESIGN_AI_FIELD_PLACEMENT_MODEL=${ESIGN_AI_FIELD_PLACEMENT_MODEL:-gemini-3.8-flash}"
  "ESIGN_AI_FIELD_PLACEMENT_LOCATION=${ESIGN_AI_FIELD_PLACEMENT_LOCATION:-global}"
  "EXTRACTION_ENQUEUE_BATCH_SIZE=${EXTRACTION_ENQUEUE_BATCH_SIZE}"
  "EXTRACTION_ENQUEUE_BATCH_DELAY_SECONDS=${EXTRACTION_ENQUEUE_BATCH_DELAY_SECONDS}"
  "EXTRACTION_ENQUEUE_MAX_DELAY_SECONDS=${EXTRACTION_ENQUEUE_MAX_DELAY_SECONDS}"
  "EXTRACTION_ENQUEUE_JITTER_SECONDS=${EXTRACTION_ENQUEUE_JITTER_SECONDS}"
  "FORM_FILL_OUTPUT_ENQUEUE_BATCH_SIZE=${FORM_FILL_OUTPUT_ENQUEUE_BATCH_SIZE}"
  "FORM_FILL_OUTPUT_ENQUEUE_BATCH_DELAY_SECONDS=${FORM_FILL_OUTPUT_ENQUEUE_BATCH_DELAY_SECONDS}"
  "FORM_FILL_OUTPUT_ENQUEUE_MAX_DELAY_SECONDS=${FORM_FILL_OUTPUT_ENQUEUE_MAX_DELAY_SECONDS}"
  "FORM_FILL_OUTPUT_ENQUEUE_JITTER_SECONDS=${FORM_FILL_OUTPUT_ENQUEUE_JITTER_SECONDS}"
  "DB_POOL_SIZE=${DB_POOL_SIZE}"
  "DB_MAX_OVERFLOW=${DB_MAX_OVERFLOW}"
  "DB_POOL_TIMEOUT_SECONDS=${DB_POOL_TIMEOUT_SECONDS}"
  "DB_POOL_RECYCLE_SECONDS=${DB_POOL_RECYCLE_SECONDS}"
  "STRIPE_PAGE_METER_EVENT_NAME=${STRIPE_PAGE_METER_EVENT_NAME:-cpaautomation_pages}"
  "STRIPE_TOKEN_METER_EVENT_NAME=${STRIPE_TOKEN_METER_EVENT_NAME:-cpaautomation_tokens}"
  "CPAA_BUNDLE_GCS_BUCKET=${CPAA_BUNDLE_GCS_BUCKET}"
  "CPAA_BUNDLE_GCS_OBJECT=${CPAA_BUNDLE_GCS_OBJECT}"
  "CPAA_LEGALCLAW_BUNDLE_GCS_OBJECT=${CPAA_LEGALCLAW_BUNDLE_GCS_OBJECT}"
  "CLAW_UDA_MCP_ENABLED=${CLAW_UDA_MCP_ENABLED}"
  "HOSTED_CLAW_KMS_KEY=${HOSTED_CLAW_KMS_KEY}"
  "HOSTED_CLAW_ARTIFACT_BUCKET=${HOSTED_CLAW_ARTIFACT_BUCKET}"
  "HOSTED_CLAW_PUBSUB_TOPIC=${HOSTED_CLAW_PUBSUB_TOPIC}"
  "HOSTED_CLAW_WORKER_SERVICE_ACCOUNT=${HOSTED_CLAW_WORKER_SERVICE_ACCOUNT}"
)

section "Checking prerequisites"
command_exists gcloud || die "gcloud CLI not found"
if [ "$SKIP_BUILD" = false ]; then
  command_exists docker || die "docker not found"
fi
if [ "$DEPLOY_BACKEND" = true ]; then
  command_exists openssl || die "openssl not found"
fi

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  die "Not logged into gcloud. Run 'gcloud auth login' first."
fi

gcloud config set project "$PROJECT_ID" >/dev/null
REQUIRED_APIS=(run.googleapis.com artifactregistry.googleapis.com)
if [ "$DEPLOY_BACKEND" = true ]; then
  REQUIRED_APIS+=(cloudtasks.googleapis.com cloudscheduler.googleapis.com logging.googleapis.com monitoring.googleapis.com secretmanager.googleapis.com)
fi
gcloud services enable "${REQUIRED_APIS[@]}" >/dev/null
ok "Using project ${PROJECT_ID} in ${REGION} (${ENVIRONMENT}); target=${DEPLOY_TARGET}"

if [ "$SKIP_BUILD" = false ]; then
  section "Building images"
  BUILD_IMAGE_ARGS=("$IMAGE_TAG")
  if [ "$DEPLOY_TARGET" = "frontend" ]; then
    BUILD_IMAGE_ARGS+=(--frontend-only)
  elif [ "$DEPLOY_TARGET" = "backend" ]; then
    BUILD_IMAGE_ARGS+=(--backend-only)
  fi
  if [ "$WITH_TAXATLAS" = true ]; then
    BUILD_IMAGE_ARGS+=(--with-taxatlas)
  fi
  "$ROOT_DIR/scripts/build-images.sh" "${BUILD_IMAGE_ARGS[@]}"
else
  warn "Skipping image build"
fi

if [ "$DEPLOY_BACKEND" = true ]; then
  section "Preparing infrastructure (secrets + queue)"
  ensure_bundle_secret
  ensure_legalclaw_bundle_secret
  # Mount the LegalClaw bundle secret only once it exists, so deploys keep
  # working before LegalClaw is rolled out.
  if secret_exists "$LEGALCLAW_BUNDLE_SECRET_NAME"; then
    BACKEND_BASE_SECRETS+=",${LEGALCLAW_BUNDLE_SECRET_NAME}=${LEGALCLAW_BUNDLE_SECRET_NAME}:latest"
  fi
  if [ "$HOSTED_CLAW_ENABLED" = true ]; then
    for hosted_secret in SLACK_CLIENT_ID SLACK_CLIENT_SECRET SLACK_SIGNING_SECRET; do
      secret_exists "$hosted_secret" || die "Hosted Claw is enabled but Secret Manager secret ${hosted_secret} is missing"
      BACKEND_BASE_SECRETS+=",${hosted_secret}=${hosted_secret}:latest"
    done
  fi
  ensure_secret_value "$TASK_TOKEN_SECRET" "$ROTATE_TASK_TOKEN"
  ensure_queue "$QUEUE_NAME"
fi

section "Ensuring base services exist"
ensure_base_services "$API_SERVICE" "$WEB_SERVICE"

API_URL=""
WEB_URL=""
if [ "$DEPLOY_BACKEND" = true ]; then
  API_URL="$(gcloud run services describe "$API_SERVICE" --region="$REGION" --format='value(status.url)')"
  ok "API URL: ${API_URL}"
fi
if [ "$DEPLOY_FRONTEND" = true ]; then
  WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region="$REGION" --format='value(status.url)')"
  ok "Web URL: ${WEB_URL}"
fi

section "Deploying services (${DEPLOY_TARGET})"
if [ "$DEPLOY_BACKEND" = true ]; then
  deploy_api "$API_SERVICE" "$BACKEND_IMAGE" "$API_URL" "$QUEUE_NAME" "$TASK_TOKEN_SECRET"
fi
if [ "$DEPLOY_FRONTEND" = true ]; then
  deploy_web "$WEB_SERVICE" "$FRONTEND_IMAGE"
fi

if [ "$DEPLOY_BACKEND" = true ]; then
  if [ "$SKIP_MIGRATE" = false ]; then
    section "Running database migrations"
    run_migrations "$BACKEND_IMAGE" "$MIGRATION_JOB_NAME"
  else
    warn "Skipping Alembic migrations"
  fi
fi

# TaxAtlas jobs are opt-in and use the shared schema, so must follow the
# migration. Never point a staging deploy at production schedules/job names.
if [ "$WITH_TAXATLAS" = true ] && [ "$DEPLOY_BACKEND" = true ] && [ "$ENVIRONMENT" = production ]; then
  section "Deploying TaxAtlas jobs and schedules"
  PROJECT_ID="$PROJECT_ID" REGION="$REGION" SERVICE_ACCOUNT="$SERVICE_ACCOUNT" \
    CLOUD_SQL_INSTANCE="$CLOUD_SQL_INSTANCE" VPC_CONNECTOR="$VPC_CONNECTOR" \
    TAXATLAS_API_IMAGE="$BACKEND_IMAGE" \
    TAXATLAS_BROWSER_IMAGE="${ARTIFACT_REGISTRY_URL}/taxatlas-browser:${IMAGE_TAG}" \
    "$ROOT_DIR/scripts/deploy-taxatlas-jobs.sh"
elif [ "$DEPLOY_BACKEND" = true ] && [ "$ENVIRONMENT" = production ]; then
  info "Skipping TaxAtlas jobs, seed, schedules, and monitoring (opt in with --with-taxatlas)"
fi

if [ "$DEPLOY_BACKEND" = true ] && [ "$HOSTED_CLAW_ENABLED" = true ]; then
  section "Configuring Hosted Claw cron dispatcher"
  scheduler_name="hosted-claw-cron-dispatch"
  scheduler_args=(
    --location="$REGION"
    --schedule="* * * * *"
    --time-zone="UTC"
    --uri="${API_URL}/api/internal/hosted-claw/cron/dispatch-due"
    --http-method=POST
    --message-body="{}"
    --oidc-service-account-email="$HOSTED_CLAW_WORKER_SERVICE_ACCOUNT"
    --oidc-token-audience="$API_URL"
    --attempt-deadline=60s
  )
  if gcloud scheduler jobs describe "$scheduler_name" --location="$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$scheduler_name" "${scheduler_args[@]}" \
      --update-headers="Content-Type=application/json" >/dev/null
  else
    gcloud scheduler jobs create http "$scheduler_name" "${scheduler_args[@]}" \
      --headers="Content-Type=application/json" >/dev/null
  fi
  ok "Hosted Claw minute dispatcher configured (feature=${HOSTED_CLAW_CRON_ENABLED})"
  info "Configuring Hosted Claw cron monitoring..."
  PROJECT_ID="$PROJECT_ID" \
    HOSTED_CLAW_NOTIFICATION_CHANNELS="${HOSTED_CLAW_NOTIFICATION_CHANNELS:-}" \
    "$ROOT_DIR/infra/hosted-claw/configure-cron-monitoring.sh"
fi

section "Deployment complete"
ok "CPAAutomation ${DEPLOY_TARGET} services deployed."
echo -e "${BLUE}Next checks:${NC}"
if [ "$DEPLOY_BACKEND" = true ]; then
  echo -e "- API docs: ${API_URL}/api/docs"
  echo -e "- Queue: ${QUEUE_NAME}"
  echo -e "- Migration job: ${MIGRATION_JOB_NAME}"
fi
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo -e "- Inkwise UI: ${WEB_URL}/dashboard/inkwise"
fi

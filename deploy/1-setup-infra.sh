#!/usr/bin/env bash
# Step 1 of 3: create the Google Cloud resources Agent Studio needs.
#
#   bash deploy/1-setup-infra.sh
#
# Safe to re-run: anything that already exists is left as it is. In particular an
# existing AUTH_SECRET is never replaced, because it encrypts stored connection secrets.
#
# Permission changes your account is not allowed to make are written to
# deploy/admin-grants-step1.sh for a project admin to run; everything else carries on.
#
# Optional environment variables, read only when a secret does not exist yet:
#   ANTHROPIC_API_KEY  otherwise you are prompted for it
#   AUTH_SECRET        e.g. the value from an existing install, so its saved connections still decrypt
source "$(dirname "$0")/lib.sh"

require_project
reset_admin_file
ME="$(gcloud config get-value account 2>/dev/null)"
info "Project ${PROJECT_ID} (${PROJECT_NUMBER}), region ${REGION}, running as ${ME}"

step "Enabling APIs (takes a minute the first time)"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  iap.googleapis.com \
  iam.googleapis.com

step "Artifact Registry repository '${REPO}'"
if gcloud artifacts repositories describe "${REPO}" --location="${REGION}" >/dev/null 2>&1; then
  info "exists"
else
  gcloud artifacts repositories create "${REPO}" --repository-format=docker --location="${REGION}" \
    --description="Agent Studio images"
fi

step "Permissions for Cloud Build (it builds the container image)"
BUILD_SA="$(gcloud builds get-default-service-account --format='value(serviceAccountEmail)' 2>/dev/null || true)"
BUILD_SA="${BUILD_SA##*/}"
if [ -z "${BUILD_SA}" ]; then
  BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi
if [[ "${BUILD_SA}" == *@cloudbuild.gserviceaccount.com ]]; then
  info "builds run as the legacy Cloud Build account ${BUILD_SA}, which already has what it needs"
else
  info "builds run as ${BUILD_SA}"
  for role in roles/cloudbuild.builds.builder roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
    ensure_project_role "serviceAccount:${BUILD_SA}" "${role}" "Cloud Build account ${role}"
  done
fi

if [ -n "${RUNTIME_SA_EMAIL}" ]; then
  step "Runtime service account ${RUNTIME_SA} (existing, from RUNTIME_SA_EMAIL)"
  gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1 \
    || die "Service account ${RUNTIME_SA} (RUNTIME_SA_EMAIL in deploy/config.sh) does not exist."
  if printf '%s\n' "$(project_roles_of "serviceAccount:${RUNTIME_SA}")" | grep -qxE 'roles/editor|roles/owner'; then
    warn "${RUNTIME_SA} has Editor/Owner on the whole project; the app runs with that access."
  fi
  info "assumed: you may already deploy as this account (as your other Cloud Run services do)"
else
  step "Runtime service account '${RUNTIME_SA_NAME}'"
  if gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1; then
    info "exists"
  else
    try_grant "create the service account the app runs as" \
      gcloud iam service-accounts create "${RUNTIME_SA_NAME}" --display-name="Agent Studio runtime"
    gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1 && sleep 10
  fi
  try_grant "${ME} may deploy Cloud Run as ${RUNTIME_SA_NAME} (roles/iam.serviceAccountUser)" \
    gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
      --member="user:${ME}" --role=roles/iam.serviceAccountUser
fi
ensure_project_role "serviceAccount:${RUNTIME_SA}" roles/cloudsql.client "app may connect to Cloud SQL (roles/cloudsql.client)"

step "Storage bucket gs://${BUCKET} (uploaded documents and generated files)"
if gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  info "exists"
else
  gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" \
    --uniform-bucket-level-access --public-access-prevention
fi
try_grant "app may read and write the bucket (roles/storage.objectAdmin)" \
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${RUNTIME_SA}" --role=roles/storage.objectAdmin

step "Cloud SQL for PostgreSQL 16 instance '${SQL_INSTANCE}' (creating one takes 5-10 minutes)"
if gcloud sql instances describe "${SQL_INSTANCE}" >/dev/null 2>&1; then
  info "exists"
else
  gcloud sql instances create "${SQL_INSTANCE}" \
    --database-version=POSTGRES_16 \
    --edition=ENTERPRISE \
    --tier="${SQL_TIER}" \
    --region="${REGION}" \
    --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=20:00 --enable-point-in-time-recovery \
    --deletion-protection
fi
if gcloud sql databases describe "${DB_NAME}" --instance="${SQL_INSTANCE}" >/dev/null 2>&1; then
  info "database ${DB_NAME} exists"
else
  gcloud sql databases create "${DB_NAME}" --instance="${SQL_INSTANCE}"
fi
CONN="$(sql_connection_name)"
info "connection name ${CONN}"

step "Secrets in Secret Manager"
if secret_exists DATABASE_URL; then
  info "DATABASE_URL exists"
else
  DB_PASS="$(openssl rand -hex 24)"
  gcloud sql users set-password postgres --instance="${SQL_INSTANCE}" --password="${DB_PASS}" >/dev/null
  printf '%s' "postgresql://postgres:${DB_PASS}@localhost/${DB_NAME}?host=/cloudsql/${CONN}" | create_secret DATABASE_URL
  unset DB_PASS
fi

if secret_exists AUTH_SECRET; then
  info "AUTH_SECRET exists (kept: it encrypts stored connection secrets)"
else
  if [ -n "${AUTH_SECRET:-}" ]; then
    printf '%s' "${AUTH_SECRET}" | create_secret AUTH_SECRET
  else
    openssl rand -hex 32 | tr -d '\n' | create_secret AUTH_SECRET
  fi
fi

if secret_exists CRON_SECRET; then
  info "CRON_SECRET exists"
else
  openssl rand -hex 32 | tr -d '\n' | create_secret CRON_SECRET
fi

if secret_exists ANTHROPIC_API_KEY; then
  info "ANTHROPIC_API_KEY exists"
else
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    read -rsp "    Paste your Anthropic API key (input hidden) and press Enter: " ANTHROPIC_API_KEY
    echo
  fi
  [ -n "${ANTHROPIC_API_KEY}" ] || die "No Anthropic API key given."
  printf '%s' "${ANTHROPIC_API_KEY}" | create_secret ANTHROPIC_API_KEY
fi

# Access to each secret, rather than to every secret in the project. Skipped where the
# account can already read them: project-wide Secret Accessor, Editor or Owner.
RUNTIME_ROLES="$(project_roles_of "serviceAccount:${RUNTIME_SA}")"
for s in DATABASE_URL ANTHROPIC_API_KEY AUTH_SECRET CRON_SECRET; do
  if printf '%s\n' "${RUNTIME_ROLES}" | grep -qxE 'roles/secretmanager.secretAccessor|roles/secretmanager.admin|roles/editor|roles/owner'; then
    info "ok: app may read secret ${s} (project-wide role)"
  elif gcloud secrets get-iam-policy "${s}" --format=json 2>/dev/null | grep -q "serviceAccount:${RUNTIME_SA}"; then
    info "ok: app may read secret ${s}"
  else
    try_grant "app may read secret ${s}" \
      gcloud secrets add-iam-policy-binding "${s}" \
        --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor
  fi
done

if [ "${NEEDS_ADMIN}" = "1" ]; then
  report_admin_file
  exit 0
fi

step "Done"
info "Next, once only, to load the existing data:  bash deploy/2-import-data.sh"
info "Then build and deploy the app:                 bash deploy/3-deploy-app.sh"

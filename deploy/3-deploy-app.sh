#!/usr/bin/env bash
# Step 3 of 3: build the image, update the database schema, and deploy to Cloud Run.
#
#   bash deploy/3-deploy-app.sh
#
# Re-run it whenever the code changes; each run builds and ships a new revision.
source "$(dirname "$0")/lib.sh"

require_project
cd "${ROOT_DIR}"

case "${ACCESS_MODE}" in
  iap)    [ -n "${IAP_MEMBERS}" ] || die "ACCESS_MODE=iap needs IAP_MEMBERS in deploy/config.sh (e.g. domain:yourcompany.com)." ;;
  public) ;;
  *)      die "ACCESS_MODE must be 'iap' or 'public', not '${ACCESS_MODE}'." ;;
esac

CONN="$(sql_connection_name)" || die "Cloud SQL instance not found. Run deploy/1-setup-infra.sh first."
gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1 \
  || die "Service account ${RUNTIME_SA} does not exist yet. If step 1 wrote deploy/admin-grants-step1.sh, an admin must run it first; then re-run step 1."
APP_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

# IMAGE_TAG=<tag> reuses an image that is already built (e.g. after a failed deploy),
# instead of building again. Tags: gcloud artifacts docker tags list ${IMAGE}
if [ -n "${IMAGE_TAG:-}" ]; then
  TAG="${IMAGE_TAG}"
  gcloud artifacts docker images describe "${IMAGE}:${TAG}" >/dev/null 2>&1 \
    || die "Image ${IMAGE}:${TAG} not found. List tags with: gcloud artifacts docker tags list ${IMAGE}"
  step "Reusing the existing image ${IMAGE}:${TAG} (no build)"
else
  TAG="$(date -u +%Y%m%d-%H%M%S)"
  step "Building the image ${IMAGE}:${TAG} with Cloud Build (5-10 minutes)"
  gcloud builds submit --tag "${IMAGE}:${TAG}" .
  info "To redeploy this exact image later without rebuilding: IMAGE_TAG=${TAG} bash deploy/3-deploy-app.sh"
fi

# How the four runtime values reach the job and the service (see SECRETS_MODE in config.sh).
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
JOB_EXISTS=0; gcloud run jobs describe "${MIGRATE_JOB}" --region="${REGION}" >/dev/null 2>&1 && JOB_EXISTS=1
SERVICE_EXISTS=0; gcloud run services describe "${SERVICE}" --region="${REGION}" >/dev/null 2>&1 && SERVICE_EXISTS=1
if [ "${SECRETS_MODE}" = "env" ]; then
  step "Runtime values as environment variables (SECRETS_MODE=env)"
  load_plain_secrets
  write_env_yaml "${TMP_DIR}/job.yaml" "DATABASE_URL=${DATABASE_URL}"
  write_env_yaml "${TMP_DIR}/service.yaml" \
    "DATABASE_URL=${DATABASE_URL}" "AUTH_SECRET=${AUTH_SECRET}" "CRON_SECRET=${CRON_SECRET}" \
    "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" "STORAGE_DIR=/data/storage" "APP_URL=${APP_URL}"
  JOB_VALUE_ARGS=(--env-vars-file="${TMP_DIR}/job.yaml")
  SERVICE_VALUE_ARGS=(--env-vars-file="${TMP_DIR}/service.yaml")
else
  JOB_VALUE_ARGS=(--set-secrets=DATABASE_URL=DATABASE_URL:latest)
  SERVICE_VALUE_ARGS=(
    --set-secrets=DATABASE_URL=DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,AUTH_SECRET=AUTH_SECRET:latest,CRON_SECRET=CRON_SECRET:latest
    --set-env-vars="STORAGE_DIR=/data/storage,APP_URL=${APP_URL}"
  )
fi

# If an existing job or service holds the values the other way (for example from an
# earlier deploy with the other SECRETS_MODE), clear that first: gcloud refuses to switch
# a variable between a secret reference and a plain value in a single command.
WANT_KIND="secret"; [ "${SECRETS_MODE}" = "env" ] && WANT_KIND="plain"
if [ "${JOB_EXISTS}" = "1" ] && value_kinds jobs "${MIGRATE_JOB}" | grep -qvx "${WANT_KIND}"; then
  info "the schema job holds its values the other way; recreating it (it keeps no state)"
  gcloud run jobs delete "${MIGRATE_JOB}" --region="${REGION}" --quiet
fi
if [ "${SERVICE_EXISTS}" = "1" ] && value_kinds services "${SERVICE}" | grep -qvx "${WANT_KIND}"; then
  info "the service holds its values the other way; clearing them before the deploy"
  if [ "${WANT_KIND}" = "plain" ]; then
    gcloud run services update "${SERVICE}" --region="${REGION}" --clear-secrets
  else
    gcloud run services update "${SERVICE}" --region="${REGION}" \
      --remove-env-vars="$(IFS=,; echo "${APP_SECRETS[*]}")"
  fi
fi

step "Updating the database schema (db/schema.sql, idempotent)"
if ! gcloud run jobs deploy "${MIGRATE_JOB}" \
  --image="${IMAGE}:${TAG}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA}" \
  --set-cloudsql-instances="${CONN}" \
  "${JOB_VALUE_ARGS[@]}" \
  --command=node --args=scripts/setup-db.mjs \
  --max-retries=0 --task-timeout=600; then
  if [ "${SECRETS_MODE}" = "secret-manager" ]; then
    warn "If the error above says 'Permission denied on secret', ${RUNTIME_SA} may not read Secret Manager."
    warn "Either an admin grants it roles/secretmanager.secretAccessor on the four secrets,"
    warn "or add  SECRETS_MODE=\"env\"  to deploy/config.sh and re-run. See deploy/README.md."
  fi
  exit 1
fi
gcloud run jobs execute "${MIGRATE_JOB}" --region="${REGION}" --wait

step "Deploying the Cloud Run service '${SERVICE}'"
DEPLOY_ARGS=(
  --image="${IMAGE}:${TAG}"
  --region="${REGION}"
  --service-account="${RUNTIME_SA}"
  --port=3000
  --execution-environment=gen2
  --cpu="${CPU}" --memory="${MEMORY}"
  # Agent runs execute inside the request, so allow the maximum.
  --timeout=3600
  # The scheduler runs inside the container and needs CPU between requests.
  --no-cpu-throttling
  --min-instances="${MIN_INSTANCES}" --max-instances="${MAX_INSTANCES}"
  --concurrency=40
  --set-cloudsql-instances="${CONN}"
  "${SERVICE_VALUE_ARGS[@]}"
)
if [ "${SERVICE_EXISTS}" = "0" ]; then
  # First deploy only: mount the bucket where the app writes files. Later deploys keep it.
  DEPLOY_ARGS+=(
    --add-volume="name=storage,type=cloud-storage,bucket=${BUCKET},mount-options=uid=1001;gid=1001"
    --add-volume-mount="volume=storage,mount-path=/data/storage"
  )
fi
if [ "${ACCESS_MODE}" = "public" ]; then
  DEPLOY_ARGS+=(--allow-unauthenticated)
else
  DEPLOY_ARGS+=(--no-allow-unauthenticated)
fi
gcloud run deploy "${SERVICE}" "${DEPLOY_ARGS[@]}"

if [ "${ACCESS_MODE}" = "iap" ]; then
  step "Putting Identity-Aware Proxy in front of the service"
  reset_admin_file
  gcloud beta services identity create --service=iap.googleapis.com --project="${PROJECT_ID}" >/dev/null 2>&1 || true
  try_grant "IAP may call the Cloud Run service (roles/run.invoker)" \
    gcloud run services add-iam-policy-binding "${SERVICE}" --region="${REGION}" \
      --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
      --role=roles/run.invoker
  try_grant "turn on IAP for the Cloud Run service" \
    gcloud beta run services update "${SERVICE}" --region="${REGION}" --iap
  IFS=',' read -ra MEMBERS <<< "${IAP_MEMBERS}"
  for m in "${MEMBERS[@]}"; do
    m="$(echo "${m}" | xargs)"
    [ -n "${m}" ] || continue
    try_grant "${m} may open the app (roles/iap.httpsResourceAccessor)" \
      gcloud beta iap web add-iam-policy-binding \
        --resource-type=cloud-run --service="${SERVICE}" --region="${REGION}" \
        --member="${m}" --role=roles/iap.httpsResourceAccessor
  done
  if [ "${NEEDS_ADMIN}" = "1" ]; then
    warn "The app is deployed, but nobody can open it until these access steps are done."
    report_admin_file
    info "If turning on IAP itself fails even for an admin, see 'IAP could not be enabled' in deploy/README.md."
    exit 1
  fi
else
  warn "ACCESS_MODE=public: anyone on the internet can reach this app. See 'Security' in deploy/README.md."
fi

step "Checking the app"
sleep 5
if [ "${ACCESS_MODE}" = "public" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "${APP_URL}/api/health" || true)"
  info "health check: HTTP ${code} (200 means the app is up and reached the database)"
else
  info "The app is behind IAP, so an anonymous health check is refused by design."
  info "Recent log lines:"
  gcloud run services logs read "${SERVICE}" --region="${REGION}" --limit=15 2>/dev/null | sed 's/^/      /' || true
fi

step "Deployed"
info "Open: ${APP_URL}"
info "Sign in with your Google account (IAP), then with your Agent Studio email and password."

#!/usr/bin/env bash
# Step 2 of 3: load a PostgreSQL dump into Cloud SQL. Run this ONCE.
#
#   bash deploy/2-import-data.sh [path/to/dump.sql]
#
# Default dump: deploy/data/agent_studio_backup.sql (a plain-SQL pg_dump).
#
# The dump drops and recreates every Agent Studio table, so importing replaces whatever
# the Cloud SQL database holds. A marker in the bucket records that an import happened;
# a second import is refused unless you set FORCE=1.
source "$(dirname "$0")/lib.sh"

DUMP="${1:-${DEPLOY_DIR}/data/agent_studio_backup.sql}"
MARKER="gs://${BUCKET}/_import/.imported"
STAGED="gs://${BUCKET}/_import/agent_studio.sql"

require_project
[ -f "${DUMP}" ] || die "Dump not found: ${DUMP}"
gcloud sql instances describe "${SQL_INSTANCE}" >/dev/null 2>&1 \
  || die "Cloud SQL instance ${SQL_INSTANCE} not found. Run deploy/1-setup-infra.sh first."

if gcloud storage objects describe "${MARKER}" >/dev/null 2>&1 && [ "${FORCE:-0}" != "1" ]; then
  die "Data was already imported ($(gcloud storage cat "${MARKER}")). Re-importing would overwrite everything created since. To do it anyway: FORCE=1 bash deploy/2-import-data.sh"
fi

warn "This REPLACES all data in database '${DB_NAME}' on Cloud SQL instance '${SQL_INSTANCE}'"
warn "with the contents of ${DUMP}."
read -rp "    Type 'import' to continue: " answer
[ "${answer}" = "import" ] || die "Cancelled."

step "Preparing the dump"
CLEAN="$(mktemp --suffix=.sql)"
trap 'rm -f "${CLEAN}"' EXIT
# \restrict / \unrestrict are psql-only safety lines that Cloud SQL's importer does not
# understand. COMMENT ON EXTENSION needs superuser, which Cloud SQL does not grant.
# Neither affects the data.
sed -e '/^[\]restrict /d' -e '/^[\]unrestrict /d' -e '/^COMMENT ON EXTENSION /d' "${DUMP}" > "${CLEAN}"
info "$(grep -c '^COPY ' "${CLEAN}") tables of data, $(du -h "${CLEAN}" | cut -f1)"

step "Uploading to the bucket"
gcloud storage cp "${CLEAN}" "${STAGED}"

step "Letting Cloud SQL read it"
reset_admin_file
SQL_SA="$(gcloud sql instances describe "${SQL_INSTANCE}" --format='value(serviceAccountEmailAddress)')"
try_grant "Cloud SQL may read the dump from the bucket (roles/storage.objectViewer)" \
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${SQL_SA}" --role=roles/storage.objectViewer
if [ "${NEEDS_ADMIN}" = "1" ]; then
  gcloud storage rm "${STAGED}" >/dev/null 2>&1 || true
  report_admin_file
  exit 1
fi

step "Importing (a few minutes)"
gcloud sql import sql "${SQL_INSTANCE}" "${STAGED}" --database="${DB_NAME}" --user=postgres --quiet

step "Cleaning up"
gcloud storage rm "${STAGED}"
printf 'imported %s on %s\n' "$(basename "${DUMP}")" "$(date -u +%Y-%m-%dT%H:%MZ)" | gcloud storage cp - "${MARKER}"

step "Done"
info "Next: bash deploy/3-deploy-app.sh"

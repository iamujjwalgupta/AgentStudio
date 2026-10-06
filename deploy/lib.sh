# Shared helpers for the deploy scripts. Sourced, not run.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
# shellcheck source=config.sh
source "${DEPLOY_DIR}/config.sh"

# Settings added after the first release, so an older config.sh keeps working.
RUNTIME_SA_EMAIL="${RUNTIME_SA_EMAIL:-}"
if [ -n "${RUNTIME_SA_EMAIL}" ]; then
  RUNTIME_SA="${RUNTIME_SA_EMAIL}"
fi
SECRETS_MODE="${SECRETS_MODE:-secret-manager}"
case "${SECRETS_MODE}" in
  secret-manager|env) ;;
  *) printf 'SECRETS_MODE must be "secret-manager" or "env", not "%s"\n' "${SECRETS_MODE}" >&2; exit 1 ;;
esac

APP_SECRETS=(DATABASE_URL AUTH_SECRET CRON_SECRET ANTHROPIC_API_KEY)

# SECRETS_MODE=env: the four values, kept in a private file in your Cloud Shell home
# (outside the project folder, so it is never uploaded to Cloud Build). Each value is
# taken from that file, else read from Secret Manager, else generated (or asked for).
load_plain_secrets() {
  local file="${HOME}/.agent-studio-${PROJECT_ID}.env" name value changed=0
  # shellcheck disable=SC1090
  [ -f "${file}" ] && source "${file}"
  for name in "${APP_SECRETS[@]}"; do
    value="${!name:-}"
    if [ -z "${value}" ]; then
      value="$(gcloud secrets versions access latest --secret="${name}" 2>/dev/null || true)"
    fi
    if [ -z "${value}" ]; then
      changed=1
      case "${name}" in
        DATABASE_URL)
          local pass conn
          pass="$(openssl rand -hex 24)"
          conn="$(sql_connection_name)"
          info "setting a new password for the Cloud SQL 'postgres' user"
          gcloud sql users set-password postgres --instance="${SQL_INSTANCE}" --password="${pass}" >/dev/null
          value="postgresql://postgres:${pass}@localhost/${DB_NAME}?host=/cloudsql/${conn}"
          ;;
        AUTH_SECRET|CRON_SECRET)
          value="$(openssl rand -hex 32)"
          ;;
        ANTHROPIC_API_KEY)
          read -rsp "    Paste your Anthropic API key (input hidden) and press Enter: " value
          echo
          [ -n "${value}" ] || die "No Anthropic API key given."
          ;;
      esac
      # Keep Secret Manager in step where allowed, for a later switch back to it.
      printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=- >/dev/null 2>&1 || true
    fi
    printf -v "${name}" '%s' "${value}"
  done
  if [ "${changed}" = "1" ] || [ ! -f "${file}" ]; then
    ( umask 077
      { echo "# Agent Studio runtime values for ${PROJECT_ID}. Private: do not share or commit."
        for name in "${APP_SECRETS[@]}"; do printf '%s=%q\n' "${name}" "${!name}"; done
      } > "${file}" )
    info "values saved to ${file} (readable only by you)"
  fi
}

# value_kinds jobs|services NAME : how the four runtime values are currently set on an
# existing Cloud Run job or service. Prints "secret" and/or "plain", or nothing.
# gcloud cannot switch a variable between the two kinds in one command, so a switch of
# SECRETS_MODE has to clear the old kind first.
value_kinds() {
  local json keys="DATABASE_URL|AUTH_SECRET|CRON_SECRET|ANTHROPIC_API_KEY"
  # Whitespace removed so the checks do not depend on how gcloud pretty-prints JSON.
  json="$(gcloud run "$1" describe "$2" --region="${REGION}" --format=json 2>/dev/null | tr -d ' \t\r\n' || true)"
  [ -n "${json}" ] || return 0
  if grep -qE "\"name\":\"(${keys})\",\"valueFrom\":|\"valueFrom\":\{[^}]*\"secretKeyRef\"" <<<"${json}"; then
    echo secret
  fi
  # "value": followed directly by a colon, so "valueFrom" does not count as plain.
  if grep -qE "\"name\":\"(${keys})\",\"value\":|\"value\":\"[^\"]*\",\"name\":\"(${keys})\"" <<<"${json}"; then
    echo plain
  fi
}

# write_env_yaml FILE KEY=VALUE... : an --env-vars-file for gcloud run.
write_env_yaml() {
  local file="$1" kv; shift
  ( umask 077; : > "${file}" )
  for kv in "$@"; do
    local v="${kv#*=}"
    v="${v//\\/\\\\}"; v="${v//\"/\\\"}"
    printf '%s: "%s"\n' "${kv%%=*}" "${v}" >> "${file}"
  done
}

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

require_project() {
  [ -n "${PROJECT_ID}" ] || die "PROJECT_ID is empty. Set it in deploy/config.sh or run: gcloud config set project <id>"
  local err
  if ! PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/tmp/agent-studio-gcloud-err)" \
     || [ -z "${PROJECT_NUMBER}" ]; then
    err="$(cat /tmp/agent-studio-gcloud-err 2>/dev/null)"
    printf '%s\n' "${err}" | sed 's/^/    /' >&2
    if echo "${err}" | grep -qiE 'reauth|credential|login|token|authorize'; then
      die "gcloud needs you to sign in again. Run: gcloud auth login   (or click Authorize if Cloud Shell asks), then re-run this script."
    fi
    die "Could not read project '${PROJECT_ID}' (error above). Check PROJECT_ID in deploy/config.sh and that you are signed in as the right account: gcloud config list"
  fi
  rm -f /tmp/agent-studio-gcloud-err
  gcloud config set project "${PROJECT_ID}" >/dev/null 2>&1
  export PROJECT_NUMBER
}

sql_connection_name() {
  gcloud sql instances describe "${SQL_INSTANCE}" --format='value(connectionName)'
}

secret_exists() { gcloud secrets describe "$1" >/dev/null 2>&1; }

# create_secret NAME  (value read from stdin)
create_secret() {
  gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  info "created secret $1"
}

add_project_role() {
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="$1" --role="$2" --condition=None >/dev/null
}

# --- Permission changes a project admin may have to make ---------------------
# In a company-managed project the person deploying often may not change IAM.
# Rather than stopping, a script tries each grant and, if it is refused, writes the
# exact command to a file for someone with Project IAM Admin to run. Each step has its
# own file (admin-grants-step1.sh, -step2.sh, -step3.sh), so one step never erases the
# list another step produced.
ADMIN_FILE="${DEPLOY_DIR}/admin-grants-step$(basename "$0" | cut -c1).sh"
NEEDS_ADMIN=0

reset_admin_file() { rm -f "${ADMIN_FILE}"; NEEDS_ADMIN=0; }

# try_grant "what it is for" command args...
try_grant() {
  local why="$1"; shift
  local err
  if err="$("$@" 2>&1 >/dev/null)"; then
    info "ok: ${why}"
    return 0
  fi
  if [ ! -f "${ADMIN_FILE}" ]; then
    {
      echo '#!/usr/bin/env bash'
      echo "# Permission changes for Agent Studio in project ${PROJECT_ID}."
      echo '# To be run once, in Cloud Shell, by someone with Owner or Project IAM Admin'
      echo '# (plus Service Account Admin / IAP Admin for the service-account and IAP lines).'
      echo 'set -euo pipefail'
      echo "gcloud config set project ${PROJECT_ID}"
    } > "${ADMIN_FILE}"
  fi
  { echo; echo "# ${why}"; printf '%q ' "$@"; echo; } >> "${ADMIN_FILE}"
  NEEDS_ADMIN=1
  warn "not permitted: ${why} (queued for an admin)"
  info "  $(echo "${err}" | grep -m1 -E 'ERROR|denied|permission' | cut -c1-200)"
  return 0
}

# Roles a member holds directly on the project (not via groups). Empty if the policy
# cannot be read.
project_roles_of() {
  gcloud projects get-iam-policy "${PROJECT_ID}" --flatten=bindings \
    --filter="bindings.members:$1" --format='value(bindings.role)' 2>/dev/null || true
}

# ensure_project_role MEMBER ROLE "why": skip if MEMBER already has ROLE, Editor or Owner
# on the project; otherwise try to grant it (queued for an admin if refused).
ensure_project_role() {
  local member="$1" role="$2" why="$3" held
  held="$(project_roles_of "${member}")"
  if printf '%s\n' "${held}" | grep -qxE "${role}|roles/editor|roles/owner"; then
    info "ok: ${why} (already has $(printf '%s\n' "${held}" | grep -xE "${role}|roles/editor|roles/owner" | head -1))"
    return 0
  fi
  try_grant "${why}" \
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" --member="${member}" --role="${role}" --condition=None
}

report_admin_file() {
  [ "${NEEDS_ADMIN}" = "1" ] || return 0
  echo
  warn "Some permission changes need a project admin. They are all in:"
  warn "    ${ADMIN_FILE}"
  info "Send that file to your GCP admin and ask them to run:  bash $(basename "${ADMIN_FILE}")"
  info "(or print it with:  cat ${ADMIN_FILE})"
  info "After they have, re-run this script. It skips everything that already exists."
}

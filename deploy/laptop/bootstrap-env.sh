#!/usr/bin/env bash
# =============================================================================
# MMS Platform — Laptop staging .env bootstrap (Git Bash on Windows 11)
#
# Generates a fresh .env from .env.production, fills in real secrets, and
# wires the operator's domain into FRONTEND_URL + CORS_ALLOWED_ORIGINS.
#
# Run from the repo root:
#   bash deploy/laptop/bootstrap-env.sh           # refuses to clobber existing .env
#   bash deploy/laptop/bootstrap-env.sh --force   # overwrite existing .env
#
# Requires: openssl (ships with Git for Windows), bash, sed.
# Tested on: Git Bash (mintty) on Windows 11.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

TEMPLATE=".env.production"
TARGET=".env"
FORCE=0

for arg in "$@"; do
    case "${arg}" in
        --force) FORCE=1 ;;
        -h|--help)
            printf 'Usage: bash deploy/laptop/bootstrap-env.sh [--force]\n'
            exit 0
            ;;
        *)
            printf 'ERROR: unknown argument: %s\n' "${arg}" >&2
            exit 1
            ;;
    esac
done

# ── 1. Pre-flight ──────────────────────────────────────────────────────────
if [ ! -f "${TEMPLATE}" ]; then
    printf 'ERROR: %s not found at repo root.\n' "${TEMPLATE}" >&2
    printf '       Cannot generate %s without the production template.\n' "${TARGET}" >&2
    exit 1
fi

if [ -f "${TARGET}" ] && [ "${FORCE}" -ne 1 ]; then
    printf 'ERROR: %s already exists.\n' "${TARGET}" >&2
    printf '       Refusing to overwrite. Re-run with --force to replace it.\n' >&2
    printf '       (Existing secrets will be lost — back them up first if needed.)\n' >&2
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    printf 'ERROR: openssl not found on PATH.\n' >&2
    printf '       On Windows, install Git for Windows — it bundles openssl.\n' >&2
    exit 1
fi

# ── 2. Prompt for the operator's domain ────────────────────────────────────
DOMAIN=""
while [ -z "${DOMAIN}" ]; do
    # Use Bash's read built-in (works in Git Bash). Prompt to stderr so any
    # accidental capture of stdout stays clean.
    read -r -p "Enter your domain (e.g. mms.example.com): " DOMAIN
    DOMAIN="$(printf '%s' "${DOMAIN}" | tr -d '[:space:]')"

    if [ -z "${DOMAIN}" ]; then
        printf 'Domain cannot be empty. Try again.\n' >&2
        continue
    fi

    # Loose domain shape check: at least one dot, valid label characters.
    if ! printf '%s' "${DOMAIN}" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'; then
        printf 'That does not look like a domain (need something like mms.example.com). Try again.\n' >&2
        DOMAIN=""
    fi
done

STAGING_URL="https://staging.${DOMAIN}"

# ── 3. Generate secrets ────────────────────────────────────────────────────
JWT_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
# Strip =, /, + so the password is safe inside a postgres URL without escaping.
POSTGRES_PASSWORD="$(openssl rand -base64 24 | tr -d '=/+')"

# ── 4. Seed .env from the production template ──────────────────────────────
cp "${TEMPLATE}" "${TARGET}"

# ── 5. Substitute placeholders. We anchor every replacement to a key= prefix
#       so we never accidentally rewrite comments or unrelated lines.
# sed -i works in Git Bash with GNU sed (shipped with Git for Windows).

# JWT_SECRET — replace whatever follows the = on the JWT_SECRET line.
sed -i -E "s|^JWT_SECRET=.*$|JWT_SECRET=${JWT_SECRET}|" "${TARGET}"

# ENCRYPTION_KEY
sed -i -E "s|^ENCRYPTION_KEY=.*$|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" "${TARGET}"

# POSTGRES_PASSWORD line
sed -i -E "s|^POSTGRES_PASSWORD=.*$|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" "${TARGET}"

# DATABASE_URL: rewrite only the password segment of the postgres URL.
# Pattern: postgresql://<user>:<password>@<host>...   ->   keep user/host, swap password.
# Use | as the sed delimiter to avoid clashing with / in the URL.
sed -i -E "s|^(DATABASE_URL=postgresql://[^:]+:)[^@]+(@.*)$|\1${POSTGRES_PASSWORD}\2|" "${TARGET}"

# FRONTEND_URL — full replace with https://staging.<domain>.
sed -i -E "s|^FRONTEND_URL=.*$|FRONTEND_URL=${STAGING_URL}|" "${TARGET}"

# CORS_ALLOWED_ORIGINS — single origin, the public staging URL.
sed -i -E "s|^CORS_ALLOWED_ORIGINS=.*$|CORS_ALLOWED_ORIGINS=${STAGING_URL}|" "${TARGET}"

# NODE_ENV — force production for this stack.
sed -i -E "s|^NODE_ENV=.*$|NODE_ENV=production|" "${TARGET}"

# ── 6. Sanity: confirm each key really got rewritten. If a key wasn't in the
#       template, the substitution above is a no-op and the operator would
#       silently end up without a value. Fail loudly instead.
require_set() {
    local key="$1"
    if ! grep -Eq "^${key}=.+$" "${TARGET}"; then
        printf 'ERROR: %s is missing from %s after substitution.\n' "${key}" "${TARGET}" >&2
        printf '       Add a "%s=" placeholder line to %s and re-run.\n' "${key}" "${TEMPLATE}" >&2
        exit 1
    fi
}
require_set JWT_SECRET
require_set ENCRYPTION_KEY
require_set POSTGRES_PASSWORD
require_set FRONTEND_URL
require_set CORS_ALLOWED_ORIGINS
require_set NODE_ENV

# ── 7. Lock down file permissions (chmod is mostly cosmetic on NTFS, but it
#       documents intent and matters if the repo is later cloned to Linux).
chmod 600 "${TARGET}" 2>/dev/null || true

# ── 8. Summary (secrets redacted to first 4 chars). ────────────────────────
redact() {
    local v="$1"
    printf '%s...' "${v:0:4}"
}

printf '\n'
printf '=== .env generated successfully ===\n'
printf '  Target file:        %s\n' "${TARGET}"
printf '  NODE_ENV:           production\n'
printf '  FRONTEND_URL:       %s\n' "${STAGING_URL}"
printf '  CORS_ALLOWED:       %s\n' "${STAGING_URL}"
printf '  JWT_SECRET:         %s (64 hex chars)\n' "$(redact "${JWT_SECRET}")"
printf '  ENCRYPTION_KEY:     %s (64 hex chars)\n' "$(redact "${ENCRYPTION_KEY}")"
printf '  POSTGRES_PASSWORD:  %s (set, %d chars)\n' "$(redact "${POSTGRES_PASSWORD}")" "${#POSTGRES_PASSWORD}"
printf '  DATABASE_URL:       password segment rewritten\n'
printf '\n'
printf 'REMINDER: MTN/Airtel/SendGrid creds remain placeholders — wire them up\n'
printf '          via the uganda-compliance specialist when ready.\n'
printf '\n'
printf 'Next: docker login ghcr.io && docker compose -f docker-compose.production.yml pull && ./deploy/deploy.sh\n'

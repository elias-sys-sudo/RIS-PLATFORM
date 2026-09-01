#!/usr/bin/env bash
# =============================================================================
# get-cert.sh — first-time Let's Encrypt cert acquisition for RIS staging.
#
# Run this ONCE on the Lightsail box after:
#   1. DNS for $DOMAIN points to the box's public IP
#   2. Lightsail firewall has port 80 AND port 443 open to 0.0.0.0/0
#   3. docker compose stack has been brought up (so volumes exist)
#
# What it does:
#   - Stops the nginx container so port 80 is free
#   - Runs certbot in --standalone mode (binds :80 itself), requests cert
#   - Writes cert files into the `letsencrypt` named volume at
#     /etc/letsencrypt/live/$DOMAIN/{fullchain,privkey,chain}.pem
#   - Restarts nginx, which now has the cert files it needs to bring up
#     its :443 server block
#
# After this runs once, the cert auto-renews via the long-lived certbot
# container in docker-compose.production.yml. You should never need to
# re-run get-cert.sh unless something catastrophic happens to the volume.
#
# Idempotent: if a cert already exists for $DOMAIN it just exits 0 with
# a notice. Use --force to re-issue (rate-limited by Let's Encrypt!).
# =============================================================================

set -euo pipefail

# ── Defaults — override via env or CLI ──────────────────────────────────────
DOMAIN="${STAGING_DOMAIN:-staging.raphaintegrated.com}"
EMAIL="${LETSENCRYPT_EMAIL:-markelijah086@gmail.com}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
FORCE_FLAG=""
STAGING_FLAG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)   DOMAIN="$2"; shift 2 ;;
        --email)    EMAIL="$2"; shift 2 ;;
        --force)    FORCE_FLAG="--force-renewal"; shift ;;
        # Use Let's Encrypt's STAGING environment (untrusted certs) for testing
        # — this avoids burning the 50-issuances-per-domain-per-week rate
        # limit while iterating. Pass --le-staging if you're debugging.
        --le-staging) STAGING_FLAG="--staging"; shift ;;
        -h|--help)
            echo "Usage: $0 [--domain <fqdn>] [--email <addr>] [--force] [--le-staging]"
            exit 0
            ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── Pretty logging ──────────────────────────────────────────────────────────
log()  { echo -e "\e[0;34m[TLS]\e[0m $*"; }
ok()   { echo -e "\e[0;32m[OK]\e[0m  $*"; }
err()  { echo -e "\e[0;31m[ERR]\e[0m $*" >&2; }
warn() { echo -e "\e[0;33m[WARN]\e[0m $*"; }

# ── Pre-flight ──────────────────────────────────────────────────────────────
[[ -z "$DOMAIN" ]] && { err "DOMAIN is empty"; exit 1; }
[[ -z "$EMAIL"  ]] && { err "EMAIL is empty";  exit 1; }
[[ ! -f "$COMPOSE_FILE" ]] && { err "Compose file not found: $COMPOSE_FILE"; exit 1; }

# Confirm DNS first — avoids waiting 60s for ACME to time out on bad DNS.
log "Resolving $DOMAIN..."
if ! getent hosts "$DOMAIN" > /dev/null 2>&1; then
    err "DNS lookup for $DOMAIN failed. Fix DNS before running this."
    exit 1
fi
RESOLVED_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}')"
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "?")"
ok "$DOMAIN → $RESOLVED_IP  (this box: $PUBLIC_IP)"
if [[ "$RESOLVED_IP" != "$PUBLIC_IP" && "$PUBLIC_IP" != "?" ]]; then
    warn "DNS does not point to this box. Let's Encrypt validation will fail."
    warn "Continue anyway? [y/N]"
    read -r ANS; [[ "$ANS" != "y" ]] && exit 1
fi

# ── Existing cert? ──────────────────────────────────────────────────────────
EXISTING_CERT=$(docker run --rm -v ris-platform_letsencrypt:/etc/letsencrypt:ro alpine:3 \
    test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && echo "yes" || echo "no")
if [[ "$EXISTING_CERT" == "yes" && -z "$FORCE_FLAG" ]]; then
    ok "Cert already exists for $DOMAIN. Use --force to re-issue."
    exit 0
fi

# ── Stop nginx so certbot can bind :80 ──────────────────────────────────────
log "Stopping nginx to free port 80..."
docker compose -f "$COMPOSE_FILE" stop nginx || true

# ── Request the cert ────────────────────────────────────────────────────────
log "Requesting cert for $DOMAIN via Let's Encrypt..."
docker run --rm \
    -p 80:80 \
    -v ris-platform_letsencrypt:/etc/letsencrypt \
    -v ris-platform_certbot_webroot:/var/www/certbot \
    certbot/certbot:v2.11.0 \
    certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --no-eff-email \
    -d "$DOMAIN" \
    $FORCE_FLAG $STAGING_FLAG

ok "Cert issued. Files:"
docker run --rm -v ris-platform_letsencrypt:/etc/letsencrypt:ro alpine:3 \
    ls -la "/etc/letsencrypt/live/$DOMAIN/" || true

# ── Bring nginx back up (force-recreate so it picks up new cert files) ─────
# Without --force-recreate, compose sees nothing changed in the service spec
# and skips the restart — leaving nginx serving the old self-signed dummy.
log "Starting nginx with --force-recreate so it loads the new cert..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate nginx

# ── Verify ──────────────────────────────────────────────────────────────────
sleep 5
log "Probing https://$DOMAIN/api/health..."
if curl -fsS --max-time 10 "https://$DOMAIN/api/health" > /tmp/health.json; then
    ok "HTTPS working. Health response:"
    cat /tmp/health.json
    echo ""
else
    err "HTTPS probe failed. Check 'docker logs ris-nginx' for cert load errors."
    exit 1
fi

ok "=================================================="
ok "  TLS bootstrap complete."
ok "  Cert auto-renews via the certbot sidecar every 12h."
ok "  Renewal triggers when cert is < 30 days from expiry."
ok "=================================================="

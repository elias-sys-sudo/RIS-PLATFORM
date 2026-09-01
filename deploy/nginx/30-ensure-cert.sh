#!/bin/sh
# =============================================================================
# 10-ensure-cert.sh — runs inside the nginx container at startup, BEFORE
# nginx itself starts.
#
# The nginx:1.27-alpine entrypoint executes every /docker-entrypoint.d/*.sh
# in alphanumeric order before exec'ing nginx. Naming this 10-* puts it
# after the 20-envsubst-on-templates.sh (which expands ${STAGING_DOMAIN} in
# /etc/nginx/conf.d/default.conf) — wait, lexical ordering: 10 sorts before
# 20. We want envsubst FIRST. So:
#
#   20-envsubst-on-templates.sh  (built-in, expands templates)
#   30-ensure-cert.sh            (this script, name accordingly)
#
# Renaming to 30-* below to land AFTER envsubst.
#
# Purpose: solve the chicken-and-egg between nginx (needs cert files to boot)
# and certbot (needs nginx serving on :80 to complete ACME). If no real cert
# exists yet, write a self-signed dummy at the same path so nginx can start;
# operator then runs deploy/get-cert.sh which acquires the real Let's Encrypt
# cert and recreates the nginx container to pick it up.
#
# Idempotent: skips entirely if a real cert already exists.
# =============================================================================

set -eu

DOMAIN="${STAGING_DOMAIN:-staging.raphaintegrated.com}"
LIVE_DIR="/etc/letsencrypt/live/${DOMAIN}"
FULLCHAIN="${LIVE_DIR}/fullchain.pem"
PRIVKEY="${LIVE_DIR}/privkey.pem"
CHAIN="${LIVE_DIR}/chain.pem"

if [ -f "$FULLCHAIN" ] && [ -f "$PRIVKEY" ]; then
    echo "[ensure-cert] Real cert found at $LIVE_DIR — skipping dummy generation."
    exit 0
fi

echo "[ensure-cert] No cert at $LIVE_DIR — generating self-signed placeholder."
echo "[ensure-cert] Run deploy/get-cert.sh after first start to replace with Let's Encrypt cert."

mkdir -p "$LIVE_DIR"

# 4096-bit RSA, 1-day validity. Short on purpose: if we forget to replace it,
# nginx will start refusing TLS handshakes within 24h and someone will notice.
# CN matches the domain so browsers show a clear "untrusted CA" warning rather
# than "wrong host" — easier to diagnose during the bootstrap window.
apk add --no-cache --quiet openssl > /dev/null 2>&1 || true

openssl req -x509 -nodes -newkey rsa:4096 \
    -days 1 \
    -keyout "$PRIVKEY" \
    -out "$FULLCHAIN" \
    -subj "/CN=${DOMAIN}/O=RIS Platform/OU=Bootstrap Placeholder" \
    2>/dev/null

# OCSP stapling needs chain.pem; just symlink fullchain so nginx doesn't error.
ln -sf fullchain.pem "$CHAIN"

chmod 644 "$FULLCHAIN" "$CHAIN"
chmod 600 "$PRIVKEY"

echo "[ensure-cert] Self-signed placeholder written. Expires in 24h."
echo "[ensure-cert] Browsers will show an 'untrusted CA' warning until get-cert.sh runs."

#!/bin/bash
# =============================================================================
# MMS Platform — Environment Setup Script
# Generates secure secrets and configures .env for production
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "[MMS] Setting up production environment..."

# Copy template
cp .env.production .env

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+')

# Detect server IP
SERVER_IP=$(ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "localhost")

# Apply to .env
sed -i "s|POSTGRES_PASSWORD=CHANGE_ME_USE_A_STRONG_PASSWORD|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|g" .env
sed -i "s|postgresql://mms_user:CHANGE_ME_USE_A_STRONG_PASSWORD@|postgresql://mms_user:${POSTGRES_PASSWORD}@|g" .env
sed -i "s|JWT_SECRET=GENERATE_64_HEX_CHARS_HERE|JWT_SECRET=${JWT_SECRET}|g" .env
sed -i "s|ENCRYPTION_KEY=GENERATE_64_HEX_CHARS_HERE|ENCRYPTION_KEY=${ENCRYPTION_KEY}|g" .env
sed -i "s|YOUR_ORACLE_SERVER_IP|${SERVER_IP}|g" .env

echo ""
echo "=== Environment configured ==="
echo "  Server IP:          ${SERVER_IP}"
echo "  JWT_SECRET:         ${JWT_SECRET:0:8}...(${#JWT_SECRET} chars)"
echo "  ENCRYPTION_KEY:     ${ENCRYPTION_KEY:0:8}...(${#ENCRYPTION_KEY} chars)"
echo "  POSTGRES_PASSWORD:  set (${#POSTGRES_PASSWORD} chars)"
echo ""
echo "=== API keys still need manual configuration ==="
grep -n "your_production\|SG\.your" .env || echo "  (none — all set)"
echo ""
echo "[MMS] Done. Review .env then run: ./deploy/deploy.sh"

#!/usr/bin/env bash
# =============================================================================
# MMS Platform — Deployment Script (pull-based, images built in CI)
#
# Usage:
#   ./deploy/deploy.sh              # Full deploy (pull + migrate + start)
#   ./deploy/deploy.sh --migrate    # Run migrations only
#   ./deploy/deploy.sh --pull       # Pull latest images only
#   ./deploy/deploy.sh --restart    # Restart services without re-pulling
#   ./deploy/deploy.sh --stop       # Stop all services
#   ./deploy/deploy.sh --status     # Show service status
#   ./deploy/deploy.sh --logs       # Tail all logs
#
# Environment variables (usually set by Stage 7 of .github/workflows/deploy.yml):
#   API_IMAGE        = ghcr.io/<owner>/ris-platform:sha-<short>
#   FRONTEND_IMAGE   = ghcr.io/<owner>/ris-platform-frontend:sha-<short>
#   (fallback: docker-compose.production.yml uses :latest if unset)
#
# Manual deploys: the caller must `docker login ghcr.io` first (private images).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.production.yml"
ENV_FILE="$PROJECT_DIR/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${BLUE}[MMS]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ── Pre-flight checks ───────────────────────────────────────────────────────

check_prerequisites() {
    log "Running pre-flight checks..."

    if ! command -v docker &>/dev/null; then
        err "Docker is not installed. Install Docker first."
        exit 1
    fi

    if ! docker info &>/dev/null; then
        err "Docker daemon is not running. Start Docker first."
        exit 1
    fi

    if ! docker compose version &>/dev/null; then
        err "Docker Compose V2 is not available. Update Docker."
        exit 1
    fi

    if [ ! -f "$ENV_FILE" ]; then
        err ".env file not found at $ENV_FILE"
        err "Copy .env.production to .env and fill in real values:"
        err "  cp .env.production .env"
        exit 1
    fi

    # Validate critical env vars are not placeholder values
    source "$ENV_FILE"
    local errors=0

    if [[ "${POSTGRES_PASSWORD:-}" == *"CHANGE_ME"* ]] || [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
        err "POSTGRES_PASSWORD is not set or still a placeholder"
        errors=$((errors + 1))
    fi

    if [[ "${JWT_SECRET:-}" == *"GENERATE"* ]] || [[ ${#JWT_SECRET} -lt 64 ]]; then
        err "JWT_SECRET is not set or too short (need 64 hex chars)"
        errors=$((errors + 1))
    fi

    if [[ "${ENCRYPTION_KEY:-}" == *"GENERATE"* ]] || [[ ! "${ENCRYPTION_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
        err "ENCRYPTION_KEY is not set or invalid (need 64 hex chars)"
        errors=$((errors + 1))
    fi

    if [[ "${CORS_ALLOWED_ORIGINS:-}" == *"YOUR_ORACLE"* ]] \
        || [[ "${CORS_ALLOWED_ORIGINS:-}" == *"YOUR_STAGING_HOST"* ]] \
        || [[ "${CORS_ALLOWED_ORIGINS:-}" == *"YOUR_"* ]]; then
        err "CORS_ALLOWED_ORIGINS still contains placeholder — set your server IP/domain"
        errors=$((errors + 1))
    fi

    if [ $errors -gt 0 ]; then
        err "$errors configuration error(s) found. Fix .env before deploying."
        exit 1
    fi

    ok "Pre-flight checks passed"
}

# ── Generate secrets helper ──────────────────────────────────────────────────

generate_secrets() {
    log "Generating secure secrets..."
    echo ""
    echo "  JWT_SECRET=$(openssl rand -hex 32)"
    echo "  ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "  POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+')"
    echo ""
    log "Copy these values into your .env file"
}

# ── Deploy commands ──────────────────────────────────────────────────────────

do_pull() {
    # docker-compose.production.yml uses `build:` for ris-api / ris-frontend /
    # ris-migrate (no `image:` from registry), so `compose pull` is a no-op for
    # those services — it'll only pull the third-party base images (postgres,
    # redis, nginx, certbot). The app images are built locally from the git
    # checkout via do_build below.
    log "Pulling third-party base images (postgres/redis/nginx/certbot)..."
    docker compose -f "$COMPOSE_FILE" pull --ignore-buildable 2>/dev/null || \
        docker compose -f "$COMPOSE_FILE" pull --ignore-pull-failures 2>/dev/null || true
    ok "Base images pulled (buildable services skipped)"
}

do_build() {
    # CRITICAL: this step is REQUIRED on every deploy. Without it, compose
    # uses cached local images that were built when the host was first set
    # up — meaning code changes pulled from git via `git reset --hard` never
    # actually reach the running containers. (Bug observed 2026-05-26: the
    # frontend container ran a 13-day-old bundle while the source tree was
    # current; UI fixes from PRs #43/#45/#48 etc. were invisible until a
    # manual `docker compose build --no-cache` was run on the box.)
    log "Building app images from current source (ris-api, ris-frontend, ris-migrate)..."
    if ! docker compose -f "$COMPOSE_FILE" build --pull ris-api ris-frontend ris-migrate; then
        err "docker compose build failed. Check for syntax errors / missing build args / disk space."
        exit 1
    fi
    ok "App images built"
}

do_migrate() {
    log "Running database migrations (one-shot)..."
    # --rm cleans up the container. The image was just rebuilt in do_build
    # above so it carries the latest migration files baked into /app/dist.
    if docker compose -f "$COMPOSE_FILE" run --rm --no-deps ris-migrate; then
        ok "Migrations completed"
    else
        err "Migration failed"
        exit 1
    fi
}

do_start() {
    log "Starting RIS Platform services..."
    # No --no-build flag: if for any reason an image is missing, compose will
    # build it on the fly rather than failing. In normal operation the images
    # are already built by do_build above; this is a safety net.
    docker compose -f "$COMPOSE_FILE" up -d --remove-orphans \
        ris-postgres ris-redis ris-api ris-frontend nginx
    ok "All services started"
}

do_stop() {
    log "Stopping all services..."
    docker compose -f "$COMPOSE_FILE" down
    ok "All services stopped"
}

do_restart() {
    log "Restarting services..."
    docker compose -f "$COMPOSE_FILE" restart ris-api ris-frontend nginx
    ok "Services restarted"
}

do_status() {
    log "Service status:"
    docker compose -f "$COMPOSE_FILE" ps
    echo ""
    log "Health checks:"
    echo "  API:      $(curl -s http://localhost:4000/health 2>/dev/null || echo 'unreachable')"
    echo "  Nginx:    $(curl -s -o /dev/null -w '%{http_code}' http://localhost/ 2>/dev/null || echo 'unreachable')"
}

do_logs() {
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100
}

do_full_deploy() {
    check_prerequisites
    do_pull
    do_build  # rebuild ris-api / ris-frontend / ris-migrate from current source
    # ris-postgres MUST be healthy (not just started) before migrations.
    # --wait blocks until the container's healthcheck passes (start_period=30s,
    # interval=10s, retries=5). Without --wait, the container goes "Started"
    # in <1s but takes ~10-30s before Postgres actually accepts connections,
    # causing migrations to fail with ECONNREFUSED.
    log "Starting postgres + redis (waiting for healthy)..."
    docker compose -f "$COMPOSE_FILE" up -d --wait ris-postgres ris-redis
    ok "Postgres + Redis are healthy"
    do_migrate
    do_start

    log "Waiting for services to become healthy..."
    sleep 10

    do_status

    echo ""
    ok "============================================"
    ok "  RIS Platform deployed successfully!"
    ok "  Frontend: http://$(hostname -I | awk '{print $1}')"
    ok "  API:      http://$(hostname -I | awk '{print $1}')/health"
    ok "============================================"
}

# ── Backup commands ──────────────────────────────────────────────────────────

do_backup() {
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="$PROJECT_DIR/backups"
    mkdir -p "$backup_dir"

    log "Backing up database..."
    docker compose -f "$COMPOSE_FILE" exec -T ris-postgres \
        pg_dump -U "${POSTGRES_USER:-ris_user}" "${POSTGRES_DB:-ris_production}" \
        | gzip > "$backup_dir/ris_db_${timestamp}.sql.gz"

    ok "Database backup saved to backups/ris_db_${timestamp}.sql.gz"
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-deploy}" in
    --migrate)
        check_prerequisites
        do_migrate
        ;;
    --restart)
        do_restart
        ;;
    --stop)
        do_stop
        ;;
    --status)
        do_status
        ;;
    --logs)
        do_logs
        ;;
    --build)
        check_prerequisites
        do_build
        ;;
    --pull)
        check_prerequisites
        do_pull
        ;;
    --backup)
        do_backup
        ;;
    --generate-secrets)
        generate_secrets
        ;;
    deploy|--deploy)
        do_full_deploy
        ;;
    *)
        echo "Usage: $0 [deploy|--migrate|--restart|--stop|--status|--logs|--build|--backup|--generate-secrets]"
        exit 1
        ;;
esac

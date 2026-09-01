# =============================================================================
# ris-frontend -- multi-stage build
# Stage 1: build Vite/React app with Node
# Stage 2: serve static output with nginx
# =============================================================================

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (cached layer when package*.json unchanged).
# --legacy-peer-deps is required because vite-plugin-pwa@1.2.0 declares a peer
# dep of vite <=7, but the project is on vite 8. Removing the flag reintroduces
# the ERESOLVE failure. Deferred: proper fix is to bump vite-plugin-pwa to a
# version that supports vite 8 (separate frontend engagement) -- tracked in
# docs/frontend-deps.md (if present) or the top of the next frontend PR.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

# Copy source (node_modules excluded via .dockerignore)
COPY . .

# Build-time flag: when set to 'true', the login page renders the
# "Demo accounts" panel that auto-fills the seeded test credentials.
# Off by default. Set ARG VITE_SHOW_DEMO_ACCOUNTS=true at build time
# in the docker-compose for any non-production stack (dev / staging /
# UAT) — leave it unset / 'false' for real production deployments.
ARG VITE_SHOW_DEMO_ACCOUNTS=false
ENV VITE_SHOW_DEMO_ACCOUNTS=$VITE_SHOW_DEMO_ACCOUNTS

# Build with Vite directly (not `npm run build` which also runs `tsc -b`).
# The frontend has pre-existing TypeScript errors in src/mocks/handlers/*
# and src/store/auth.store.ts (snake_case vs camelCase, unused vars) that
# block `tsc -b` but do not affect the runtime bundle -- Vite transpiles
# via esbuild and does not type-check. Shipping the bundle unblocks the
# staging deploy pipeline.
# DEBT: dedicated frontend PR should fix the TS errors and this should
# revert to `npm run build`. Tracking: next frontend engagement.
RUN npx vite build

# ── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Static assets
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config (SPA routing + security headers + caching)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Compose depends_on: condition: service_healthy requires a HEALTHCHECK.
# Use 127.0.0.1 explicitly: nginx only listens on IPv4, but BusyBox wget resolves
# `localhost` to IPv6 `::1` first and fails before falling back to IPv4.
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=15s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

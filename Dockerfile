# =============================================================================
# MMS Platform — Backend API Dockerfile
# Multi-stage build: compile TypeScript → slim production image
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/256MMcode/RIS-Platform"
LABEL org.opencontainers.image.revision="${GIT_SHA}"

WORKDIR /app

# Create non-root user
RUN addgroup -S mms && adduser -S mms -G mms

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Copy migration SQL files into the production image so db:migrate works
COPY src/shared/database/migrations/*.sql ./dist/shared/database/migrations/

# Copy runtime config (sanctions screening list, etc.) — read by services
# at request time via path.resolve('config', '...').
COPY config ./config

# Uploads and EFT output directories (writable by app user)
RUN mkdir -p /app/uploads /app/eft-output /app/logs \
    && chown -R mms:mms /app

USER mms

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

ENV NODE_ENV=production
CMD ["node", "dist/server.js"]

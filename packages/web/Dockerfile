# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f packages/web/Dockerfile .

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# pnpm version comes from "packageManager" in the root package.json
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Copy workspace configuration and package manifests for layer caching
# (the server manifest is needed for the frozen lockfile check, its source is not)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install only the web app and its workspace dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @akilimo/web...

COPY packages/shared ./packages/shared
COPY packages/web ./packages/web

RUN pnpm --filter @akilimo/web build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
# Unprivileged nginx runs as a non-root user and listens on 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ > /dev/null || exit 1

# syntax=docker/dockerfile:1

# Base image; override to pull it from a registry mirror (e.g. a copy on ghcr.io) instead of Docker Hub
ARG NODE_IMAGE=node:24-alpine

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder

# pnpm version comes from "packageManager" in the root package.json
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Copy workspace configuration and package manifests for layer caching
# (the web manifest is needed for the frozen lockfile check, its source is not)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/llm/package.json ./packages/llm/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install only the server and its workspace dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @akilimo/server...

COPY packages/shared ./packages/shared
COPY packages/llm ./packages/llm
COPY packages/server ./packages/server

RUN pnpm --filter @akilimo/server build

# Produce a standalone production node_modules pinned to the lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @akilimo/server deploy --prod --legacy /out

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner

ENV NODE_ENV=production
ENV TRANSPORT=http
ENV PORT=3000
# MCP gateway registry; mount a volume on /app/data to keep it across rebuilds
ENV GATEWAY_DATA_FILE=/app/data/mcp-servers.json

WORKDIR /app

COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/server/dist ./dist
# SQL migrations, applied by the server itself at start-up (no database CLI in the image)
COPY --from=builder --chown=node:node /app/packages/server/drizzle ./drizzle
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# The server applies pending migrations when it connects to the configured database
CMD ["node", "dist/index.cjs"]

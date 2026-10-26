# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# pnpm version comes from "packageManager" in the root package.json
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Copy workspace configuration and package manifests for layer caching
# (the web manifest is needed for the frozen lockfile check, its source is not)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install only the server and its workspace dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @akilimo/server...

COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

RUN pnpm --filter @akilimo/server build

# Produce a standalone production node_modules pinned to the lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @akilimo/server deploy --prod --legacy /out

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

ENV NODE_ENV=production
ENV TRANSPORT=sse
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/server/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["node", "dist/index.cjs"]

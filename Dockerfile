# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./

# Copy all package manifests for caching
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/web ./packages/web

# Build the server package
RUN pnpm --filter @akilimo/server build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy build artifacts from builder
COPY --from=builder /app/packages/server/dist ./dist

# We create a minimal package.json for the runner that doesn't use workspaces
# This prevents pnpm from failing due to the 'workspace:*' dependency
RUN echo '{"name": "akilimo-server-runner", "version": "1.0.0", "dependencies": {"@modelcontextprotocol/sdk": "latest", "axios": "latest", "express": "latest", "cors": "latest", "zod": "latest"}}' > package.json

RUN pnpm install --prod

EXPOSE 3000

ENV TRANSPORT=sse
ENV PORT=3000

CMD ["node", "dist/index.cjs"]

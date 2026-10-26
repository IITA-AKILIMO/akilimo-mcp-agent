# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy manifests first so dependency install is cached when source changes
COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build the server
RUN pnpm build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy only the necessary artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml* ./pnpm-lock.yaml*

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Expose the SSE port
EXPOSE 3000

# Default to SSE transport for docker
ENV TRANSPORT=sse
ENV PORT=3000

CMD ["node", "dist/index.cjs"]

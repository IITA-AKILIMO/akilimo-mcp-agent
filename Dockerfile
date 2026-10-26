FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./


# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Optional override — if provided it wins over apps/portal/.env.production.
# If omitted, Vite reads apps/portal/.env.production automatically.
ARG VITE_API_BASE_URL
RUN [ -z "${VITE_API_BASE_URL}" ] || printf 'VITE_API_BASE_URL=%s\n' "${VITE_API_BASE_URL}" > apps/portal/.env.production.local


# Build
RUN pnpm build

# Expose the SSE port
EXPOSE 3000

# Default to SSE transport for docker
ENV TRANSPORT=sse
ENV PORT=3000

CMD ["node", "dist/index.cjs"]

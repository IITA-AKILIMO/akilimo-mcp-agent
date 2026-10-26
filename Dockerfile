FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Expose the SSE port
EXPOSE 3000

# Default to SSE transport for docker
ENV TRANSPORT=sse
ENV PORT=3000

CMD ["node", "dist/index.js"]

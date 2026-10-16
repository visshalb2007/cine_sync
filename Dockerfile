# Production Dockerfile for CineSync
FROM node:22-slim AS builder

WORKDIR /app

# Install build tools needed for native module compilation (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm ci

COPY server/ ./server/
COPY client/ ./client/
COPY scripts/ ./scripts/

# Build TypeScript and copy static assets
RUN npm run build

# Production runtime stage
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install runtime dependencies for native better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled files and static assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client ./client
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/server/index.js"]

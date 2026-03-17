# Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Build tools for native modules (node-pty)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# Install Claude Code CLI so polecats/mayor can run it
RUN npm install -g @anthropic-ai/claude-code

COPY --from=builder /app/dist ./dist

RUN mkdir -p /data

ENV PORT=3001
ENV DB_URL=file:/data/squansq.db
ENV SQUANSQ_REPO_PATH=/repo
# ANTHROPIC_API_KEY and other secrets are injected at runtime via docker-compose or env — not set here

EXPOSE 3001

# Startup script: configure claude with the API key, then start server
COPY start.sh ./
RUN chmod +x start.sh
CMD ["./start.sh"]

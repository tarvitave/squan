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
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p /data

ENV PORT=3001
ENV DB_URL=file:/data/squansq.db

EXPOSE 3001

CMD ["node", "dist/index.js"]

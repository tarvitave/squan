FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
RUN npm run build

# Serve with nginx
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

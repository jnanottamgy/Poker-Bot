# syntax=docker/dockerfile:1.7
# Johnny's Poker Bot — single image running the game server and serving the
# three web apps. Free and open source end to end (Node.js, PostgreSQL).

FROM node:22-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build --workspace @jpb/player-web --workspace @jpb/admin-dashboard --workspace @jpb/broadcast-display \
 && mkdir -p /app/public \
 && cp -r apps/player-web/dist /app/public/player \
 && cp -r apps/admin-dashboard/dist /app/public/admin \
 && cp -r apps/broadcast-display/dist /app/public/display \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    UV_THREADPOOL_SIZE=16
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
# PID 1 is node itself: main.ts handles SIGTERM/SIGINT gracefully and spawns no children
# (compose adds `init: true` for signal forwarding and reaping anyway).
CMD ["node", "--enable-source-maps", "--import", "tsx", "services/game-server/src/main.ts"]

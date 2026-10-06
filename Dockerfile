# Agent Studio — one image, two entry points (the web app and the scheduler).
#
# Deliberately not a `output: "standalone"` build: the app pulls in pdf-parse,
# mammoth, docx and xlsx at runtime, and a full node_modules avoids the module
# tracing surprises those cause. The image is larger and far more predictable.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next needs to compile; no secrets are required at build time.
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Uploaded documents and generated artifacts live here. Mount a volume on it,
# or they vanish when the container is replaced.
ENV STORAGE_DIR=/data/storage

# Fixed uid/gid so a mounted volume (e.g. a Cloud Storage bucket on Cloud Run) can be
# made writable for this user with uid=1001,gid=1001 mount options.
RUN apk add --no-cache curl \
 && addgroup -S -g 1001 app && adduser -S -u 1001 app -G app \
 && mkdir -p /data/storage && chown -R app:app /data

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=app:app /app/db ./db
COPY --from=build --chown=app:app /app/scripts ./scripts

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# The web app plus the scheduler, which ticks /api/cron on 127.0.0.1. Run as node
# directly (not through npm) so SIGTERM from the platform reaches the launcher.
# For a web-only container use: CMD ["npx", "next", "start"]
CMD ["node", "scripts/with-scheduler.mjs", "start"]

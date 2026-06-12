# syntax=docker/dockerfile:1

# ---- Stage 1: fetch + verify the pinned rclone binary ----
FROM alpine:3.20 AS rclone
ARG RCLONE_VERSION=v1.74.3
ARG TARGETARCH=amd64
RUN apk add --no-cache curl unzip
WORKDIR /tmp
RUN set -eux; \
    ZIP="rclone-${RCLONE_VERSION}-linux-${TARGETARCH}.zip"; \
    BASE="https://downloads.rclone.org/${RCLONE_VERSION}"; \
    curl -fsSL "${BASE}/${ZIP}" -o rclone.zip; \
    curl -fsSL "${BASE}/SHA256SUMS" -o SHA256SUMS; \
    expected="$(grep "  ${ZIP}\$" SHA256SUMS | awk '{print $1}')"; \
    echo "${expected}  rclone.zip" | sha256sum -c -; \
    unzip -q rclone.zip; \
    mv "rclone-${RCLONE_VERSION}-linux-${TARGETARCH}/rclone" /usr/local/bin/rclone; \
    chmod +x /usr/local/bin/rclone

# ---- Stage 2: build the web SPA and the server ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm --workspace web run build
RUN npm --workspace server run build

# ---- Stage 3: runtime ----
FROM node:20-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash curl unzip ca-certificates fuse3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Production server deps only. Both workspace package.json files are copied so
# npm can resolve the workspace graph; --workspace server installs just its deps.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev

# Built artifacts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# Updater script + pinned baseline binary
COPY scripts/fetch-rclone.sh scripts/fetch-rclone.sh
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

# NOTE: RCLONE_BINARY is intentionally NOT set, so the resolver prefers a
# self-updated /config/bin/rclone, falling back to the baseline on PATH.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    RCLONE_GUI_CONFIG_DIR=/config \
    WEB_ROOT=/app/web/dist \
    RCLONE_FETCH_SCRIPT=/app/scripts/fetch-rclone.sh

VOLUME ["/config"]
EXPOSE 3000
CMD ["node", "server/dist/index.js"]

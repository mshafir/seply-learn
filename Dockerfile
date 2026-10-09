# The self-host image (spec §2.10; WP-6.2): the Node entry (apps/server-node)
# serving the built SPA, the API, /mcp and the live rooms on one port.
#
#   docker build -t seply-learn .
#   docker compose up        # app + Postgres: docker-compose.yml, docs/self-host.md
#
# The build stage installs the workspace, builds the SPA and bundles the
# server into one ES module (apps/server-node/scripts/bundle.ts), so the
# image is Node, that file, the migrations and the SPA: no node_modules.

# The base for both stages (hadolint's DL3006 can't see the tag through the ARG).
ARG NODE_IMAGE=node:24-alpine

# The bundle and the SPA are plain JS, CSS and HTML, so this stage runs on the
# builder's platform even for another target (no emulated install for arm64).
# hadolint ignore=DL3006
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
ENV CI=1 PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
# Dependencies first, cached until the lockfile changes. pnpm is the version
# package.json's packageManager names.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN corepack enable && corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
RUN pnpm --filter web build && pnpm --filter @seply/server-node bundle

# hadolint ignore=DL3006
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    BLOB_DIR=/data/blobs
WORKDIR /app
COPY --from=build /app/apps/server-node/dist/ /app/
COPY --from=build /app/packages/server/drizzle/ /app/drizzle/
COPY --from=build /app/apps/web/dist/ /app/web/
COPY LICENSE /app/LICENSE
# The data volume (blobs, and optionally a PMTiles extract) belongs to the
# unprivileged `node` user the server runs as.
RUN mkdir -p /data/blobs /data/tiles && chown -R node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# `serve` (the default) migrates on start unless MIGRATE_ON_START=0;
# `migrate` applies migrations and exits. Exit code 78: a configuration error.
ENTRYPOINT ["node", "/app/main.mjs"]
CMD ["serve"]
LABEL org.opencontainers.image.title="Seply Learn" \
      org.opencontainers.image.description="Seply Learn, self-hosted: the Node entry with the web app" \
      org.opencontainers.image.source="https://github.com/mshafir/seply-learn" \
      org.opencontainers.image.licenses="MIT"

#!/usr/bin/env bash
# The self-host smoke test (WP-6.2; CI's compose-smoke job): builds the image
# with docker compose from this checkout, starts it on a throwaway project
# and env, waits for it to be healthy, then runs apps/web/e2e/compose (sign
# up through the UI, import a fixture, start a build that reaches the model
# call; with --tiles, the Map View on a PMTiles extract) and, with --s3,
# checks the Source files landed in MinIO's bucket. Tears everything down
# (volumes too) unless KEEP=1.
#
#   scripts/compose-smoke.sh [--s3] [--tiles] [--no-build]
#
# The instance key points at a model server that isn't there
# (OPENAI_COMPATIBLE_BASE_URL), so the build fails at its first model call
# and nothing is spent. Set SMOKE_AI to a line such as
# ANTHROPIC_API_KEY=sk-ant-not-real (and SMOKE_MODEL_ERROR to the error to
# expect) to have a provider refuse the key instead.
# Needs Docker with compose v2.20+, and pnpm with apps/web's Playwright.
set -euo pipefail

cd "$(dirname "$0")/.."
s3=0 tiles=0 build=--build
for arg in "$@"; do
  case "$arg" in
    --s3) s3=1 ;;
    --tiles) tiles=1 ;;
    --no-build) build= ;;
    *) echo "usage: $0 [--s3] [--tiles] [--no-build]" >&2; exit 2 ;;
  esac
done

port=${SMOKE_PORT:-3123}
work=$(mktemp -d)
env="$work/smoke.env"
export COMPOSE_PROJECT_NAME=seply-smoke
export SEPLY_ENV_FILE="$env" SEPLY_PORT="$port" SEPLY_TILES_DIR="$work/tiles"
export SEPLY_IMAGE=${SEPLY_IMAGE:-seply-learn:smoke}
compose() { docker compose --env-file "$env" "$@"; }

{
  echo "BETTER_AUTH_URL=http://localhost:$port"
  echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  if [ -n "${SMOKE_AI:-}" ]; then
    echo "$SMOKE_AI"
  else
    # Nothing listens on port 9 in the app's container.
    echo "OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:9/v1"
    for stage in SKIM CURATOR WRITER; do echo "AI_MODEL_$stage=smoke-model"; done
  fi
  if [ "$s3" = 1 ]; then
    echo "COMPOSE_PROFILES=s3"
    echo "S3_BUCKET=seply-smoke"
    echo "S3_ENDPOINT=http://minio:9000"
    echo "S3_ACCESS_KEY_ID=seply"
    echo "S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)"
  fi
  if [ "$tiles" = 1 ]; then
    echo "MAP_TILES_FILE=/data/tiles/basemap.pmtiles"
  fi
} > "$env"
mkdir -p "$work/tiles"
# Natural Earth land and borders in the Protomaps schema, cut to the Alps
# (docs/ops/basemap-tiles.md): a stand-in for a real extract.
[ "$tiles" = 1 ] && cp packages/views/harness/public/tiles/alps-test.pmtiles "$work/tiles/basemap.pmtiles"

cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    echo "--- docker compose ps / logs"
    compose ps -a || true
    compose logs --no-color --tail 200 || true
  fi
  if [ "${KEEP:-0}" = 1 ]; then
    echo "KEEP=1: left running (project $COMPOSE_PROJECT_NAME, env $env)"
  else
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
  fi
  exit "$status"
}
trap cleanup EXIT

echo "--- docker compose up $build"
start=$(date +%s)
compose up -d $build --wait --wait-timeout 300
echo "healthy after $(( $(date +%s) - start ))s"
docker image ls "$SEPLY_IMAGE" --format 'image {{.Repository}}:{{.Tag}}: {{.Size}}'
compose ps -a --format '{{.Service}}: {{.Status}}'
curl -sf "http://localhost:$port/api/health"
echo

echo "--- e2e/compose"
COMPOSE_URL="http://localhost:$port" \
  SMOKE_MODEL_ERROR="${SMOKE_MODEL_ERROR:-connect|fetch failed|ECONNREFUSED|Cannot connect}" \
  pnpm --filter web exec playwright test -c playwright.compose.config.ts

if [ "$s3" = 1 ]; then
  echo "--- the bucket"
  listing=$(compose exec -T minio sh -c \
    'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc ls -r local/seply-smoke')
  echo "$listing"
  echo "$listing" | grep -q "sources/.*/raw" || { echo "no Source files in the bucket" >&2; exit 1; }
  [ -z "$(compose exec -T app sh -c 'ls -A /data/blobs')" ] || { echo "blobs went to the volume, not the bucket" >&2; exit 1; }
fi
echo "--- compose smoke passed"

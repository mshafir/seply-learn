# Self-hosting Seply Learn

Seply Learn runs on your own machine or server as one container (the app: web UI, API, MCP and live editing on one port) plus Postgres, with Docker Compose. Source files go to a volume, or to an S3-compatible bucket such as the bundled MinIO. Everything is configured with environment variables in one `.env` file.

Spec: [02-architecture.md §2.10](spec/v1/02-architecture.md#210-deployment). Every variable, with its default: [`apps/server-node/README.md`](../apps/server-node/README.md#environment). Every variable, commented, ready to fill in: [`.env.example`](../.env.example).

- [Quick start](#quick-start)
- [AI keys](#ai-keys)
- [Sign-in](#sign-in)
- [Email](#email)
- [Source files: volume, S3 or MinIO](#source-files-volume-s3-or-minio)
- [Map tiles](#map-tiles)
- [Running it on a server](#running-it-on-a-server)
- [Backups](#backups)
- [Upgrades and migrations](#upgrades-and-migrations)
- [Troubleshooting](#troubleshooting)

## Quick start

You need Docker with Compose v2.20 or later (`docker compose version`), about 1 GB of disk for the images, and an AI key (see [AI keys](#ai-keys)).

```sh
git clone https://github.com/mshafir/seply-learn.git
cd seply-learn
cp .env.example .env
```

Edit `.env` and fill in the three required values at the top, and one AI key:

```sh
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<the output of: openssl rand -base64 32>
POSTGRES_PASSWORD=<the output of: openssl rand -hex 24>
ANTHROPIC_API_KEY=sk-ant-…   # or another key: see "AI keys"
```

Then start it:

```sh
docker compose up -d
docker compose ps          # wait for app to be "healthy" (about a minute the first time)
```

The first `up` builds the image from the checkout (a few minutes). Open <http://localhost:3000>, choose **Create an account**, and you're in. From the Library you can **Import** an Expedition file (try `packages/domain/fixtures/compute.json`) or press **New** to build one from a chat, files or a prompt.

**Without the repository:** a release publishes the image as `ghcr.io/mshafir/seply-learn`. Download `docker-compose.yml` and `.env.example` from the release's tag, set `SEPLY_IMAGE=ghcr.io/mshafir/seply-learn:<version>` in `.env`, and run `docker compose pull app && docker compose up -d`. (Compose only builds when the image isn't there.)

What's running:

| Service | What | Data |
|---|---|---|
| `app` | The Seply Learn image on port 3000 (`SEPLY_PORT` on the host) | the `data` volume: Source files (`/data/blobs`) |
| `db` | Postgres 17 | the `pgdata` volume |
| `minio`, `minio-bucket` | Only with the `s3` profile: see [Source files](#source-files-volume-s3-or-minio) | the `minio` volume |

The app applies database migrations when it starts. It checks its whole configuration first: if something is missing or wrong, it stops with every problem listed (`docker compose logs app`) and exit code 78.

## AI keys

Building an Expedition, growing it and writing articles call a language model. `AI_KEY_MODE` decides who pays:

- **`instance`** (the default): one key, yours, serves everyone on the instance. Set exactly one of the keys below; if you set several, the first in this order wins.

  | Variable | Provider | Models used (skim / curator / writer) |
  |---|---|---|
  | `AI_GATEWAY_API_KEY` | [Vercel AI Gateway](https://vercel.com/ai-gateway): every provider through one key, with spend tracking | Anthropic's, through the gateway |
  | `ANTHROPIC_API_KEY` | Anthropic | Claude Haiku / Opus / Sonnet |
  | `OPENAI_API_KEY` | OpenAI | OpenAI's defaults |
  | `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini | Gemini's defaults |
  | `OPENAI_COMPATIBLE_BASE_URL` (+ `OPENAI_COMPATIBLE_API_KEY`) | Any OpenAI-compatible server: Ollama, LM Studio, vLLM, OpenRouter… | none: set all three `AI_MODEL_*` |

  `AI_MODEL_SKIM`, `AI_MODEL_CURATOR` and `AI_MODEL_WRITER` override the model per stage (the skim reads Sources and proposes Views; the curator builds them; the writer writes articles). The current defaults are in [`packages/ai/src/models.ts`](../packages/ai/src/models.ts).

  A local model on the host, through Ollama: `OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1`, any text as `OPENAI_COMPATIBLE_API_KEY`, and the three `AI_MODEL_*` set to models you've pulled. On Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `app` service. Builds need a capable model with tool calling; small local models may produce thin Expeditions.

- **`byok`** (bring your own key): each reader adds their own key under **Settings**, and nobody can build without one. Set `AI_KEYS_MASTER_KEY` to 32 random bytes (`openssl rand -base64 32`). Readers' keys are encrypted under it in the database: **back it up with your database**, because changing or losing it makes every stored key unreadable (readers then add theirs again).

Every AI change is either a first build, a View someone asked for, or a suggestion to accept or dismiss; nothing else writes to an Expedition. Builds show their estimated cost first, and pause at a spending cap.

## Sign-in

- **Email + password** is on by default (`AUTH_EMAIL_PASSWORD=1`). Anyone who can reach the instance can create an account until you close sign-up: once your accounts exist, set `AUTH_EMAIL_SIGNUP=0` and `docker compose up -d`. Existing accounts still sign in, and people you invite to an Expedition who already have an account can open it. To add someone later, open sign-up again for a moment (`AUTH_EMAIL_SIGNUP=1`), or connect Google.
- Email addresses aren't verified, so a pending email invite isn't attached to a new account automatically; the invite link works.
- **Google** (optional): create an OAuth client in the Google Cloud console (Web application), with the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The sign-in screen then offers both. For Google only, also set `AUTH_EMAIL_PASSWORD=0`.
- `BETTER_AUTH_SECRET` signs sessions and the MCP server's keys. Keep it stable: changing it signs everyone out and disconnects agents.

## Email

Seply Learn sends email only for invites. Without a mail server, invites are logged (`docker compose logs app`), and the invite link and each person's in-app inbox still work.

- **SMTP:** `SMTP_HOST`, `SMTP_PORT` (587 by default, with STARTTLS when the server offers it; 465 with `SMTP_SECURE=1` for TLS from the start), `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` (required, e.g. `"Seply Learn <learn@example.com>"`).
- **Resend** instead: `RESEND_API_KEY` (and `EMAIL_FROM`). Resend wins if both are set.

## Source files: volume, S3 or MinIO

Uploaded files, pasted chats and their segmented text are stored as blobs (25 MB per file):

- **The `data` volume** (the default): `/data/blobs` in the container. Back it up with the database.
- **The bundled MinIO** (an S3-compatible server in the same compose project). In `.env`, uncomment `COMPOSE_PROFILES=s3` and the five `S3_*` lines in the "Source files" section, and pick a secret of 8 characters or more:

  ```sh
  COMPOSE_PROFILES=s3
  S3_BUCKET=seply
  S3_ENDPOINT=http://minio:9000
  S3_ACCESS_KEY_ID=seply
  S3_SECRET_ACCESS_KEY=<openssl rand -hex 24>
  S3_REGION=us-east-1
  ```

  `docker compose up -d` then starts MinIO, a one-shot `minio-bucket` container creates the bucket (and exits), and the app starts once it exists. MinIO's API and console stay on the compose network; add `ports` to the `minio` service to reach them from the host. MinIO no longer publishes container images, so compose uses [pgsty's community build](https://github.com/pgsty/minio) (`MINIO_IMAGE` to change it).
- **Any other S3-compatible store** (AWS S3, Cloudflare R2, Backblaze B2, Garage…): set `S3_BUCKET` (it must exist), `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, without the profile. Path-style URLs are the default (`S3_FORCE_PATH_STYLE=1`); set `0` for stores that want `<bucket>.<host>`.

Switching stores doesn't move existing files: copy them across (the keys are the same, `sources/<expedition>/<source>/…`), e.g. with `mc mirror` or `rclone`.

## Map tiles

The Map View draws a coarse world map that's always there (bundled), and on top of it a detailed basemap:

- **Out of the box:** [OpenFreeMap](https://openfreemap.org)'s public styles. Nothing to set up, but readers' browsers fetch map tiles from openfreemap.org.
- **Your own extract** (no third party for tiles, works on a closed network): a [Protomaps](https://protomaps.com) PMTiles file, cut from their daily planet build to the area and zoom you need. More: [docs/ops/basemap-tiles.md](ops/basemap-tiles.md).

**1. Get the extract.** The `pmtiles` CLI reads only the parts it needs from the remote build, so you never download the whole planet. Find the newest build date at <https://maps.protomaps.com/builds/> (e.g. `20261008`), then, from the repository folder:

```sh
mkdir -p tiles
# The whole world to zoom 10 (cities, main roads): see the size first with --dry-run
docker run --rm -v "$PWD/tiles:/tiles" protomaps/go-pmtiles:v1.31.2 \
  extract https://build.protomaps.com/20261008.pmtiles /tiles/basemap.pmtiles --maxzoom=10 --dry-run
docker run --rm -v "$PWD/tiles:/tiles" protomaps/go-pmtiles:v1.31.2 \
  extract https://build.protomaps.com/20261008.pmtiles /tiles/basemap.pmtiles --maxzoom=10

# Or one region in more detail (west,south,east,north), e.g. Switzerland to zoom 14
docker run --rm -v "$PWD/tiles:/tiles" protomaps/go-pmtiles:v1.31.2 \
  extract https://build.protomaps.com/20261008.pmtiles /tiles/basemap.pmtiles --bbox=5.9,45.8,10.5,47.8 --maxzoom=14
```

With the CLI installed instead ([releases](https://github.com/protomaps/go-pmtiles/releases)), it's the same `pmtiles extract …`; `node scripts/basemap-tiles.mjs extract --maxzoom=10 --out=tiles/basemap.pmtiles` finds the newest build for you. Beyond its max zoom the map stays sharp but gains no detail. Size grows roughly fourfold per zoom level; [the measured extracts](ops/basemap-tiles.md#measured-extracts) give a sense of it.

**2. Serve it.** Compose mounts `./tiles` (or `SEPLY_TILES_DIR`) read-only at `/data/tiles`. In `.env`:

```sh
MAP_TILES_FILE=/data/tiles/basemap.pmtiles
```

and `docker compose up -d`. The app serves the file at `/tiles/basemap.pmtiles` with the byte-range requests the map reads it with, and tells the web app to use it (`GET /api/map-config`). Nothing is rebuilt: the setting is read at runtime. To refresh it later, replace the file and restart the app.

**Elsewhere:** a `.pmtiles` on any public URL works too, e.g. a public bucket or a CDN: set `MAP_TILES_URL` instead. That server must answer `Range` requests and allow your instance's origin through CORS (`GET` and `HEAD`, the `Range` header, exposing `ETag`, `Content-Length` and `Content-Range`).

**Fonts and sprites** for map labels and icons load from `protomaps.github.io` by default. For a fully offline map, host a copy of [basemaps-assets](https://github.com/protomaps/basemaps-assets) (its `fonts/` and `sprites/` folders) on any static server and set `MAP_ASSETS_URL` to its base URL.

## Running it on a server

- **HTTPS:** put a reverse proxy (Caddy, nginx, Traefik…) in front of port 3000 and set `BETTER_AUTH_URL` to the public origin people type, e.g. `https://learn.example.com`. Sign-in cookies, invite links, OAuth callbacks and the MCP server all use it. Browsers only offer installing the app, web push and offline reading over HTTPS (or on `localhost`).
- **WebSockets:** live editing upgrades `/api/expeditions/<id>/live` on the same port; the proxy must pass `Upgrade` and `Connection` headers (Caddy does by default; in nginx, `proxy_http_version 1.1` with `proxy_set_header Upgrade $http_upgrade` and `proxy_set_header Connection "upgrade"`).
- **Uploads** go up to 25 MB: raise the proxy's body limit (nginx: `client_max_body_size 30m`).
- **Several app instances** can share one database behind one origin; they pass live edits to each other through Postgres. No sticky sessions needed.
- **An external Postgres** (16 or 17, a direct connection, not PgBouncer in transaction mode, with the `pg_trgm` extension available): remove the `db` service and set `DATABASE_URL` in the `app` service's `environment` in `docker-compose.yml`.
- The image runs as an unprivileged user, and `docker compose stop` gives running builds 25 seconds to reach a checkpoint; a build cut off is picked up again from its last finished step when the app is back.

## Backups

What to keep: the **database**, the **Source files** (the `data` volume, or your bucket), and **`.env`** (above all `BETTER_AUTH_SECRET`, and `AI_KEYS_MASTER_KEY` in BYOK mode). The compose project is named `seply-learn`, so the volumes are `seply-learn_pgdata`, `seply-learn_data` and `seply-learn_minio` (`docker volume ls`). The commands below use the default `POSTGRES_USER` and `POSTGRES_DB` (`seply`); use yours if you changed them.

```sh
# The database: a consistent dump while the app runs
docker compose exec -T db pg_dump -U seply -Fc seply > seply-$(date +%F).dump

# Source files on the volume
docker run --rm -v seply-learn_data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/seply-files-$(date +%F).tgz -C /data blobs

# Source files in the bundled MinIO
docker run --rm -v seply-learn_minio:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/seply-minio-$(date +%F).tgz -C /data .
```

To restore, stop the app, replace the database with the dump (into an empty database: the job queue's partitioned tables don't take `pg_restore --clean`), put the files back, and start it again:

```sh
docker compose stop app
docker compose exec -T db dropdb -U seply seply
docker compose exec -T db createdb -U seply seply
docker compose exec -T db pg_restore -U seply -d seply --no-owner < seply-2026-10-09.dump
docker run --rm -v seply-learn_data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/seply-files-2026-10-09.tgz -C /data
docker compose start app
```

Expeditions can also be exported one by one (Expedition menu → **Export**, with their Source files), and imported on any instance.

## Upgrades and migrations

1. Back up (above).
2. Get the new version: `git pull` (or check out a release tag) and `docker compose up -d --build`; with the published image, change `SEPLY_IMAGE` to the new version and `docker compose pull app && docker compose up -d`.
3. The app applies new database migrations as it starts (under a lock, so several instances take turns), then serves. `docker compose logs app` shows `migrate: up to date` and `listening on …`.

To migrate as a separate step instead (e.g. before switching traffic), set `MIGRATE_ON_START=0` and run `docker compose run --rm app migrate`. Migrations only move forward: to go back a version, restore the backup you made before upgrading.

Read the release notes for new or changed settings; the app refuses to start with an invalid configuration rather than misbehave, and lists what to fix.

## Troubleshooting

- **`docker compose up` says a variable is missing:** fill in `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` in `.env`.
- **The app restarts over and over:** `docker compose logs app`. "The server is not configured" lists every problem (exit code 78); anything else is an error with its cause.
- **Can't sign in from another machine:** `BETTER_AUTH_URL` must be the address in the browser's address bar, scheme and port included.
- **Builds fail with "No AI key"**: in instance mode, set one key from [AI keys](#ai-keys) and `docker compose up -d`; in BYOK mode, add your key under Settings. Other build errors show on the Expedition (hover the View) and in the logs.
- **The map shows "Detailed map unavailable":** the tiles didn't load. Check `MAP_TILES_FILE` points at a file that exists in the container (`docker compose exec app ls -l /data/tiles`), or that `MAP_TILES_URL` allows CORS and Range requests.
- **Health:** `curl http://localhost:3000/api/health` answers `{"ok":true,"db":"seply"}`, or 503 when the database is unreachable. The container's own health check uses it.
- **Changing `POSTGRES_PASSWORD` later** doesn't change the existing database's password (Postgres only reads it on first start): change it inside Postgres too (`ALTER USER seply PASSWORD '…'`).

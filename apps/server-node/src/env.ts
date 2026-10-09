// The Node entry's configuration: env vars only (spec §2.10), validated once
// at startup so a misconfigured instance stops with every problem listed,
// rather than answering 503 later. The app's own vars (`ServerEnv`: auth,
// AI, email, web push) pass through to `@seply/server`, which reads them per
// request as on the Worker. Every variable is listed in README.md.
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ConfigError,
  readAiConfig,
  readConfig,
  type ServerConfig,
  type ServerEnv,
} from "@seply/server"

export type BlobConfig =
  | { kind: "fs"; dir: string }
  | {
      kind: "s3"
      bucket: string
      /** e.g. http://minio:9000 or https://s3.eu-west-1.amazonaws.com */
      endpoint: string
      region: string
      accessKeyId: string
      secretAccessKey: string
      /** `<endpoint>/<bucket>/<key>` (MinIO); else `<bucket>.<endpoint host>`. */
      pathStyle: boolean
    }

export type NodeConfig = {
  databaseUrl: string
  /** Connections per instance (the app, jobs and pg-boss share the pool). */
  poolMax: number
  port: number
  host: string
  /** The built SPA (apps/web/dist); null serves the API only. */
  webDist: string | null
  /** A PMTiles archive on a volume, served at MAP_TILES_PATH (MAP_TILES_FILE). */
  mapTilesFile: string | null
  migrateOnStart: boolean
  blobs: BlobConfig
  /** Jobs one instance runs at once. */
  jobConcurrency: number
  /** A job whose instance stops heartbeating this long is picked up again. */
  jobHeartbeatSeconds: number
  /** When Trash is purged (cron, UTC); null: never. */
  trashPurgeCron: string | null
  /** How long shutdown waits for running work before it exits anyway. */
  shutdownGraceMs: number
  /** What the app reads (`ServerEnv`), with the Node defaults applied. */
  env: ServerEnv
  /** The app's config, read once here to validate it. */
  server: ServerConfig
}

/** Where the SPA is in this repo (apps/web/dist), relative to this file. */
export const DEFAULT_WEB_DIST = fileURLToPath(
  new URL("../../web/dist", import.meta.url)
)

/** Where MAP_TILES_FILE is served (with Range requests, as PMTiles reads it). */
export const MAP_TILES_PATH = "/tiles/basemap.pmtiles"

/** Defaults the Node entry applies to the app's own vars. */
const NODE_DEFAULTS: Partial<ServerEnv> = {
  // Self-host: email + password by default, Google optional (spec §2.6).
  AUTH_EMAIL_PASSWORD: "1",
}

type Env = Record<string, string | undefined>

export function readNodeConfig(raw: Env = process.env): NodeConfig {
  const problems: string[] = []
  const get = (k: string) => {
    const v = raw[k]?.trim()
    return v ? v : undefined
  }
  const int = (k: string, dflt: number, min: number, max: number) => {
    const v = get(k)
    if (v === undefined) return dflt
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(
        `${k} must be a whole number from ${min} to ${max}, not "${v}"`
      )
      return dflt
    }
    return n
  }
  const bool = (k: string, dflt: boolean) => {
    const v = get(k)
    if (v === undefined) return dflt
    if (["1", "true", "yes"].includes(v)) return true
    if (["0", "false", "no"].includes(v)) return false
    problems.push(`${k} must be 1 or 0, not "${v}"`)
    return dflt
  }

  const databaseUrl = get("DATABASE_URL")
  if (!databaseUrl)
    problems.push("DATABASE_URL is not set (postgres://user:pass@host:5432/db)")
  else if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    problems.push("DATABASE_URL must be a postgres:// URL")

  const webRaw = get("WEB_DIST")
  let webDist: string | null =
    webRaw === "off" ? null : resolve(webRaw ?? DEFAULT_WEB_DIST)
  if (webDist && !existsSync(resolve(webDist, "index.html"))) {
    problems.push(
      `WEB_DIST has no index.html (${webDist}): build the web app first (pnpm --filter web build), or set WEB_DIST=off to serve the API only`
    )
    webDist = null
  }

  const blobs = readBlobs(get, bool, problems)

  const tilesRaw = get("MAP_TILES_FILE")
  const mapTilesFile = tilesRaw ? resolve(tilesRaw) : null
  if (mapTilesFile && !existsSync(mapTilesFile))
    problems.push(
      `MAP_TILES_FILE does not exist (${mapTilesFile}): download an extract first (docs/self-host.md), or unset it to use the fallback map`
    )

  const trashRaw = get("TRASH_PURGE_CRON")
  const trashPurgeCron = trashRaw === "off" ? null : (trashRaw ?? "17 4 * * *")
  if (trashPurgeCron && trashPurgeCron.split(/\s+/).length !== 5)
    problems.push(
      `TRASH_PURGE_CRON must be a 5-field cron expression or "off", not "${trashPurgeCron}"`
    )

  const env: ServerEnv = { ...NODE_DEFAULTS }
  for (const [k, v] of Object.entries(raw))
    if (v !== undefined) (env as Env)[k] = v
  // The Map View reads the archive from this origin unless MAP_TILES_URL says otherwise.
  if (mapTilesFile && !env.MAP_TILES_URL?.trim())
    env.MAP_TILES_URL = MAP_TILES_PATH

  if (!env.BETTER_AUTH_URL?.trim())
    problems.push(
      "BETTER_AUTH_URL is not set (this instance's public origin, e.g. https://learn.example.com)"
    )
  if (!env.BETTER_AUTH_SECRET)
    problems.push(
      "BETTER_AUTH_SECRET is not set (at least 32 random characters: openssl rand -base64 32)"
    )
  else if (env.BETTER_AUTH_SECRET.length < 32)
    problems.push(
      "BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"
    )
  let server: ServerConfig | undefined
  if (env.BETTER_AUTH_URL?.trim() && env.BETTER_AUTH_SECRET)
    try {
      server = readConfig(env)
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err
      problems.push(err.message)
    }
  if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET)
    problems.push("GOOGLE_CLIENT_SECRET is not set (GOOGLE_CLIENT_ID is)")
  if (server && !server.google && !server.emailPassword)
    problems.push(
      "No way to sign in: keep AUTH_EMAIL_PASSWORD=1 or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
    )

  try {
    const ai = readAiConfig(env)
    if (ai.mode === "byok" && !ai.masterKey)
      problems.push(
        "AI_KEYS_MASTER_KEY is not set (AI_KEY_MODE=byok needs it: openssl rand -base64 32)"
      )
    if (ai.masterKey && Buffer.from(ai.masterKey, "base64").length !== 32)
      problems.push("AI_KEYS_MASTER_KEY must be 32 bytes, base64")
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    problems.push(err.message)
  }

  const config = {
    databaseUrl: databaseUrl ?? "",
    poolMax: int("DATABASE_POOL_MAX", 10, 2, 200),
    port: int("PORT", 3000, 0, 65535),
    host: get("HOST") ?? "0.0.0.0",
    webDist,
    mapTilesFile,
    migrateOnStart: bool("MIGRATE_ON_START", true),
    blobs,
    jobConcurrency: int("JOBS_CONCURRENCY", 4, 1, 50),
    jobHeartbeatSeconds: int("JOBS_HEARTBEAT_SECONDS", 30, 10, 3600),
    trashPurgeCron,
    shutdownGraceMs: int("SHUTDOWN_GRACE_SECONDS", 25, 0, 3600) * 1000,
    env,
    server: server!,
  }
  if (problems.length)
    throw new ConfigError(
      `The server is not configured:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee apps/server-node/README.md for every variable.`
    )
  return config
}

function readBlobs(
  get: (k: string) => string | undefined,
  bool: (k: string, dflt: boolean) => boolean,
  problems: string[]
): BlobConfig {
  const kind = get("BLOB_STORE") ?? (get("S3_BUCKET") ? "s3" : "fs")
  if (kind === "fs")
    return { kind, dir: resolve(get("BLOB_DIR") ?? "./data/blobs") }
  if (kind !== "s3") {
    problems.push(`BLOB_STORE must be "fs" or "s3", not "${kind}"`)
    return { kind: "fs", dir: "" }
  }
  const region = get("S3_REGION") ?? "us-east-1"
  const endpoint = get("S3_ENDPOINT") ?? `https://s3.${region}.amazonaws.com`
  try {
    new URL(endpoint)
  } catch {
    problems.push(`S3_ENDPOINT is not a URL: ${endpoint}`)
  }
  const need = (k: string) => {
    const v = get(k)
    if (!v) problems.push(`${k} is not set (BLOB_STORE=s3 needs it)`)
    return v ?? ""
  }
  return {
    kind,
    bucket: need("S3_BUCKET"),
    endpoint: endpoint.replace(/\/+$/, ""),
    region,
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    pathStyle: bool("S3_FORCE_PATH_STYLE", true),
  }
}

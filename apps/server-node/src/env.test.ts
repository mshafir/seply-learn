import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigError } from "@seply/server"
import { describe, expect, it } from "vitest"
import { readNodeConfig } from "./env.ts"

const dist = mkdtempSync(join(tmpdir(), "seply-dist-"))
writeFileSync(join(dist, "index.html"), "<!doctype html>")

const valid = {
  DATABASE_URL: "postgres://seply:seply@db:5432/seply",
  BETTER_AUTH_URL: "https://learn.example.com",
  BETTER_AUTH_SECRET: "x".repeat(32),
  WEB_DIST: dist,
}

const problems = (env: Record<string, string | undefined>) => {
  try {
    readNodeConfig(env)
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as Error).message
  }
  throw new Error("expected a ConfigError")
}

describe("readNodeConfig", () => {
  it("reads a minimal env with the defaults", () => {
    const c = readNodeConfig(valid)
    expect(c).toMatchObject({
      databaseUrl: valid.DATABASE_URL,
      poolMax: 10,
      port: 3000,
      host: "0.0.0.0",
      webDist: dist,
      migrateOnStart: true,
      blobs: { kind: "fs" },
      jobConcurrency: 4,
      jobHeartbeatSeconds: 30,
      trashPurgeCron: "17 4 * * *",
      shutdownGraceMs: 25_000,
    })
    expect(c.blobs).toEqual({
      kind: "fs",
      dir: join(process.cwd(), "data/blobs"),
    })
    // Self-host: email + password on by default; Google off without keys.
    expect(c.env.AUTH_EMAIL_PASSWORD).toBe("1")
    expect(c.server).toMatchObject({
      baseURL: "https://learn.example.com",
      emailPassword: true,
      emailSignUp: true,
      google: undefined,
      mail: null,
    })
  })

  it("lists every problem at once", () => {
    const msg = problems({ WEB_DIST: "off" })
    expect(msg).toContain("DATABASE_URL is not set")
    expect(msg).toContain("BETTER_AUTH_URL is not set")
    expect(msg).toContain("BETTER_AUTH_SECRET is not set")
    expect(msg).toContain("apps/server-node/README.md")
  })

  it("refuses bad values", () => {
    const msg = problems({
      ...valid,
      DATABASE_URL: "mysql://x",
      BETTER_AUTH_SECRET: "short",
      PORT: "http",
      JOBS_HEARTBEAT_SECONDS: "5",
      MIGRATE_ON_START: "maybe",
      TRASH_PURGE_CRON: "daily",
      AI_KEY_MODE: "free",
    })
    for (const k of [
      "DATABASE_URL must be a postgres:// URL",
      "BETTER_AUTH_SECRET must be at least 32 characters",
      "PORT must be a whole number",
      "JOBS_HEARTBEAT_SECONDS must be a whole number from 10",
      "MIGRATE_ON_START must be 1 or 0",
      "TRASH_PURGE_CRON must be a 5-field cron expression",
      'AI_KEY_MODE must be "instance" or "byok"',
    ])
      expect(msg).toContain(k)
  })

  it("needs the web build unless WEB_DIST=off", () => {
    expect(problems({ ...valid, WEB_DIST: tmpdir() + "/nope" })).toContain(
      "WEB_DIST has no index.html"
    )
    expect(readNodeConfig({ ...valid, WEB_DIST: "off" }).webDist).toBeNull()
  })

  it("needs a way to sign in", () => {
    expect(problems({ ...valid, AUTH_EMAIL_PASSWORD: "0" })).toContain(
      "No way to sign in"
    )
    const google = readNodeConfig({
      ...valid,
      AUTH_EMAIL_PASSWORD: "0",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    })
    expect(google.server.emailPassword).toBe(false)
    expect(google.server.google).toBeDefined()
    expect(problems({ ...valid, GOOGLE_CLIENT_ID: "id" })).toContain(
      "GOOGLE_CLIENT_SECRET is not set"
    )
  })

  it("needs the master key in BYOK mode, 32 bytes", () => {
    expect(problems({ ...valid, AI_KEY_MODE: "byok" })).toContain(
      "AI_KEYS_MASTER_KEY is not set"
    )
    expect(
      problems({
        ...valid,
        AI_KEY_MODE: "byok",
        AI_KEYS_MASTER_KEY: "c2hvcnQ=",
      })
    ).toContain("AI_KEYS_MASTER_KEY must be 32 bytes")
    const key = Buffer.alloc(32, 7).toString("base64")
    expect(
      readNodeConfig({ ...valid, AI_KEY_MODE: "byok", AI_KEYS_MASTER_KEY: key })
        .server
    ).toBeDefined()
  })

  it("selects S3 by S3_BUCKET, path-style by default, and needs its keys", () => {
    expect(
      readNodeConfig({
        ...valid,
        S3_BUCKET: "seply",
        S3_ENDPOINT: "http://minio:9000/",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
      }).blobs
    ).toEqual({
      kind: "s3",
      bucket: "seply",
      endpoint: "http://minio:9000",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
      pathStyle: true,
    })
    expect(
      readNodeConfig({
        ...valid,
        BLOB_STORE: "s3",
        S3_BUCKET: "b",
        S3_REGION: "eu-west-1",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
        S3_FORCE_PATH_STYLE: "0",
      }).blobs
    ).toMatchObject({
      endpoint: "https://s3.eu-west-1.amazonaws.com",
      pathStyle: false,
    })
    const msg = problems({ ...valid, BLOB_STORE: "s3" })
    expect(msg).toContain("S3_BUCKET is not set")
    expect(msg).toContain("S3_ACCESS_KEY_ID is not set")
    expect(msg).toContain("S3_SECRET_ACCESS_KEY is not set")
    expect(problems({ ...valid, BLOB_STORE: "gcs" })).toContain(
      'BLOB_STORE must be "fs" or "s3"'
    )
  })

  it("passes SMTP problems through from the app's config", () => {
    expect(problems({ ...valid, SMTP_HOST: "mail" })).toContain("EMAIL_FROM")
    expect(
      readNodeConfig({ ...valid, SMTP_HOST: "mail", EMAIL_FROM: "a@b.c" })
        .server.mail
    ).toMatchObject({ kind: "smtp" })
  })

  it("turns off the Trash purge with TRASH_PURGE_CRON=off", () => {
    expect(
      readNodeConfig({ ...valid, TRASH_PURGE_CRON: "off" }).trashPurgeCron
    ).toBeNull()
  })

  it("serves MAP_TILES_FILE on this origin unless MAP_TILES_URL says otherwise", () => {
    const tiles = join(dist, "basemap.pmtiles")
    writeFileSync(tiles, "PMTiles")
    const c = readNodeConfig({ ...valid, MAP_TILES_FILE: tiles })
    expect(c.mapTilesFile).toBe(tiles)
    expect(c.server.map).toEqual({ tiles: "/tiles/basemap.pmtiles" })
    expect(
      readNodeConfig({
        ...valid,
        MAP_TILES_FILE: tiles,
        MAP_TILES_URL: "https://tiles.example.com/w.pmtiles",
      }).server.map.tiles
    ).toBe("https://tiles.example.com/w.pmtiles")
    expect(readNodeConfig(valid).mapTilesFile).toBeNull()
    expect(
      problems({ ...valid, MAP_TILES_FILE: join(dist, "missing.pmtiles") })
    ).toContain("MAP_TILES_FILE does not exist")
  })
})

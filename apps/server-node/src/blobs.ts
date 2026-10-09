// Blob stores for self-hosting (spec §2.7): Source files and segments on a
// local volume, or in any S3-compatible bucket (AWS, MinIO, R2's S3 API…).
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import type { BlobStore } from "@seply/server"
import { AwsClient } from "aws4fetch"
import type { BlobConfig } from "./env.ts"

/** A key as a path under `dir`; never outside it. */
function pathOf(dir: string, key: string): string {
  const root = resolve(dir)
  const parts = key.split("/")
  if (!key || parts.some((p) => !p || p === "." || p === ".."))
    throw new Error(`invalid blob key: ${key}`)
  const path = resolve(root, ...parts)
  if (!path.startsWith(root + sep)) throw new Error(`invalid blob key: ${key}`)
  return path
}

const META = ".content-type"

/**
 * Blobs as files under `dir` (a volume), each with its content type beside
 * it. Writes go to a temp file first, so a crash never leaves half a blob.
 */
export function fsBlobStore(dir: string): BlobStore {
  return {
    async put(key, body, meta) {
      const path = pathOf(dir, key)
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, body)
      await rename(tmp, path)
      await writeFile(path + META, meta.contentType)
    },
    async get(key) {
      const path = pathOf(dir, key)
      let body: Buffer
      try {
        body = await readFile(path)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
      }
      const contentType = await readFile(path + META, "utf8").catch(
        () => undefined
      )
      return { body: new Uint8Array(body), contentType }
    },
    async delete(key) {
      const path = pathOf(dir, key)
      await rm(path, { force: true })
      await rm(path + META, { force: true })
    },
  }
}

export type S3Options = Extract<BlobConfig, { kind: "s3" }> & {
  /** Tests pass a fake. */
  fetch?: typeof fetch
}

/** Blobs in an S3-compatible bucket, signed with SigV4 (aws4fetch). */
export function s3BlobStore(opts: S3Options): BlobStore {
  const client = new AwsClient({
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    region: opts.region,
    service: "s3",
  })
  const base = new URL(opts.endpoint)
  const urlOf = (key: string) => {
    const path = key.split("/").map(encodeURIComponent).join("/")
    if (opts.pathStyle)
      return `${base.origin}${base.pathname.replace(/\/$/, "")}/${opts.bucket}/${path}`
    return `${base.protocol}//${opts.bucket}.${base.host}/${path}`
  }
  const send = async (url: string, init: RequestInit) => {
    const req = await client.sign(url, init)
    return (opts.fetch ?? fetch)(req)
  }
  const fail = async (what: string, key: string, res: Response) => {
    const why = (await res.text().catch(() => "")).slice(0, 300)
    return new Error(`s3: ${what} ${key} answered ${res.status}: ${why}`)
  }
  return {
    async put(key, body, meta) {
      const res = await send(urlOf(key), {
        method: "PUT",
        body: typeof body === "string" ? body : new Uint8Array(body),
        headers: { "content-type": meta.contentType },
      })
      if (!res.ok) throw await fail("put", key, res)
    },
    async get(key) {
      const res = await send(urlOf(key), { method: "GET" })
      if (res.status === 404) {
        await res.body?.cancel()
        return null
      }
      if (!res.ok) throw await fail("get", key, res)
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? undefined,
      }
    },
    async delete(key) {
      const res = await send(urlOf(key), { method: "DELETE" })
      // S3 answers 204 whether or not the key existed; some stores 404.
      if (!res.ok && res.status !== 404) throw await fail("delete", key, res)
      await res.body?.cancel()
    },
  }
}

export function blobStoreFor(config: BlobConfig): BlobStore {
  return config.kind === "s3" ? s3BlobStore(config) : fsBlobStore(config.dir)
}

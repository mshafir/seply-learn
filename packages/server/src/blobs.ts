// Blob storage (spec §2.7): raw Source files and their segments. R2 when
// hosted; a local volume or an S3-compatible bucket when self-hosted (with
// the Node server). Runtimes hand the app a `blobs(env)`; tests use memory.
export type BlobMeta = { contentType: string }
export type StoredBlob = { body: Uint8Array<ArrayBuffer>; contentType?: string }

export interface BlobStore {
  put(key: string, body: Uint8Array | string, meta: BlobMeta): Promise<void>
  /** Null when there is no such blob. */
  get(key: string): Promise<StoredBlob | null>
  delete(key: string): Promise<void>
}

/** Where a Source's blobs live. Every key sits under its Expedition's prefix. */
export const sourcePrefix = (expeditionId: string) => `sources/${expeditionId}/`
export const sourceBlobKeys = (expeditionId: string, sourceId: string) => ({
  raw: `${sourcePrefix(expeditionId)}${sourceId}/raw`,
  segments: `${sourcePrefix(expeditionId)}${sourceId}/segments.json`,
})

/** For tests and local runs: blobs in a Map. */
export function memoryBlobStore(): BlobStore & { keys(): string[] } {
  const blobs = new Map<string, StoredBlob>()
  return {
    async put(key, body, meta) {
      const bytes =
        typeof body === "string" ? new TextEncoder().encode(body) : body
      blobs.set(key, { body: bytes.slice(), contentType: meta.contentType })
    },
    async get(key) {
      return blobs.get(key) ?? null
    },
    async delete(key) {
      blobs.delete(key)
    },
    keys: () => [...blobs.keys()],
  }
}

/**
 * The part of Cloudflare's `R2Bucket` this uses, so this package needs no
 * Workers types. The Worker passes its binding.
 */
export interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>
    httpMetadata?: { contentType?: string }
  } | null>
  delete(key: string): Promise<void>
}

export function r2BlobStore(bucket: R2BucketLike): BlobStore {
  return {
    async put(key, body, meta) {
      await bucket.put(key, body, {
        httpMetadata: { contentType: meta.contentType },
      })
    },
    async get(key) {
      const obj = await bucket.get(key)
      if (!obj) return null
      return {
        body: new Uint8Array(await obj.arrayBuffer()),
        contentType: obj.httpMetadata?.contentType,
      }
    },
    delete: (key) => bucket.delete(key),
  }
}

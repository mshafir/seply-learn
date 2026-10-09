import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BlobStore } from "@seply/server"
import { AwsClient } from "aws4fetch"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fsBlobStore, s3BlobStore } from "./blobs.ts"

/** What every store must do (the app's `BlobStore` contract). */
function contract(name: string, store: () => BlobStore) {
  describe(name, () => {
    it("puts, gets and deletes bytes and text with their content type", async () => {
      const s = store()
      const bytes = new Uint8Array([0, 1, 2, 250, 255])
      await s.put("sources/exp1/src1/raw", bytes, {
        contentType: "application/pdf",
      })
      await s.put("sources/exp1/src1/segments.json", '{"a":"ü"}', {
        contentType: "application/json",
      })
      const raw = await s.get("sources/exp1/src1/raw")
      expect(raw?.body).toEqual(bytes)
      expect(raw?.contentType).toBe("application/pdf")
      const seg = await s.get("sources/exp1/src1/segments.json")
      expect(new TextDecoder().decode(seg!.body)).toBe('{"a":"ü"}')
      expect(seg?.contentType).toBe("application/json")

      await s.put("sources/exp1/src1/raw", "replaced", {
        contentType: "text/plain",
      })
      expect(
        new TextDecoder().decode((await s.get("sources/exp1/src1/raw"))!.body)
      ).toBe("replaced")
      await s.delete("sources/exp1/src1/raw")
      expect(await s.get("sources/exp1/src1/raw")).toBeNull()
      // Deleting what isn't there is fine.
      await s.delete("sources/exp1/src1/raw")
    })

    it("answers null for a key that was never put", async () => {
      expect(await store().get("sources/none/none/raw")).toBeNull()
    })
  })
}

describe("fsBlobStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "seply-blobs-"))
  contract("on a volume", () => fsBlobStore(dir))

  it("never leaves the directory", async () => {
    const s = fsBlobStore(dir)
    for (const key of [
      "../escape",
      "sources/../../x",
      "/etc/passwd",
      "a//b",
      "",
    ])
      await expect(
        s.put(key, "x", { contentType: "text/plain" })
      ).rejects.toThrow(/invalid blob key/)
  })

  it("leaves no temp files behind", async () => {
    const d = mkdtempSync(join(tmpdir(), "seply-blobs-"))
    await fsBlobStore(d).put("k", "v", { contentType: "text/plain" })
    expect(readdirSync(d).sort()).toEqual(["k", "k.content-type"])
  })
})

/**
 * A stand-in for S3: path-style objects in memory, and a check that each
 * request is SigV4-signed for this key and region, with the payload hash.
 */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; type: string }>()
  const seen: { method: string; path: string; host: string }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const body = Buffer.concat(chunks)
      const path = decodeURIComponent(req.url!)
      seen.push({ method: req.method!, path, host: req.headers.host! })
      const auth = req.headers.authorization ?? ""
      const hash = req.headers["x-amz-content-sha256"]
      if (
        !/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/eu-test-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]*host[a-z0-9;-]*, Signature=[0-9a-f]{64}$/.test(
          auth
        ) ||
        !req.headers["x-amz-date"] ||
        (hash !== "UNSIGNED-PAYLOAD" &&
          hash !== createHash("sha256").update(body).digest("hex"))
      ) {
        res
          .writeHead(403)
          .end("<Error><Code>SignatureDoesNotMatch</Code></Error>")
        return
      }
      if (req.method === "PUT") {
        objects.set(path, { body, type: String(req.headers["content-type"]) })
        res.writeHead(200).end()
      } else if (req.method === "GET") {
        const o = objects.get(path)
        if (!o) res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>")
        else res.writeHead(200, { "content-type": o.type }).end(o.body)
      } else if (req.method === "DELETE") {
        objects.delete(path)
        res.writeHead(204).end()
      } else res.writeHead(405).end()
    })
  })
  return { server, objects, seen }
}

describe("s3BlobStore", () => {
  const fake = fakeS3()
  let endpoint = ""
  beforeAll(async () => {
    await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r))
    endpoint = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise((r) => (fake.server as Server).close(r)))

  const opts = () => ({
    kind: "s3" as const,
    bucket: "seply",
    endpoint,
    region: "eu-test-1",
    accessKeyId: "AKIDTEST",
    secretAccessKey: "secret",
    pathStyle: true,
  })
  contract("against a fake S3 (path-style, SigV4 checked)", () =>
    s3BlobStore(opts())
  )

  it("addresses objects path-style under the bucket", async () => {
    await s3BlobStore(opts()).put("sources/e/s/raw", "x", {
      contentType: "text/plain",
    })
    expect(fake.objects.has("/seply/sources/e/s/raw")).toBe(true)
  })

  it("addresses objects virtual-hosted when path style is off", async () => {
    const urls: string[] = []
    const store = s3BlobStore({
      ...opts(),
      endpoint: "https://s3.eu-test-1.amazonaws.com",
      pathStyle: false,
      fetch: async (req) => {
        urls.push((req as Request).url)
        return new Response(null, { status: 200 })
      },
    })
    await store.put("sources/e/s/raw", "x", { contentType: "text/plain" })
    expect(urls).toEqual([
      "https://seply.s3.eu-test-1.amazonaws.com/sources/e/s/raw",
    ])
  })

  it("throws with the status when the bucket refuses", async () => {
    const store = s3BlobStore({
      ...opts(),
      secretAccessKey: "secret",
      accessKeyId: "WRONG",
    })
    await expect(
      store.put("k", "x", { contentType: "text/plain" })
    ).rejects.toThrow(/s3: put k answered 403/)
    await expect(store.get("k")).rejects.toThrow(/answered 403/)
  })

  // A real S3-compatible server when one is given (CI runs moto's; MinIO
  // works the same): S3_TEST_ENDPOINT, with any key pair it accepts.
  const real = process.env.S3_TEST_ENDPOINT
  describe.runIf(real)("against S3_TEST_ENDPOINT", () => {
    const realOpts = {
      kind: "s3" as const,
      bucket: `seply-test-${Date.now()}`,
      endpoint: real ?? "",
      region: process.env.S3_TEST_REGION ?? "us-east-1",
      accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "test",
      pathStyle: true,
    }
    beforeAll(async () => {
      const aws = new AwsClient({ ...realOpts, service: "s3" })
      const res = await aws.fetch(`${real}/${realOpts.bucket}`, {
        method: "PUT",
      })
      expect(res.ok, await res.text()).toBe(true)
    })
    contract("a real bucket", () => s3BlobStore(realOpts))
  })
})

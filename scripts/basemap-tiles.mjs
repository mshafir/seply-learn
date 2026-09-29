#!/usr/bin/env node
// The Map View's basemap: extract our PMTiles from the public Protomaps
// build, measure it, record the size, and upload it to R2 (ticket 21, spec
// 2.7). Guide and measured sizes: docs/ops/basemap-tiles.md.
//
//   node scripts/basemap-tiles.mjs extract [--maxzoom=10] [--bbox=w,s,e,n] [--build=<url, file or YYYYMMDD>] [--out=<file>] [--dry-run]
//   node scripts/basemap-tiles.mjs upload <file> [--bucket=umbel-tiles] [--key=basemap.pmtiles]
//   node scripts/basemap-tiles.mjs all [extract flags] [upload flags]
//
// Needs the `pmtiles` CLI (go-pmtiles: https://github.com/protomaps/go-pmtiles
// releases, or `go install github.com/protomaps/go-pmtiles@latest`, which
// names it `go-pmtiles`; set PMTILES_BIN to point elsewhere).
//
// Upload reads CLOUDFLARE_API_TOKEN (with R2 edit permission) and
// CLOUDFLARE_ACCOUNT_ID. R2's S3 API takes the token's id as the access key
// and the SHA-256 of the token as the secret, so no separate R2 key pair is
// needed; `pmtiles upload` then does a multipart upload, which works for
// files of any size (unlike `wrangler r2 object put`, capped at 300 MiB).
// Nothing secret is printed or written.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs/ops/basemap-tiles.md");
const BUILDS = "https://build-metadata.protomaps.dev/builds.json";
const BUILD_HOST = "https://build.protomaps.com";
const DEFAULTS = { maxzoom: "10", bucket: "umbel-tiles", key: "basemap.pmtiles" };

const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const positional = rest.filter((a) => !a.startsWith("--"));
const bin = process.env.PMTILES_BIN ?? (which("pmtiles") ? "pmtiles" : which("go-pmtiles") ? "go-pmtiles" : undefined);

function which(name) {
  return spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).status === 0;
}
function die(message) {
  console.error(`basemap-tiles: ${message}`);
  process.exit(1);
}
function pmtiles(args) {
  if (!bin) die("the pmtiles CLI isn't installed (see the header of this script), or set PMTILES_BIN");
  const run = spawnSync(bin, args, { stdio: "inherit" });
  if (run.status !== 0) die(`${bin} ${args[0]} failed (exit ${run.status})`);
}
const mib = (bytes) => (bytes < 2 ** 20 ? `${(bytes / 2 ** 10).toFixed(0)} KiB` : `${(bytes / 2 ** 20).toFixed(1)} MiB`);

/** The build to extract from: a URL, a YYYYMMDD date, or the newest daily build. */
async function buildUrl() {
  const b = flags.build;
  if (b?.includes("://") || (b && existsSync(b))) return b;
  if (b) return `${BUILD_HOST}/${b.replace(/\.pmtiles$/, "")}.pmtiles`;
  const res = await fetch(BUILDS).catch((e) => die(`can't list Protomaps builds (${e.message}); pass --build=YYYYMMDD`));
  if (!res.ok) die(`can't list Protomaps builds (${res.status}); pass --build=YYYYMMDD`);
  const builds = await res.json();
  const newest = builds.map((x) => x.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort().at(-1);
  if (!newest) die("no daily build listed; pass --build=YYYYMMDD");
  return `${BUILD_HOST}/${newest}`;
}

async function extract() {
  const source = await buildUrl();
  const maxzoom = flags.maxzoom ?? DEFAULTS.maxzoom;
  const bbox = flags.bbox;
  const out = flags.out ?? join(ROOT, `basemap-z${maxzoom}${bbox ? "-region" : ""}.pmtiles`);
  const args = ["extract", source, out, `--maxzoom=${maxzoom}`, ...(bbox ? [`--bbox=${bbox}`] : [])];
  if ("dry-run" in flags) {
    // Reads only the archive's directories and prints the size it would download.
    pmtiles([...args, "--dry-run"]);
    return undefined;
  }
  console.log(`Extracting z0–${maxzoom}${bbox ? ` inside ${bbox}` : " (the whole world)"} from ${source}`);
  pmtiles(args);
  const size = statSync(out).size;
  console.log(`\n${basename(out)}: ${mib(size)} (${size} bytes)`);
  record({ source, maxzoom, bbox, size });
  return out;
}

/** Adds the measurement to the table in docs/ops/basemap-tiles.md. */
function record({ source, maxzoom, bbox, size }) {
  if (!existsSync(DOC)) return;
  const row = `| ${new Date().toISOString().slice(0, 10)} | ${basename(source)} | ${bbox ?? "world"} | ${maxzoom} | ${mib(size)} |`;
  const text = readFileSync(DOC, "utf8");
  const marker = "<!-- measured extracts: the script appends rows above this line -->";
  if (!text.includes(marker)) return console.log(`Record it in ${DOC}:\n${row}`);
  writeFileSync(DOC, text.replace(marker, `${row}\n${marker}`));
  console.log(`Recorded in docs/ops/basemap-tiles.md: ${row}`);
}

async function upload(file) {
  if (!file || !existsSync(file)) die(`no such file: ${file ?? "(none given)"}`);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) die("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
  const id = await tokenId(token, account);
  const bucket = flags.bucket ?? DEFAULTS.bucket;
  const key = flags.key ?? DEFAULTS.key;
  const endpoint = `https://${account}.r2.cloudflarestorage.com`;
  console.log(`Uploading ${basename(file)} (${mib(statSync(file).size)}) to r2://${bucket}/${key}`);
  const run = spawnSync(bin ?? die("the pmtiles CLI isn't installed"), ["upload", file, key, `--bucket=s3://${bucket}?region=auto&endpoint=${endpoint}`], {
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: id,
      AWS_SECRET_ACCESS_KEY: createHash("sha256").update(token).digest("hex"),
      AWS_REGION: "auto",
    },
  });
  if (run.status !== 0) die(`upload failed (exit ${run.status})`);
  console.log(`Done. Serve it publicly (docs/ops/basemap-tiles.md) and set VITE_MAP_TILES_URL to its URL.`);
}

/** The API token's id, which R2's S3 API uses as the access key id. */
async function tokenId(token, account) {
  for (const url of [
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    `https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`,
  ]) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    const body = res?.ok ? await res.json() : undefined;
    if (body?.success && body.result?.id) return body.result.id;
  }
  die("Cloudflare didn't verify CLOUDFLARE_API_TOKEN (user or account token)");
}

if (command === "extract") await extract();
else if (command === "upload") await upload(positional[0]);
else if (command === "all") {
  const out = await extract();
  if (out) await upload(out);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 8).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(command ? 1 : 0);
}

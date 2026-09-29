#!/usr/bin/env node
// Deploy helpers for .github/workflows/preview.yml. See docs/ops/deploy.md.
//
//   node scripts/ci.mjs hyperdrive-upsert <name>   create/update a Hyperdrive config for
//                                                  $DATABASE_URL, then write wrangler.ci.json
//                                                  (wrangler.jsonc with that config's id)
//   node scripts/ci.mjs hyperdrive-delete <name>   delete a Hyperdrive config (no-op if absent)
//   node scripts/ci.mjs worker-delete <name>       delete a Worker script (no-op if absent)
//   node scripts/ci.mjs neon-default-branch        print name=, and write the default branch's
//                                                  connection string to $GITHUB_OUTPUT as db_url
//   node scripts/ci.mjs neon-branch-delete <name>  delete a Neon branch by name (no-op if absent)
//   node scripts/ci.mjs worker-urls <name>         write url= (this Worker's workers.dev URL),
//                                                  production_url= and preview_origins= to
//                                                  $GITHUB_OUTPUT, before the first deploy
//   node scripts/ci.mjs secrets-file <path>        write the Worker secrets (AUTH_SECRETS below)
//                                                  from env to <path> as JSON, mode 0600, for
//                                                  `wrangler deploy --secrets-file`
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, NEON_API_KEY, NEON_PROJECT_ID,
// DATABASE_URL, the AUTH_SECRETS, and optionally NEON_DATABASE (neondb),
// NEON_ROLE (neondb_owner) and WORKER_PRODUCTION (umbel-learn).
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function env(name) {
  const v = process.env[name]
  if (!v) throw new Error(`missing env ${name}`)
  return v
}

async function api(base, token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return null
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

const cf = (method, path, body) =>
  api(
    `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}`,
    env("CLOUDFLARE_API_TOKEN"),
    method,
    path,
    body
  )

const neon = (method, path, body) =>
  api(
    `https://console.neon.tech/api/v2/projects/${env("NEON_PROJECT_ID")}`,
    env("NEON_API_KEY"),
    method,
    path,
    body
  )

async function findHyperdrive(name) {
  const res = await cf("GET", "/hyperdrive/configs")
  return (res?.result ?? []).find((c) => c.name === name)
}

async function hyperdriveUpsert(name) {
  const url = new URL(env("DATABASE_URL"))
  const body = {
    name,
    origin: {
      scheme: "postgres",
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    },
    // Previews and health checks must see fresh data; caching can be tuned later.
    caching: { disabled: true },
  }
  const existing = await findHyperdrive(name)
  const res = existing
    ? await cf("PUT", `/hyperdrive/configs/${existing.id}`, body)
    : await cf("POST", "/hyperdrive/configs", body)
  const id = res.result.id
  console.log(`hyperdrive ${existing ? "updated" : "created"}: ${name} (${id})`)

  // wrangler.jsonc has a placeholder id; write a deploy config with the real one.
  // Imported here, not at the top: teardown runs this script without installing dependencies.
  const { default: ts } = await import("typescript")
  const src = join(root, "wrangler.jsonc")
  const { config, error } = ts.parseConfigFileTextToJson(
    src,
    readFileSync(src, "utf8")
  )
  if (error)
    throw new Error(`cannot parse wrangler.jsonc: ${error.messageText}`)
  const binding = config.hyperdrive?.find((h) => h.binding === "HYPERDRIVE")
  if (!binding) throw new Error("wrangler.jsonc has no HYPERDRIVE binding")
  binding.id = id
  writeFileSync(join(root, "wrangler.ci.json"), JSON.stringify(config, null, 2))
  console.log("wrote wrangler.ci.json")
}

async function hyperdriveDelete(name) {
  const existing = await findHyperdrive(name)
  if (!existing)
    return console.log(`hyperdrive ${name}: not found, nothing to delete`)
  await cf("DELETE", `/hyperdrive/configs/${existing.id}`)
  console.log(`hyperdrive deleted: ${name}`)
}

async function workerDelete(name) {
  const res = await cf(
    "DELETE",
    `/workers/scripts/${encodeURIComponent(name)}?force=true`
  )
  console.log(
    res
      ? `worker deleted: ${name}`
      : `worker ${name}: not found, nothing to delete`
  )
}

async function neonDefaultBranch() {
  const { branches } = await neon("GET", "/branches")
  const branch = branches.find((b) => b.default)
  if (!branch) throw new Error("Neon project has no default branch")
  const params = new URLSearchParams({
    branch_id: branch.id,
    database_name: process.env.NEON_DATABASE || "neondb",
    role_name: process.env.NEON_ROLE || "neondb_owner",
  })
  const { uri } = await neon("GET", `/connection_uri?${params}`)
  console.log(`::add-mask::${uri}`)
  const out = process.env.GITHUB_OUTPUT
  if (!out) throw new Error("GITHUB_OUTPUT is not set")
  appendFileSync(out, `name=${branch.name}\ndb_url=${uri}\n`)
  console.log(`neon default branch: ${branch.name}`)
}

async function neonBranchDelete(name) {
  const { branches } = await neon("GET", "/branches")
  const branch = branches.find((b) => b.name === name)
  if (!branch)
    return console.log(`neon branch ${name}: not found, nothing to delete`)
  if (branch.default)
    throw new Error(`refusing to delete the default branch ${name}`)
  await neon("DELETE", `/branches/${branch.id}`)
  console.log(`neon branch deleted: ${name}`)
}

function output(values) {
  const out = process.env.GITHUB_OUTPUT
  if (!out) throw new Error("GITHUB_OUTPUT is not set")
  appendFileSync(
    out,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join("")
  )
}

// A Worker's URL is known before it is deployed: https://<name>.<subdomain>.workers.dev.
// BETTER_AUTH_URL has to be set by the same deploy that first creates the Worker.
async function workerUrls(name) {
  const res = await cf("GET", "/workers/subdomain")
  const sub = res?.result?.subdomain
  if (!sub)
    throw new Error(
      "no workers.dev subdomain on this account (see the docs/ops/deploy.md checklist)"
    )
  const production = process.env.WORKER_PRODUCTION || "umbel-learn"
  const values = {
    url: `https://${name}.${sub}.workers.dev`,
    production_url: `https://${production}.${sub}.workers.dev`,
    preview_origins: `https://umbel-pr-*.${sub}.workers.dev`,
  }
  output(values)
  console.log(values)
}

// Copied into every Worker, preview and production. Values never reach the log.
const AUTH_SECRETS = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
]

function secretsFile(path) {
  const secrets = Object.fromEntries(AUTH_SECRETS.map((n) => [n, env(n)]))
  writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 })
  chmodSync(path, 0o600)
  console.log(`wrote ${AUTH_SECRETS.join(", ")} to ${path}`)
}

const commands = {
  "worker-urls": workerUrls,
  "secrets-file": secretsFile,
  "hyperdrive-upsert": hyperdriveUpsert,
  "hyperdrive-delete": hyperdriveDelete,
  "worker-delete": workerDelete,
  "neon-default-branch": neonDefaultBranch,
  "neon-branch-delete": neonBranchDelete,
}

const [cmd, arg] = process.argv.slice(2)
const run = commands[cmd]
if (!run) {
  console.error(`usage: ci.mjs <${Object.keys(commands).join("|")}> [name]`)
  process.exit(2)
}
if (cmd !== "neon-default-branch" && !arg) {
  console.error(`${cmd} needs a name`)
  process.exit(2)
}
try {
  await run(arg)
} catch (err) {
  console.error(`::error::${err.message}`)
  process.exit(1)
}

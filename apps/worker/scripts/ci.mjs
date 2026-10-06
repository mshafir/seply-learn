#!/usr/bin/env node
// Deploy helpers for .github/workflows/preview.yml. See docs/ops/deploy.md.
//
//   node scripts/ci.mjs hyperdrive-upsert <name>   create/update a Hyperdrive config for
//                                                  $DATABASE_URL, then write wrangler.ci.json
//                                                  (wrangler.jsonc with that config's id,
//                                                  and Workflows named <name>-<binding>)
//   node scripts/ci.mjs hyperdrive-delete <name>   delete a Hyperdrive config (no-op if absent)
//   node scripts/ci.mjs worker-delete <name>       delete a Worker script and its Workflows
//                                                  (no-op if absent)
//   node scripts/ci.mjs neon-default-branch        print name=, and write the default branch's
//                                                  connection string to $GITHUB_OUTPUT as db_url
//   node scripts/ci.mjs neon-branch-delete <name>  delete a Neon branch by name (no-op if absent)
//   node scripts/ci.mjs worker-urls <name>         write url= (this Worker's URL),
//                                                  production_url= and preview_origins= to
//                                                  $GITHUB_OUTPUT, before the first deploy
//   node scripts/ci.mjs custom-domain <hostname>   add <hostname> to wrangler.ci.json as the
//                                                  Worker's custom domain (production only)
//   node scripts/ci.mjs r2-bucket <name>           create the R2 bucket if absent, and point
//                                                  wrangler.ci.json's SOURCES binding at it
//   node scripts/ci.mjs secrets-file <path>        write the Worker secrets (AUTH_SECRETS below,
//                                                  plus OPTIONAL_SECRETS that are set)
//                                                  from env to <path> as JSON, mode 0600, for
//                                                  `wrangler deploy --secrets-file`
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, NEON_API_KEY, NEON_PROJECT_ID,
// DATABASE_URL, the AUTH_SECRETS, and optionally NEON_DATABASE (neondb),
// NEON_ROLE (neondb_owner), WORKER_PRODUCTION (seply-learn) and PRODUCTION_DOMAIN
// (e.g. learn.seply.dev; unset means production stays on workers.dev).
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
  // Workflow names are unique per account: each Worker gets its own.
  for (const wf of config.workflows ?? []) wf.name = workflowName(name, wf)
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

// The Workflow bindings in wrangler.jsonc. Teardown runs without the config
// parser, so they are listed here too.
const WORKFLOW_BINDINGS = ["JOBS"]

/** A Worker's own name for one of its Workflows: `<worker>-<binding>`, lowercase. */
function workflowName(worker, wf) {
  return `${worker}-${wf.binding.toLowerCase()}`
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
  // Its Workflows outlive the script; delete them too, instances included.
  for (const binding of WORKFLOW_BINDINGS) {
    const wf = workflowName(name, { binding })
    const gone = await cf("DELETE", `/workflows/${encodeURIComponent(wf)}`)
    console.log(
      gone
        ? `workflow deleted: ${wf}`
        : `workflow ${wf}: not found, nothing to delete`
    )
  }
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

// A Worker's URL is known before it is deployed: https://<name>.<subdomain>.workers.dev,
// or https://$PRODUCTION_DOMAIN for production when that is set.
// BETTER_AUTH_URL has to be set by the same deploy that first creates the Worker.
async function workerUrls(name) {
  const res = await cf("GET", "/workers/subdomain")
  const sub = res?.result?.subdomain
  if (!sub)
    throw new Error(
      "no workers.dev subdomain on this account (see the docs/ops/deploy.md checklist)"
    )
  const production = process.env.WORKER_PRODUCTION || "seply-learn"
  const domain = process.env.PRODUCTION_DOMAIN
  const productionUrl = domain
    ? `https://${domain}`
    : `https://${production}.${sub}.workers.dev`
  const values = {
    url:
      name === production
        ? productionUrl
        : `https://${name}.${sub}.workers.dev`,
    production_url: productionUrl,
    preview_origins: `https://seply-pr-*.${sub}.workers.dev`,
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

// AI secrets (spec §5.6), uploaded when the repo secret exists: the hosted
// instance key, and the master key that bring-your-own-key mode encrypts
// readers' keys under. Without them the Worker runs, and AI says it isn't set up.
// And the web push VAPID keys (WP-3.2): web push is off without them.
// And Resend's key (WP-5.1): invite emails are off without it (the link and
// the inbox still work). EMAIL_FROM is a var, passed with --var.
const OPTIONAL_SECRETS = [
  "AI_GATEWAY_API_KEY",
  "AI_KEYS_MASTER_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "RESEND_API_KEY",
]

function secretsFile(path) {
  const secrets = Object.fromEntries(AUTH_SECRETS.map((n) => [n, env(n)]))
  for (const n of OPTIONAL_SECRETS)
    if (process.env[n]) secrets[n] = process.env[n]
  writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 })
  chmodSync(path, 0o600)
  console.log(`wrote ${Object.keys(secrets).join(", ")} to ${path}`)
}

// Attaches the production Worker to its own hostname. Only the production job calls
// this: previews deploy from the same config and must not claim the domain.
function customDomain(hostname) {
  const path = join(root, "wrangler.ci.json")
  const config = JSON.parse(readFileSync(path, "utf8"))
  config.routes = [{ pattern: hostname, custom_domain: true }]
  // With routes set, wrangler turns workers.dev off unless asked; keep the old URL working.
  config.workers_dev = true
  writeFileSync(path, JSON.stringify(config, null, 2))
  console.log(`wrangler.ci.json: custom domain ${hostname}`)
}

// Source files (spec §2.7): previews share seply-sources-preview, production
// uses seply-sources. Run after hyperdrive-upsert, which writes wrangler.ci.json.
// Until R2 is enabled on the account (Cloudflare error 10042), deploys go
// ahead without the binding and the Source routes answer 503.
async function r2Bucket(name) {
  const path = join(root, "wrangler.ci.json")
  const config = JSON.parse(readFileSync(path, "utf8"))
  const binding = config.r2_buckets?.find((b) => b.binding === "SOURCES")
  if (!binding) throw new Error("wrangler.jsonc has no SOURCES binding")
  try {
    const existing = await cf("GET", `/r2/buckets/${encodeURIComponent(name)}`)
    if (existing) console.log(`r2 bucket ${name}: exists`)
    else {
      await cf("POST", "/r2/buckets", { name })
      console.log(`r2 bucket created: ${name}`)
    }
  } catch (err) {
    if (!/"code":10042\b/.test(err.message)) throw err
    config.r2_buckets = config.r2_buckets.filter((b) => b !== binding)
    writeFileSync(path, JSON.stringify(config, null, 2))
    console.log(
      "::warning title=R2 not enabled::Deploying without the SOURCES bucket: Source uploads answer 503 until R2 is enabled in the Cloudflare dashboard (docs/ops/deploy.md)."
    )
    return
  }
  binding.bucket_name = name
  writeFileSync(path, JSON.stringify(config, null, 2))
  console.log(`wrangler.ci.json: SOURCES → ${name}`)
}

const commands = {
  "r2-bucket": r2Bucket,
  "custom-domain": customDomain,
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

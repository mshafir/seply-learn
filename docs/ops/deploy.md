# Deploying: CI, per-PR previews and production

Spec: [02-architecture.md §2.10](../spec/v1/02-architecture.md#210-deployment). Work package: WP-0.2 (#2).

Two workflows:

| Workflow   | File                            | Runs on                                        | Needs secrets?    |
| ---------- | ------------------------------- | ---------------------------------------------- | ----------------- |
| **CI**     | `.github/workflows/ci.yml`      | every PR, pushes to `main`                     | No                |
| **Deploy** | `.github/workflows/preview.yml` | PR opened/updated/closed; CI passing on `main` | Yes (four, below) |

**CI** runs `pnpm check` (dependency rule, typecheck, lint, Vitest), `pnpm check:private`, `pnpm --filter web build`, a dry-run bundle of the Worker, and the Playwright smoke test (light and dark). The Playwright report is uploaded as an artifact when it fails.

**Deploy** starts with a `gate` job. If any of the four (three secrets and the `NEON_PROJECT_ID` variable) is missing, it logs a notice (_"Deploys skipped: missing repo secrets …"_) and every other job is skipped, so the workflow passes. Fork PRs never get secrets, so they skip too.

## Owner checklist (issue #40)

Add these under **Settings → Secrets and variables → Actions → Repository secrets**.

- [ ] **Cloudflare account on Workers Paid** ($5/month; the free plan's 10 ms CPU limit is too tight, see §2.2).
- [ ] **A workers.dev subdomain.** Open _Workers & Pages_ once in the dashboard and pick one. Preview URLs are `https://umbel-pr-<n>.<subdomain>.workers.dev`.
- [ ] **`CLOUDFLARE_ACCOUNT_ID`:** from the dashboard's account home, or `wrangler whoami`.
- [ ] **`CLOUDFLARE_API_TOKEN`:** an account-owned token (_Manage Account → Account API Tokens → Create Token → Custom token_). Under **Account Resources**, include this account; a zones scope fails with _"Failed common permission check"_. **Account** permissions (the dashboard may say _Write_ for _Edit_):
  - Workers Scripts: Edit
  - Hyperdrive: Edit
  - Workers R2 Storage: Edit (not used yet; added now so the token doesn't need re-issuing when WP-1.x adds buckets)
  - Account Settings: Read
  - Durable Objects and Workflows have no permission of their own; they deploy under Workers Scripts.
  - No **User** permissions: wrangler only needs them to discover the account, and CI always sets `CLOUDFLARE_ACCOUNT_ID`. `scripts/ci.mjs` calls only `/accounts/<id>/…` endpoints.
- [ ] **Neon project.** Create it in the region closest to your Cloudflare users. Its default branch (usually `main`) is **production**. Keep the default database `neondb` and role `neondb_owner`, or set the `NEON_DATABASE` / `NEON_ROLE` env in the workflow.
- [ ] **`NEON_PROJECT_ID`:** a repo **variable** (not a secret), e.g. `cool-name-123456`, from _Project settings → General_.
- **Neon's GitHub integration** (_Neon project → Integrations → GitHub_) sets both for you, `NEON_API_KEY` as a secret and `NEON_PROJECT_ID` as a variable. The workflow follows its convention so the integration can re-sync them without breaking deploys.
- [ ] **`NEON_API_KEY`:** _Account settings → API keys_. A project-scoped key is enough.

- [ ] **Google OAuth client** (Google Cloud Console → Google Auth Platform). Needed from WP-1.1.
  - **Audience:** External, publishing status _Testing_, with yourself under **Test users**. Publish before anyone else signs in.
  - **Data access (scopes):** `openid`, `userinfo.email`, `userinfo.profile`.
  - **Client** (type: Web application):

    | Authorized JavaScript origins | Authorized redirect URIs |
    |---|---|
    | `https://umbel-learn.michael-shafir.workers.dev` | `https://umbel-learn.michael-shafir.workers.dev/api/auth/callback/google` |
    | `http://localhost:8787` | `http://localhost:8787/api/auth/callback/google` |
    | `http://localhost:5173` | `http://localhost:5173/api/auth/callback/google` |

    Previews are not listed: Google allows no wildcards, so previews sign in through production with Better Auth's OAuth proxy plugin (WP-1.1). Add a custom domain here when production moves to one.
  - **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` (session signing; generate it without seeing it: `openssl rand -base64 32 | gh secret set BETTER_AUTH_SECRET -R mshafir/umbel-learn`).

- [ ] **`AI_GATEWAY_API_KEY`:** a Vercel AI Gateway key (_Vercel dashboard → AI Gateway → API keys_), the hosted instance key (spec §5.1, §5.7). Needed from WP-3.3. Set a spend limit in Vercel: previews use it too, and per-user caps are phase 2.

- [ ] **Email (Resend):** needed from WP-5.2. The domain `mail.umbel.dev` is verified in Resend; its DKIM, SPF (MX and TXT on `send.mail`) and `_dmarc.umbel.dev` records live in the Cloud DNS zone `umbel-dev`.
  - **`RESEND_API_KEY`:** a _Sending access_ key restricted to `mail.umbel.dev`.
  - **`EMAIL_FROM`** (a repo **variable**, not a secret): `Umbel Learn <invites@mail.umbel.dev>`.

When the Cloudflare and Neon secrets and the variable exist, the next PR push deploys a preview, and the next green CI run on `main` deploys production. Nothing else needs changing.

## How a preview works

On every PR push (`opened`, `synchronize`, `reopened`):

1. Build the SPA (`apps/web/dist`).
2. **Neon branch** `preview/pr-<n>`, created from the default branch by `neondatabase/create-branch-action` (reused if it exists). Each PR gets its own copy of the data, so parallel agents never share a database.
3. **Hyperdrive config** `umbel-pr-<n>`, created or updated to point at that branch's direct (non-pooled) connection string, with caching off. `apps/worker/scripts/ci.mjs hyperdrive-upsert` does this through the Cloudflare API, then writes `apps/worker/wrangler.ci.json`: `wrangler.jsonc` with the real Hyperdrive id in place of the placeholder.
4. **Deploy** `wrangler deploy --config wrangler.ci.json --name umbel-pr-<n> --var DB_BRANCH:preview/pr-<n>`. This is a separate Worker per PR, with its own bindings.
5. **Check** `GET /api/health` until it answers. It returns `{"ok":true,"db":"neondb","branch":"preview/pr-<n>"}`: `db` comes from `select current_database()` through Hyperdrive, and `branch` names the Neon branch.
6. **Comment** the URL and the health response on the PR. It's one comment, updated on every push.

On **close** (merged or not), the teardown job deletes, in order, the Worker, the Hyperdrive config and the Neon branch. It then edits the comment to say so. Each delete is a no-op if the resource is already gone, so closing a PR opened before the secrets existed is safe.

**Production:** when CI passes on a push to `main`, the `production` job checks out that exact commit. It looks up the Neon default branch and its connection string (Neon API), upserts the Hyperdrive config `umbel-production`, runs `wrangler deploy` (Worker name `umbel-learn`, from `wrangler.jsonc`), and checks `/api/health`. It runs in the `production` GitHub environment, so you can add required reviewers there.

**Migrations** (WP-1.1 onward) slot in before the Hyperdrive step in both jobs. They run against the branch's `db_url`.

### Why Hyperdrive per preview, not a connection-string secret

The alternative was one shared Hyperdrive config, or none, with each preview getting its branch's URL as a Worker secret (`DATABASE_URL`). We chose a Hyperdrive config per PR because:

- **Previews run the production code path.** Production reads Postgres through Hyperdrive (§2.2), and so does every preview. Hyperdrive-only limits, like no `LISTEN/NOTIFY`, no advisory locks and no session state, show up in the PR, not after merge.
- **The Worker code has one database path:** `env.HYPERDRIVE.connectionString`. There's no second "direct connection" branch to keep working.
- **It's cheap.** Hyperdrive has no charge. Workers Paid allows 25 configs, and each PR holds one only while it's open.

The cost is `ci.mjs`, a small script that calls the Hyperdrive API and patches the id into a generated deploy config. `wrangler.jsonc` can't hold a per-PR id.

### Why a Worker per PR, not `wrangler versions upload` with preview aliases

A preview alias shares the production Worker's bindings, so every PR would share one Hyperdrive config and one database. A separate `umbel-pr-<n>` Worker has its own Hyperdrive binding, and later its own Durable Object namespace, so PRs stay isolated. Tearing it down is one API call.

## Running it locally

```sh
mise exec -- pnpm --filter web build
cd apps/worker
# Any Postgres works. Wrangler points the HYPERDRIVE binding straight at it in dev.
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://user:pass@localhost:5432/db \
  mise exec -- pnpm dev
curl localhost:8787/api/health   # {"ok":true,"db":"db","branch":"local"}
```

- Other checks: `mise exec -- pnpm --filter web test:e2e` runs the Playwright smoke test (install Chromium once with `pnpm --filter web exec playwright install chromium`), and `mise exec -- pnpm --filter @umbel/worker bundle` does the same dry-run bundle as CI.
- The Worker's `typecheck` script runs `wrangler types` first. `worker-configuration.d.ts` is generated, not committed.

## Troubleshooting

- **"No workers.dev URL in the wrangler output":** the account has no workers.dev subdomain yet (see the checklist).
- **Hyperdrive API 403:** the token is missing _Hyperdrive: Edit_.
- **`/api/health` returns `{"ok":false,"db":"error"}`:** Hyperdrive can't reach the Neon branch. Check the Worker logs (observability is on) and the branch's compute status in Neon.
- **Leftovers after a failed teardown:** re-run the job, or delete `umbel-pr-<n>` (Worker and Hyperdrive config) and the Neon branch `preview/pr-<n>` by hand.

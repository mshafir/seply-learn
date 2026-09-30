# Deploying: CI, per-PR previews and production

Spec: [02-architecture.md §2.10](../spec/v1/02-architecture.md#210-deployment). Work package: WP-0.2 (#2).

Two workflows:

| Workflow   | File                            | Runs on                                        | Needs secrets?    |
| ---------- | ------------------------------- | ---------------------------------------------- | ----------------- |
| **CI**     | `.github/workflows/ci.yml`      | every PR, pushes to `main`                     | No                |
| **Deploy** | `.github/workflows/preview.yml` | PR opened/updated/closed; CI passing on `main` | Yes (four, below) |

**CI** runs `pnpm check` (dependency rule, typecheck, lint, Vitest), `pnpm check:private`, `pnpm --filter web build`, a dry-run bundle of the Worker, and Playwright: the smoke test (light and dark) and the API tests, which run the Worker (`wrangler dev`) against a migrated Postgres service container and sign in with a test account. The Playwright report is uploaded as an artifact when it fails.

**Deploy** starts with a `gate` job. If any of the four (three secrets and the `NEON_PROJECT_ID` variable) is missing, it logs a notice (_"Deploys skipped: missing repo secrets …"_) and every other job is skipped, so the workflow passes. Fork PRs never get secrets, so they skip too.

## Owner checklist (issue #40)

Add these under **Settings → Secrets and variables → Actions → Repository secrets**.

- [X] **Cloudflare account on Workers Paid** ($5/month; the free plan's 10 ms CPU limit is too tight, see §2.2).
- [X] **A workers.dev subdomain.** Open _Workers & Pages_ once in the dashboard and pick one. Preview URLs are `https://umbel-pr-<n>.<subdomain>.workers.dev`.
- [X] **`CLOUDFLARE_ACCOUNT_ID`:** from the dashboard's account home, or `wrangler whoami`.
- [X] **`CLOUDFLARE_API_TOKEN`:** an account-owned token (_Manage Account → Account API Tokens → Create Token → Custom token_). Under **Account Resources**, include this account; a zones scope fails with _"Failed common permission check"_. **Account** permissions (the dashboard may say _Write_ for _Edit_):
  - Workers Scripts: Edit
  - Hyperdrive: Edit
  - Workers R2 Storage: Edit (not used yet; added now so the token doesn't need re-issuing when WP-1.x adds buckets)
  - Account Settings: Read
  - Durable Objects and Workflows have no permission of their own; they deploy under Workers Scripts.
  - No **User** permissions: wrangler only needs them to discover the account, and CI always sets `CLOUDFLARE_ACCOUNT_ID`. `scripts/ci.mjs` calls only `/accounts/<id>/…` endpoints.
- [X] **Neon project.** Create it in the region closest to your Cloudflare users. Its default branch (usually `main`) is **production**. Keep the default database `neondb` and role `neondb_owner`, or set the `NEON_DATABASE` / `NEON_ROLE` env in the workflow.
- [X] **`NEON_PROJECT_ID`:** a repo **variable** (not a secret), e.g. `cool-name-123456`, from _Project settings → General_.
- **Neon's GitHub integration** (_Neon project → Integrations → GitHub_) sets both for you, `NEON_API_KEY` as a secret and `NEON_PROJECT_ID` as a variable. The workflow follows its convention so the integration can re-sync them without breaking deploys.
- [X] **`NEON_API_KEY`:** _Account settings → API keys_. A project-scoped key is enough.

- [X] **Google OAuth client** (Google Cloud Console → Google Auth Platform). Needed from WP-1.1.
  - **Audience:** External, publishing status _Testing_, with yourself under **Test users**. Publish before anyone else signs in.
  - **Data access (scopes):** `openid`, `userinfo.email`, `userinfo.profile`.
  - **Client** (type: Web application):

    | Authorized JavaScript origins | Authorized redirect URIs |
    |---|---|
    | `https://learn.umbel.dev` | `https://learn.umbel.dev/api/auth/callback/google` |
    | `https://umbel-learn.michael-shafir.workers.dev` | `https://umbel-learn.michael-shafir.workers.dev/api/auth/callback/google` |
    | `http://localhost:8787` | `http://localhost:8787/api/auth/callback/google` |
    | `http://localhost:5173` | `http://localhost:5173/api/auth/callback/google` |

    Previews are not listed: Google allows no wildcards, so previews sign in through production with Better Auth's OAuth proxy plugin (WP-1.1). The workers.dev row is only needed while `PRODUCTION_DOMAIN` is unset (below).
  - **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` (session signing; generate it without seeing it: `openssl rand -base64 32 | gh secret set BETTER_AUTH_SECRET -R mshafir/umbel-learn`).

- [X] **Production domain (optional):** `learn.umbel.dev`. Unset, production stays on `https://umbel-learn.<subdomain>.workers.dev`.
  - The zone (`umbel.dev`) must be **active on Cloudflare**: a Worker custom domain can't be reached by a CNAME from another DNS host. The domain stays registered with Google Cloud Domains; only its nameservers point at Cloudflare. Its mail (`mail.umbel.dev`, Resend) and `api.`/`app.` records are DNS only (not proxied).
  - Add **Zone** permissions for that zone to `CLOUDFLARE_API_TOKEN`: Zone: Read, DNS: Edit, Workers Routes: Edit.
  - Add the domain's origin and callback to the Google client (table above) **before** setting the variable, or sign-in breaks.
  - Then set the repo **variable** `PRODUCTION_DOMAIN=learn.umbel.dev`. The next production deploy attaches it as the Worker's custom domain (`ci.mjs custom-domain`, production only) and makes it `BETTER_AUTH_URL` and every preview's `AUTH_PROXY_URL`. The workers.dev URL keeps working.

- [X] **`AI_GATEWAY_API_KEY`:** a Vercel AI Gateway key (_Vercel dashboard → AI Gateway → API keys_), the hosted instance key (spec §5.1, §5.7). Needed from WP-3.3. Set a spend limit in Vercel: previews use it too, and per-user caps are phase 2.

- [X] **Email (Resend):** needed from WP-5.2. The domain `mail.umbel.dev` is verified in Resend; its DKIM, SPF (MX and TXT on `send.mail`) and `_dmarc.umbel.dev` records live in the Cloud DNS zone `umbel-dev`.
  - **`RESEND_API_KEY`:** a _Sending access_ key restricted to `mail.umbel.dev`.
  - **`EMAIL_FROM`** (a repo **variable**, not a secret): `Umbel Learn <invites@mail.umbel.dev>`.

When the Cloudflare and Neon secrets and the variable exist, the next PR push deploys a preview, and the next green CI run on `main` deploys production. Nothing else needs changing.

## How a preview works

On every PR push (`opened`, `synchronize`, `reopened`):

1. Build the SPA (`apps/web/dist`).
2. **Neon branch** `preview/pr-<n>`, created from the default branch by `neondatabase/create-branch-action` (reused if it exists). Each PR gets its own copy of the data, so parallel agents never share a database.
3. **Migrations:** `pnpm --filter @umbel/server db:migrate` applies the committed drizzle-kit migrations (`packages/server/drizzle`) to the branch's direct (non-pooled) connection string. Already-applied migrations are skipped.
4. **Hyperdrive config** `umbel-pr-<n>`, created or updated to point at that branch's direct connection string, with caching off. `apps/worker/scripts/ci.mjs hyperdrive-upsert` does this through the Cloudflare API, then writes `apps/worker/wrangler.ci.json`: `wrangler.jsonc` with the real Hyperdrive id in place of the placeholder.
5. **URLs and secrets:** `ci.mjs worker-urls` reads the account's workers.dev subdomain, so the preview's URL (`https://umbel-pr-<n>.<subdomain>.workers.dev`) and production's are known before deploying. `ci.mjs secrets-file` writes `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the repo secrets to a mode-0600 JSON file in `$RUNNER_TEMP`. Their values are never printed.
6. **Deploy** `wrangler deploy --config wrangler.ci.json --name umbel-pr-<n> --secrets-file … --var DB_BRANCH:preview/pr-<n> --var BETTER_AUTH_URL:<preview URL> --var AUTH_PROXY_URL:<production URL> --var AUTH_TRUSTED_ORIGINS:https://umbel-pr-*.<subdomain>.workers.dev`. This is a separate Worker per PR, with its own bindings. The secrets upload with the deploy, and the file is deleted when the step ends.
7. **Check** `GET /api/health` until it answers. It returns `{"ok":true,"db":"neondb","branch":"preview/pr-<n>"}`: `db` comes from `select current_database()` through Hyperdrive, and `branch` names the Neon branch.
8. **Check sign-in:** `apps/worker/scripts/check-signin.mjs` starts a Google sign-in and checks that it redirects to Google with **production's** callback as `redirect_uri` (the OAuth proxy, below).
9. **Comment** the URL, the health response and the sign-in check on the PR. It's one comment, updated on every push.

On **close** (merged or not), the teardown job deletes, in order, the Worker, the Hyperdrive config and the Neon branch. It then edits the comment to say so. Each delete is a no-op if the resource is already gone, so closing a PR opened before the secrets existed is safe.

**Production:** when CI passes on a push to `main`, the `production` job checks out that exact commit. It looks up the Neon default branch and its connection string (Neon API), applies the migrations to it, upserts the Hyperdrive config `umbel-production`, and runs `wrangler deploy` (Worker name `umbel-learn`, from `wrangler.jsonc`) with the same secrets file and `BETTER_AUTH_URL` = `AUTH_PROXY_URL` = its own URL. It then checks `/api/health` and the sign-in redirect. It runs in the `production` GitHub environment, so you can add required reviewers there.

**Migrations** run before the Hyperdrive step in both jobs, against the branch's direct `db_url` (never through Hyperdrive). Generate a new one after changing `packages/domain/src/schema.ts` with `mise exec -- pnpm --filter @umbel/server db:generate`, and commit it. A migration that fails stops the deploy, so the Worker never runs code ahead of its schema. Previews start from a copy of production, so a PR's migration is tested against real data before it reaches `main`.

## Sign-in (Better Auth)

Workers get these, in addition to `DB_BRANCH`:

| Name | Kind | Preview | Production | Local (`apps/worker/.dev.vars`) |
|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | secret | repo secret | repo secret | any random string |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | repo secret | repo secret | the same client |
| `BETTER_AUTH_URL` | var | its own URL | its own URL | `http://localhost:8787` (or `:5173`) |
| `AUTH_PROXY_URL` | var | production URL (`https://$PRODUCTION_DOMAIN` when set) | its own URL | unset |
| `AUTH_TRUSTED_ORIGINS` | var | `https://umbel-pr-*.<subdomain>.workers.dev` | same | unset |
| `AUTH_TEST_CREDENTIALS` | var | never set | never set | `1` only for API tests |

**Previews sign in through production.** Google allows no wildcard redirect URIs, and the Google client lists only production and localhost. Better Auth's [OAuth proxy plugin](https://www.better-auth.com/docs/plugins/oauth-proxy) handles this:

1. The preview starts sign-in with production's callback (`https://learn.umbel.dev/api/auth/callback/google`, or the workers.dev URL when `PRODUCTION_DOMAIN` is unset) as `redirect_uri`, and wraps its OAuth state, encrypted with `BETTER_AUTH_SECRET`.
2. Google calls production back. Production unwraps the state, exchanges the code, encrypts the profile and redirects to the preview's `/api/auth/callback/google/oauth-proxy`. Production writes nothing to its own database.
3. The preview decrypts the profile (it must be under 60 seconds old and match the state it stored), creates the user and session in its own Neon branch, and sets its cookie.

This only works because every Worker has the **same** `BETTER_AUTH_SECRET`, and production trusts the preview origins. Only this Cloudflare account can deploy to `*.<subdomain>.workers.dev`. Production runs the plugin too (`AUTH_PROXY_URL` is its own URL, so it proxies nothing of its own). Previews must be under `umbel-pr-*`, which the workflow guarantees. `packages/server/src/app.test.ts` tests the round trip end to end, with Google's token endpoint stubbed.

**Test credentials** (email + password) exist only for the API e2e tests. They need `AUTH_TEST_CREDENTIALS=1` **and** a `BETTER_AUTH_URL` whose host is `localhost`, `127.0.0.1` or `[::1]` (`readConfig` in `packages/server/src/config.ts`). The deploy workflow never sets the flag, and even if someone set it on a Worker, its `https://…workers.dev` URL keeps them off. Unit tests check both.

**Owner click-tests** (need a real Google account): sign in on production, then on a preview (through the proxy). The preview PR comment shows the redirect check CI already ran.

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
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # then fill it in (gitignored)
# Any Postgres works. Migrate it, then point the HYPERDRIVE binding straight at it.
DATABASE_URL=postgres://user:pass@localhost:5432/db mise exec -- pnpm --filter @umbel/server db:migrate
cd apps/worker
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://user:pass@localhost:5432/db \
  mise exec -- pnpm dev
curl localhost:8787/api/health   # {"ok":true,"db":"db","branch":"local"}
```

- **`apps/worker/.dev.vars`** holds the local auth settings (see `.dev.vars.example` and the table above). Wrangler reads it automatically; it is gitignored and never committed. Google sign-in works locally on `http://localhost:8787` directly, or on `http://localhost:5173` (`pnpm --filter web dev`, which proxies `/api` to 8787) with `BETTER_AUTH_URL=http://localhost:5173`.
- **API e2e tests** (`apps/web/e2e/api`): set `E2E_DATABASE_URL` to a migrated Postgres and run `mise exec -- pnpm --filter web exec playwright test --project=api`. Playwright starts `wrangler dev` on port 8788 with test credentials on. Without `E2E_DATABASE_URL` they are skipped locally; in CI a Postgres service container provides it.

- Other checks: `mise exec -- pnpm --filter web test:e2e` runs the Playwright smoke test (install Chromium once with `pnpm --filter web exec playwright install chromium`), and `mise exec -- pnpm --filter @umbel/worker bundle` does the same dry-run bundle as CI.
- The Worker's `typecheck` script runs `wrangler types` first. `worker-configuration.d.ts` is generated, not committed.

## Troubleshooting

- **"No workers.dev URL in the wrangler output":** the account has no workers.dev subdomain yet (see the checklist).
- **Hyperdrive API 403:** the token is missing _Hyperdrive: Edit_.
- **`/api/health` returns `{"ok":false,"db":"error"}`:** Hyperdrive can't reach the Neon branch. Check the Worker logs (observability is on) and the branch's compute status in Neon.
- **"Check sign-in" fails with a 503 `server not configured`:** a Worker secret or `BETTER_AUTH_URL` is missing. Check the three auth repo secrets exist.
- **Sign-in on a preview ends at `/api/auth/error?error=state_mismatch` or `invalid_profile`:** the preview and production have different `BETTER_AUTH_SECRET`s (redeploy both), or the round trip took over 60 seconds.
- **Google says `redirect_uri_mismatch`:** the Google client must list production's callback exactly (checklist above).
- **Leftovers after a failed teardown:** re-run the job, or delete `umbel-pr-<n>` (Worker and Hyperdrive config) and the Neon branch `preview/pr-<n>` by hand.

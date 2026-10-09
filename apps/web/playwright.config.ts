import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig, devices } from "@playwright/test"

// Not 4173: other dev servers often sit there. Override with E2E_PORT.
const PORT = Number(process.env.E2E_PORT ?? 4391)
// The Worker (`wrangler dev`) for API tests. Not 8787, the usual dev port.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8788)
const CI = !!process.env.CI
// A migrated Postgres for the API tests (CI: a service container). Without it
// the API tests are skipped locally; CI fails instead (see e2e/auth.spec.ts).
const DATABASE_URL = process.env.E2E_DATABASE_URL
// Which entry serves the API and app tests: the Worker (`wrangler dev`, the
// default) or the Node entry (`E2E_SERVER=node`: apps/server-node, WP-6.1).
const NODE = process.env.E2E_SERVER === "node"

// Test-only settings, the same for both entries. AUTH_TEST_CREDENTIALS turns
// on email + password sign-in through the API; the server ignores it on any
// non-localhost URL. AI_KEY_MODE byok (e2e/app/settings.spec.ts) with a
// test-only master key (32 bytes, base64).
const TEST_VARS = {
  BETTER_AUTH_URL: `http://localhost:${API_PORT}`,
  BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
  AUTH_TEST_CREDENTIALS: "1",
  DB_BRANCH: "e2e",
  AI_KEY_MODE: "byok",
  AI_KEYS_MASTER_KEY: "ZTJlLW9ubHktbWFzdGVyLWtleS0zMi1ieXRlcy1sb24=",
}

const workerServer = {
  command: [
    "pnpm --filter @seply/worker exec wrangler dev",
    `--port ${API_PORT}`,
    ...Object.entries(TEST_VARS).map(([k, v]) => `--var ${k}:${v}`),
  ].join(" "),
  env: {
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: DATABASE_URL!,
    WRANGLER_SEND_METRICS: "false",
  },
}

// The Node entry, as self-hosters run it, plus email + password sign-in on
// (its default) and Google configured with dummy credentials, so the sign-in
// screen shows both. Blobs go to a fresh temp dir.
const nodeServer = () => ({
  command: "pnpm --filter @seply/server-node start",
  env: {
    ...TEST_VARS,
    DATABASE_URL: DATABASE_URL!,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    GOOGLE_CLIENT_ID: "e2e-dummy.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "e2e-dummy",
    BLOB_DIR: mkdtempSync(join(tmpdir(), "seply-e2e-blobs-")),
    SHUTDOWN_GRACE_SECONDS: "2",
  },
})

// UI tests run against the production build (`vite build` + `vite preview`),
// in light and dark. API tests run against the Worker (or, with
// E2E_SERVER=node, the Node entry) with a real database, and so do the app
// tests (e2e/app): the server serves the same build and the API on one
// origin, in light and dark.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // One browser at a time locally: builders share a laptop (see CLAUDE.md, "Resources").
  workers: CI ? undefined : 1,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-light",
      testIgnore: /(api|app)\//,
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "chromium-dark",
      testIgnore: /(api|app)\//,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    {
      name: "app-light",
      testMatch: /app\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        baseURL: `http://localhost:${API_PORT}`,
      },
    },
    {
      name: "app-dark",
      testMatch: /app\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        baseURL: `http://localhost:${API_PORT}`,
      },
    },
    {
      name: "api",
      testMatch: /api\/.*\.spec\.ts/,
      use: { baseURL: `http://localhost:${API_PORT}` },
    },
  ],
  webServer: [
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // Always our own fresh build; never test whatever else holds the port.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // Started after the build above (both entries serve apps/web/dist).
    ...(DATABASE_URL
      ? [
          {
            ...(NODE ? nodeServer() : workerServer),
            url: `http://localhost:${API_PORT}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]
      : []),
  ],
})

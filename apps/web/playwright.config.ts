import { defineConfig, devices } from "@playwright/test"

// Not 4173: other dev servers often sit there. Override with E2E_PORT.
const PORT = Number(process.env.E2E_PORT ?? 4391)
// The Worker (`wrangler dev`) for API tests. Not 8787, the usual dev port.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8788)
const CI = !!process.env.CI
// A migrated Postgres for the API tests (CI: a service container). Without it
// the API tests are skipped locally; CI fails instead (see e2e/auth.spec.ts).
const DATABASE_URL = process.env.E2E_DATABASE_URL

// UI tests run against the production build (`vite build` + `vite preview`),
// in light and dark. API tests run against the Worker with a real database,
// and so do the app tests (e2e/app): the Worker serves the same build and the
// API on one origin, in light and dark.
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
    // Started after the build above (the Worker serves apps/web/dist).
    ...(DATABASE_URL
      ? [
          {
            // Test-only settings. AUTH_TEST_CREDENTIALS turns on email + password
            // sign-in; the server ignores it on any non-localhost URL.
            command: [
              "pnpm --filter @umbel/worker exec wrangler dev",
              `--port ${API_PORT}`,
              `--var BETTER_AUTH_URL:http://localhost:${API_PORT}`,
              "--var BETTER_AUTH_SECRET:e2e-only-secret-not-used-anywhere-else",
              "--var AUTH_TEST_CREDENTIALS:1",
              "--var DB_BRANCH:e2e",
            ].join(" "),
            url: `http://localhost:${API_PORT}/api/health`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
              CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
                DATABASE_URL,
              WRANGLER_SEND_METRICS: "false",
            },
          },
        ]
      : []),
  ],
})

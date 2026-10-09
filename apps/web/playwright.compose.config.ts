// The self-host smoke test (WP-6.2): e2e/compose against an instance that's
// already running, normally `docker compose up` (scripts/compose-smoke.sh
// starts it, runs this and checks the bucket). No web servers of its own.
//
//   COMPOSE_URL=http://localhost:3000 pnpm --filter web exec playwright test -c playwright.compose.config.ts
import { defineConfig, devices } from "@playwright/test"

const CI = !!process.env.CI

export default defineConfig({
  testDir: "./e2e/compose",
  forbidOnly: CI,
  retries: 0,
  workers: 1,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.COMPOSE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
})

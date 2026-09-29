import { defineConfig, devices } from "@playwright/test"

// Not 4173: other dev servers often sit there. Override with E2E_PORT.
const PORT = Number(process.env.E2E_PORT ?? 4391)
const CI = !!process.env.CI

// Runs against the production build (`vite build` + `vite preview`), in light and dark.
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
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "chromium-dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
  ],
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always our own fresh build; never test whatever else holds the port.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

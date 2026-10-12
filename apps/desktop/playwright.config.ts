import { defineConfig } from "@playwright/test"

// Drives the built Electron app (e2e/). One at a time: it is a whole browser.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 60_000,
})

// Screenshot tests of the dev harness. Not part of `pnpm check`: run with
// `pnpm --filter @seply/views test:e2e` (needs Playwright's Chromium). CI
// runs it in the Playwright job (.github/workflows/ci.yml).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } },
  webServer: {
    command: "vite --port 5199",
    port: 5199,
    reuseExistingServer: true,
  },
});

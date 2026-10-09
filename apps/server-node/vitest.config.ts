import { defineConfig } from "vitest/config"

// The database tests (jobs, instances) need TEST_DATABASE_URL and skip
// without it; each makes a database of its own, so files may run in parallel.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 120_000 },
})

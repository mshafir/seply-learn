import { defineConfig } from "vitest/config"

// Unit tests for the shell's pure rules (src/). The shell page has none.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
})

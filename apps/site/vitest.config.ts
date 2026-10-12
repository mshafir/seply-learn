import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/build.ts"],
    // Three Astro builds run first.
    hookTimeout: 180_000,
  },
})

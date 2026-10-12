import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/build.ts"],
    // The Examples' counts: the last known ones, never the network.
    env: { SITE_COUNTS: "offline" },
    // Three Astro builds run first.
    hookTimeout: 180_000,
  },
})

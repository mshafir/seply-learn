import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/build.ts"],
    // The Examples' counts: the last known ones, never the network.
    // The desktop downloads: no GitHub API, the Releases page fallback.
    env: { SITE_COUNTS: "offline", SITE_RELEASES: "offline" },
    // Three Astro builds run first.
    hookTimeout: 180_000,
  },
})

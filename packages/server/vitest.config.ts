import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Each test starts PGlite, migrates and signs people up (scrypt): seconds
    // on a busy runner, past Vitest's 5 s default.
    testTimeout: 30_000,
  },
})

// The Node entry's command line:
//
//   node --experimental-transform-types src/main.ts [serve]   (the default)
//   node --experimental-transform-types src/main.ts migrate
//
// `serve` validates the env (see README.md), applies migrations unless
// MIGRATE_ON_START=0, and serves until SIGTERM or SIGINT, then shuts down
// gracefully. `migrate` only applies migrations (DATABASE_URL), then exits.
import { ConfigError } from "@seply/server"
import { readNodeConfig } from "./env.ts"
import { runMigrations } from "./migrate.ts"
import { startServer } from "./server.ts"

const command = process.argv[2] ?? "serve"

async function main() {
  if (command === "migrate") {
    const url = process.env.DATABASE_URL?.trim()
    if (!url) throw new ConfigError("DATABASE_URL is not set")
    await runMigrations(url)
    console.log("migrate: up to date")
    return
  }
  if (command !== "serve") {
    console.error(`unknown command: ${command} (serve or migrate)`)
    process.exit(2)
  }
  const config = readNodeConfig()
  const server = await startServer(config)
  console.log(
    `seply-learn: listening on http://${config.host}:${server.port} (${config.server.baseURL})`
  )
  let stopping = false
  const stop = (signal: string) => {
    if (stopping) {
      // A second signal: don't wait any longer.
      process.exit(1)
    }
    stopping = true
    console.log(`seply-learn: ${signal}, shutting down`)
    server.close().then(
      () => process.exit(0),
      (err) => {
        console.error("shutdown failed", err)
        process.exit(1)
      }
    )
  }
  process.on("SIGTERM", () => stop("SIGTERM"))
  process.on("SIGINT", () => stop("SIGINT"))
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message)
    process.exit(78) // EX_CONFIG
  }
  console.error(err)
  process.exit(1)
})

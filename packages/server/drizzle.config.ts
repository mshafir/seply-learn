// drizzle-kit config. The schema lives in @seply/domain; the migrations it
// generates are committed here (./drizzle) and CI applies them before each
// deploy (docs/ops/deploy.md).
//   pnpm --filter @seply/server db:generate          after changing the schema
//   DATABASE_URL=… pnpm --filter @seply/server db:migrate
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "../domain/src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
})

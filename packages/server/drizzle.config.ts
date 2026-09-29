// drizzle-kit config. The schema lives in @umbel/domain; the migrations it
// generates are committed here (./drizzle) and CI applies them before each
// deploy (docs/ops/deploy.md).
//   pnpm --filter @umbel/server db:generate          after changing the schema
//   DATABASE_URL=… pnpm --filter @umbel/server db:migrate
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "../domain/src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
})

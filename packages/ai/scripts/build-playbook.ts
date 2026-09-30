// Regenerates src/playbook/generated.ts from playbook/*.md and
// docs/view-types/*.md. Run after changing either:
//
//   pnpm --filter @seply/ai playbook
//
// src/playbook/playbook.test.ts fails while the generated file is stale.
import { writeFileSync } from "node:fs"
import { generatedModule } from "../src/playbook/source.ts"
import { playbookInputs } from "../src/playbook/read.ts"

const out = new URL("../src/playbook/generated.ts", import.meta.url)
writeFileSync(out, generatedModule(playbookInputs()))
console.log(`wrote ${out.pathname}`)

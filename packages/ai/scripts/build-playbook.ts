// Regenerates src/playbook/generated.ts from playbook/*.md,
// docs/view-types/*.md and the seply-learn skill's SKILL.md, and the skill's
// references/ (copies of the playbook and View Type files it bundles). Run
// after changing any of them:
//
//   pnpm --filter @seply/ai playbook
//
// src/playbook/playbook.test.ts fails while the generated file is stale.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { generatedModule, skillReferences } from "../src/playbook/source.ts"
import { playbookInputs, skillReferencesDir } from "../src/playbook/read.ts"

const inputs = playbookInputs()
const out = new URL("../src/playbook/generated.ts", import.meta.url)
writeFileSync(out, generatedModule(inputs))
console.log(`wrote ${out.pathname}`)

const refs = skillReferencesDir()
rmSync(refs, { recursive: true, force: true })
for (const [path, md] of Object.entries(skillReferences(inputs))) {
  const file = new URL(path, refs)
  mkdirSync(new URL(".", file), { recursive: true })
  writeFileSync(file, md)
}
console.log(`wrote ${refs.pathname}`)

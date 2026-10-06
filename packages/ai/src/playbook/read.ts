// Reads the playbook's inputs from disk. Node only (the script and tests);
// not exported from the package.
import { readdirSync, readFileSync } from "node:fs"

const root = new URL("../../../../", import.meta.url)

export function playbookInputs(): {
  skim: string
  viewTypes: Record<string, string>
  playbook: Record<string, string>
  skill: string
} {
  const pb = new URL("packages/ai/playbook/", root)
  const playbook: Record<string, string> = {}
  for (const name of readdirSync(pb))
    if (name.endsWith(".md")) playbook[name] = readFileSync(new URL(name, pb), "utf8")
  const dir = new URL("docs/view-types/", root)
  const viewTypes: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".md"))
      viewTypes[name] = readFileSync(new URL(name, dir), "utf8")
  }
  return {
    skim: readFileSync(new URL("packages/ai/playbook/skim.md", root), "utf8"),
    viewTypes,
    playbook,
    skill: readFileSync(new URL(`${SKILL_DIR}/SKILL.md`, root), "utf8"),
  }
}

/** The `seply-learn` skill's folder, from the repo root. */
export const SKILL_DIR = "plugins/seply-learn/skills/seply-learn"

/** The skill's references/ folder on disk. */
export const skillReferencesDir = () => new URL(`${SKILL_DIR}/references/`, root)

/** Every file under the skill's references/ (path → markdown), as committed. */
export function committedSkillReferences(): Record<string, string> {
  const dir = skillReferencesDir()
  const out: Record<string, string> = {}
  const walk = (sub: string) => {
    let names: string[]
    try {
      names = readdirSync(new URL(sub, dir))
    } catch {
      return
    }
    for (const name of names) {
      const rel = `${sub}${name}`
      if (name.endsWith(".md")) out[rel] = readFileSync(new URL(rel, dir), "utf8")
      else if (!name.includes(".")) walk(`${rel}/`)
    }
  }
  walk("")
  return out
}

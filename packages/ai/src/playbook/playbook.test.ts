import { VIEW_TYPE_IDS } from "@seply/domain"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SKIM_PROMPT, VIEW_TYPE_CATALOG } from "./generated.ts"
import { committedSkillReferences, playbookInputs } from "./read.ts"
import { buildCatalog, generatedModule, promptText, skillReferences, skillText } from "./source.ts"

describe("the playbook", () => {
  it("generated.ts matches playbook/ and docs/view-types (run `pnpm --filter @seply/ai playbook`)", () => {
    const committed = readFileSync(new URL("./generated.ts", import.meta.url), "utf8")
    expect(committed).toBe(generatedModule(playbookInputs()))
  })

  it("the seply-learn skill's references match playbook/ and docs/view-types (run `pnpm --filter @seply/ai playbook`)", () => {
    expect(committedSkillReferences()).toEqual(skillReferences(playbookInputs()))
  })

  it("mirrors the skill, without its front matter, as the MCP server's instructions", () => {
    const md = playbookInputs().skill
    expect(md).toMatch(/^---\nname: seply-learn\ndescription: .+\n---\n/)
    expect(skillText(md).startsWith("# Seply Learn")).toBe(true)
    expect(skillText("---\nname: x\n---\n\n# Body\n")).toBe("# Body")
  })

  it("offers every proven and experimental View Type, and only domain View Types", () => {
    const ids = VIEW_TYPE_CATALOG.map((e) => e.id)
    expect(ids).toEqual([...VIEW_TYPE_IDS].sort())
    for (const e of VIEW_TYPE_CATALOG) {
      expect(e.answers).not.toBe("")
      expect(e.drawsOn).toMatch(/Kinds|Relationship/)
      expect(e.fromSource.length).toBeGreaterThan(40)
    }
    // "proven (idea); …" counts as proven.
    expect(VIEW_TYPE_CATALOG.find((e) => e.id === "map")?.status).toBe("proven")
  })

  it("never offers candidates or the template", () => {
    const catalog = buildCatalog({
      "_template.md": "---\nid: x\nname: X\nstatus: proven\nanswers: a\n---\n",
      "README.md": "# View Types",
      "funnel.md": "---\nid: funnel\nname: Funnel\nstatus: candidate\nanswers: a\n---\n",
    })
    expect(catalog).toEqual([])
  })

  it("strips the file's leading comment from the prompt", () => {
    expect(promptText("<!--\nnote\n-->\n# Skim\n\nbody\n")).toBe("# Skim\n\nbody")
    expect(SKIM_PROMPT.startsWith("# Skim: propose Views")).toBe(true)
    expect(SKIM_PROMPT).toContain("4–8 Views")
  })
})

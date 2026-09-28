import { describe, expect, it } from "vitest"
import type { Visibility } from "./common.ts"
import { OP_KINDS } from "./ops.ts"
import {
  ACTIONS,
  actionForOp,
  can,
  canPropose,
  type Action,
} from "./permissions.ts"

const owner = { role: "owner", signedIn: true } as const
const editor = { role: "editor", signedIn: true } as const
const viewer = { role: "viewer", signedIn: true } as const
const stranger = { role: null, signedIn: true } as const
const anonymous = { role: null, signedIn: false } as const

// Spec §1.8, row by row: [action, owner, editor, viewer].
const MATRIX: [Action, boolean, boolean, boolean][] = [
  ["read", true, true, true],
  ["fork", true, true, true],
  ["edit", true, true, false],
  ["manageSources", true, true, false],
  ["merge", true, true, false],
  ["deleteConcept", true, true, false],
  ["useAi", true, true, false],
  ["reviewProposals", true, true, false],
  ["viewHistory", true, true, false],
  ["undo", true, true, false],
  ["restore", true, true, false],
  ["invite", true, true, false],
  ["changeRole", true, false, false],
  ["removeCollaborator", true, false, false],
  ["changeVisibility", true, false, false],
  ["transferOwnership", true, false, false],
  ["trashExpedition", true, false, false],
  ["restoreExpedition", true, false, false],
]

describe("permissions matrix", () => {
  it("covers every action", () => {
    expect(MATRIX.map(([a]) => a).sort()).toEqual([...ACTIONS].sort())
  })

  it.each(MATRIX)("%s: owner %s, editor %s, viewer %s", (action, o, e, v) => {
    expect(can(owner, action, "private")).toBe(o)
    expect(can(editor, action, "private")).toBe(e)
    expect(can(viewer, action, "private")).toBe(v)
  })

  it("anyone can read where Visibility allows; forking needs sign-in", () => {
    const cases: [Visibility, boolean][] = [
      ["private", false],
      ["unlisted", true],
      ["public", true],
    ]
    for (const [vis, ok] of cases) {
      expect(can(anonymous, "read", vis)).toBe(ok)
      expect(can(stranger, "read", vis)).toBe(ok)
      expect(can(anonymous, "fork", vis)).toBe(false)
      expect(can(stranger, "fork", vis)).toBe(ok)
      expect(can(stranger, "edit", vis)).toBe(false)
    }
    expect(can({ role: "viewer", signedIn: false }, "fork", "private")).toBe(
      false
    )
  })

  it("agents inherit the role but only write Proposals", () => {
    const agent = { ...editor, agent: { allowed: true } }
    expect(can(agent, "read", "private")).toBe(true)
    expect(can(agent, "edit", "private")).toBe(false)
    expect(can(agent, "reviewProposals", "private")).toBe(false)
    expect(canPropose(agent, "private")).toBe(true)
    expect(canPropose({ ...viewer, agent: { allowed: true } }, "public")).toBe(
      false
    )
    // A token restricted to other Expeditions can do nothing here.
    expect(
      can({ ...owner, agent: { allowed: false } }, "read", "private")
    ).toBe(false)
    expect(canPropose({ ...owner, agent: { allowed: false } }, "private")).toBe(
      false
    )
  })

  it("maps every op kind to an action", () => {
    for (const k of OP_KINDS) expect(ACTIONS).toContain(actionForOp(k))
    expect(actionForOp("concept.delete")).toBe("deleteConcept")
    expect(actionForOp("source.add")).toBe("manageSources")
    expect(actionForOp("view.set")).toBe("edit")
  })
})

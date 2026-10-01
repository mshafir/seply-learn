import type { KeptEdit } from "@seply/domain"
import { describe, expect, it } from "vitest"

import type { ChangeSummary } from "@/lib/api.ts"
import {
  changeMeta,
  keptMessage,
  relativeTime,
  restoreLabel,
  undoLabel,
} from "./history.ts"

const NOW = Date.parse("2026-09-30T12:00:00Z")
const change: ChangeSummary = {
  id: "ch1",
  author: { id: "ana", name: "Ana", image: null },
  origin: "human",
  label: "Accepted 12 suggestions",
  at: "2026-09-30T10:00:00Z",
  firstSeq: 3,
  lastSeq: 9,
}

const kept = (actor?: string): KeptEdit => ({
  entity: "concept",
  id: "c1",
  field: "summary",
  current: "x",
  ...(actor ? { by: { actor, changeId: "chX", serverSeq: 12 } } : {}),
})

describe("History copy", () => {
  it("says who and when", () => {
    expect(changeMeta(change, null, NOW)).toBe("Ana · 2h ago")
    expect(changeMeta(change, "ana", NOW)).toBe("You · 2h ago")
    expect(relativeTime("2026-09-30T11:59:30Z", NOW)).toBe("just now")
    expect(relativeTime("2026-09-30T11:55:00Z", NOW)).toBe("5m ago")
    expect(relativeTime("2026-09-27T12:00:00Z", NOW)).toBe("3d ago")
    expect(relativeTime("2026-08-01T12:00:00Z", NOW)).toMatch(/2026/)
  })

  it("labels the Changes undo and restore make", () => {
    expect(undoLabel(change)).toBe("Undid “Accepted 12 suggestions”")
    expect(restoreLabel(change)).toBe("Restored to “Accepted 12 suggestions”")
  })

  it("reports kept edits with who changed them since", () => {
    const names = new Map([
      ["ana", "Ana"],
      ["ben", "Ben"],
      ["cy", "Cy"],
    ])
    const nameOf = (id: string) => names.get(id) ?? null
    expect(keptMessage([], nameOf)).toBeNull()
    expect(keptMessage([kept("ana")], nameOf)).toBe(
      "1 edit kept: changed since by Ana"
    )
    expect(keptMessage([kept("ana"), kept("ana")], nameOf)).toBe(
      "2 edits kept: changed since by Ana"
    )
    expect(keptMessage([kept("ana"), kept("ben"), kept("cy")], nameOf)).toBe(
      "3 edits kept: changed since by Ana, Ben and Cy"
    )
    expect(keptMessage([kept("zed"), kept()], nameOf)).toBe(
      "2 edits kept: changed since by someone else"
    )
  })
})

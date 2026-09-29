import { describe, expect, it } from "vitest"
import {
  applyMarks,
  coveredConcepts,
  emptyReaderState,
  mergeBatches,
  ReaderBatch,
  stateToBatch,
  type ReadingMark,
} from "./reader.ts"

const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, s)).toISOString()
const read = (
  conceptId: string,
  state: ReadingMark["state"],
  s: number
): ReadingMark => ({ expeditionId: "e1", conceptId, state, at: at(s) })

describe("reader marks", () => {
  it("the newest mark wins; a tie keeps what is there", () => {
    let st = applyMarks(
      emptyReaderState(),
      { reading: [read("a", "read", 2)] },
      "e1"
    )
    st = applyMarks(st, { reading: [read("a", "unread", 1)] }, "e1")
    expect(st.reading.a!.state).toBe("read")
    st = applyMarks(st, { reading: [read("a", "known", 2)] }, "e1")
    expect(st.reading.a!.state).toBe("read")
    st = applyMarks(st, { reading: [read("a", "known", 3)] }, "e1")
    expect(st.reading.a!.state).toBe("known")
  })

  it("ignores other Expeditions' marks, returning the same state", () => {
    const st = emptyReaderState()
    const other = { ...read("a", "read", 1), expeditionId: "e2" }
    expect(applyMarks(st, { reading: [other] }, "e1")).toBe(st)
  })

  it("keeps the newest position and View settings", () => {
    const pos = (s: number, viewId: string) => ({
      expeditionId: "e1",
      viewId,
      focusConceptId: null,
      step: null,
      panelDepth: null,
      at: at(s),
    })
    const st = applyMarks(
      emptyReaderState(),
      { positions: [pos(2, "v2"), pos(1, "v1")] },
      "e1"
    )
    expect(st.position!.viewId).toBe("v2")
    const vs = applyMarks(
      st,
      {
        viewSettings: [
          {
            expeditionId: "e1",
            viewId: "v1",
            settings: { hideRead: true },
            at: at(1),
          },
        ],
      },
      "e1"
    )
    expect(vs.viewSettings.v1!.settings).toEqual({ hideRead: true })
    expect(stateToBatch(vs).positions).toHaveLength(1)
  })

  it("merges batches, newest per key", () => {
    const a = ReaderBatch.parse({
      reading: [read("a", "read", 1), read("b", "known", 5)],
    })
    const b = ReaderBatch.parse({
      reading: [read("a", "known", 2), read("b", "unread", 4)],
    })
    const m = mergeBatches(a, b)
    expect(
      Object.fromEntries(m.reading.map((r) => [r.conceptId, r.state]))
    ).toEqual({ a: "known", b: "known" })
  })

  it("read and known are both covered; unread is not", () => {
    const st = applyMarks(
      emptyReaderState(),
      {
        reading: [
          read("a", "read", 1),
          read("b", "known", 1),
          read("c", "unread", 1),
        ],
      },
      "e1"
    )
    expect([...coveredConcepts(st)].sort()).toEqual(["a", "b"])
  })

  it("rejects bad marks", () => {
    const bad = (reading: unknown) =>
      ReaderBatch.safeParse({ reading: [reading] }).success
    expect(bad({ ...read("a", "read", 1), at: "yesterday" })).toBe(false)
    expect(bad({ ...read("a", "read", 1), state: "seen" })).toBe(false)
    expect(bad(read("a", "read", 1))).toBe(true)
  })
})

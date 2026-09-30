// Committed fixtures, imported the way a first build is, for the checks' tests.
import {
  importExpeditionJson,
  ulidSequence,
  type ImportResult,
} from "@seply/domain"
import compute from "@seply/domain/fixtures/compute.json" with { type: "json" }
import research from "@seply/domain/fixtures/research-doc.json" with { type: "json" }

export const T0 = Date.parse("2026-09-01T00:00:00Z")

export function load(file: unknown, expeditionId = "e1"): ImportResult {
  let n = 0
  return importExpeditionJson(file, {
    expeditionId,
    actor: "u",
    changeId: "c1",
    nextOpId: ulidSequence(T0),
    newId: () => `id${n++}`,
    at: "2026-09-01T00:00:00Z",
  })
}

export const loadCompute = () => load(compute)
export const loadResearch = () => load(research)

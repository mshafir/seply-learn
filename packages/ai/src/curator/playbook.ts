// The curator's instructions, assembled from the playbook (spec §5.4) and the
// View Type definitions. The files live in playbook/ and docs/view-types/;
// src/playbook/generated.ts carries them as strings (`pnpm --filter @seply/ai playbook`).
import type { ViewTypeId } from "@seply/domain"
import { NOTE_INSTRUCTIONS } from "../estimate.ts"
import { PLAYBOOK_FILES, VIEW_TYPE_DOCS } from "../playbook/generated.ts"

/** A playbook file by name: `_contract`, `skim`, `extract`, `merge`, `build-view`, `write`. */
export function playbook(name: string): string {
  const text = PLAYBOOK_FILES[name]
  if (text === undefined) throw new Error(`no playbook file ${name}.md`)
  return text
}

/** A View Type's definition (docs/view-types/<id>.md). */
export function viewTypeDoc(viewType: ViewTypeId): string {
  const text = VIEW_TYPE_DOCS[viewType]
  if (text === undefined) throw new Error(`no View Type definition for ${viewType}`)
  return text
}

const join = (...parts: string[]) => parts.join("\n\n---\n\n")

/** The understanding note (spec §5.2 step 3.2): kept in the job, never shown. */
export const noteInstructions = () => NOTE_INSTRUCTIONS

/** Building the Concept set (whole Sources, or one chunk). */
export const conceptInstructions = () =>
  join(playbook("_contract"), playbook("extract"))

/** The merge-and-tidy pass after the last chunk. */
export const mergeInstructions = () =>
  join(playbook("_contract"), playbook("extract"), playbook("merge"))

/**
 * Building one View. The View Type's definition goes in the task, not here,
 * so every View shares one cached prefix.
 */
export const viewInstructions = () =>
  join(playbook("_contract"), playbook("build-view"))

/** One Grow ask (spec §5.5): the contract and the Grow playbook. */
export const growInstructions = () =>
  join(playbook("_contract"), playbook("grow"))

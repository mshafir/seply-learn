// The permissions matrix (spec §1.8) as code.
import type { Role, Visibility } from "./common.ts"
import type { OpKind } from "./ops.ts"

export const ACTIONS = [
  "read", // read, search, see Sources, export
  "fork",
  "edit", // Concepts, Relationships, Views (shared settings), Kinds, Relationship Types, Attributes
  "manageSources", // add or remove Sources
  "merge",
  "deleteConcept",
  "useAi", // Grow, Write the article
  "reviewProposals", // accept or dismiss
  "viewHistory",
  "undo", // undo any Change
  "restore", // restore to a point
  "invite", // invite editors and viewers
  "changeRole",
  "removeCollaborator",
  "changeVisibility",
  "transferOwnership", // to an existing editor
  "trashExpedition", // delete to Trash
  "restoreExpedition", // restore from Trash
] as const
export type Action = (typeof ACTIONS)[number]

/**
 * - `true`/`false`: the role may or may not.
 * - `'visibility'`: anyone may, where the Expedition's Visibility allows.
 * - `'signedIn'`: as `'visibility'`, and signed in.
 */
export type Grant = boolean | "visibility" | "signedIn"

/** Rows are actions, columns are roles. `none` is anyone who isn't a Collaborator. */
export const PERMISSIONS: Record<Action, Record<Role | "none", Grant>> = {
  read: { owner: true, editor: true, viewer: true, none: "visibility" },
  fork: { owner: true, editor: true, viewer: "signedIn", none: "signedIn" },
  edit: { owner: true, editor: true, viewer: false, none: false },
  manageSources: { owner: true, editor: true, viewer: false, none: false },
  merge: { owner: true, editor: true, viewer: false, none: false },
  deleteConcept: { owner: true, editor: true, viewer: false, none: false },
  useAi: { owner: true, editor: true, viewer: false, none: false },
  reviewProposals: { owner: true, editor: true, viewer: false, none: false },
  viewHistory: { owner: true, editor: true, viewer: false, none: false },
  undo: { owner: true, editor: true, viewer: false, none: false },
  restore: { owner: true, editor: true, viewer: false, none: false },
  invite: { owner: true, editor: true, viewer: false, none: false },
  changeRole: { owner: true, editor: false, viewer: false, none: false },
  removeCollaborator: {
    owner: true,
    editor: false,
    viewer: false,
    none: false,
  },
  changeVisibility: { owner: true, editor: false, viewer: false, none: false },
  transferOwnership: { owner: true, editor: false, viewer: false, none: false },
  trashExpedition: { owner: true, editor: false, viewer: false, none: false },
  restoreExpedition: { owner: true, editor: false, viewer: false, none: false },
}

/** Actions that write shared content. An agent (API token or MCP) never does these directly. */
const DIRECT_WRITES: ReadonlySet<Action> = new Set([
  "edit",
  "manageSources",
  "merge",
  "deleteConcept",
  "reviewProposals",
  "undo",
  "restore",
])

export type Actor = {
  /** The user's role on this Expedition, or null if not a Collaborator. */
  role: Role | null
  signedIn: boolean
  /**
   * Acting through an API token or MCP agent: inherits the user's role, may
   * be restricted to chosen Expeditions, and writes only Proposals (or a
   * first build via `create_expedition`, which is not an action here).
   */
  agent?: { allowed: boolean }
}

export function can(
  actor: Actor,
  action: Action,
  visibility: Visibility
): boolean {
  if (actor.agent && !actor.agent.allowed) return false
  if (actor.agent && DIRECT_WRITES.has(action)) return false
  const grant = PERMISSIONS[action][actor.role ?? "none"]
  if (typeof grant === "boolean") return grant
  const visible = actor.role !== null || visibility !== "private"
  return grant === "visibility" ? visible : visible && actor.signedIn
}

/** Whether the actor may write Proposals: an owner's or editor's agent, or the user. */
export function canPropose(actor: Actor, visibility: Visibility): boolean {
  if (actor.agent && !actor.agent.allowed) return false
  return can({ ...actor, agent: undefined }, "edit", visibility)
}

/** The action an op needs. */
export function actionForOp(kind: OpKind): Action {
  if (kind === "concept.delete" || kind === "concept.restore")
    return "deleteConcept"
  if (kind === "source.add" || kind === "source.remove") return "manageSources"
  return "edit"
}

// The Drizzle schema (spec §1.2). Postgres only in v1. The logged tables are
// a materialized projection of the op log; every row carries its
// Expedition's id, and entity ids are unique per Expedition.
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { PALETTE, type AttributeValue, type Prov } from "./common.ts"
import type { OpBody } from "./ops.ts"
import { VIEW_TYPE_IDS } from "./view-types.ts"

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" })
const exp = () => text("expedition_id").notNull()
/**
 * Better Auth's tables read and write Date objects (it compares expiry times
 * directly), so they use Drizzle's "date" mode. The SQL type is the same.
 */
const authTs = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" })

// --- Better Auth -----------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: authTs("created_at").notNull().defaultNow(),
  updatedAt: authTs("updated_at").notNull().defaultNow(),
})

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: authTs("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: authTs("created_at").notNull().defaultNow(),
  updatedAt: authTs("updated_at").notNull().defaultNow(),
})

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: authTs("access_token_expires_at"),
  refreshTokenExpiresAt: authTs("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: authTs("created_at").notNull().defaultNow(),
  updatedAt: authTs("updated_at").notNull().defaultNow(),
})

/** Better Auth's verification tokens (part of its core tables). */
export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: authTs("expires_at").notNull(),
  createdAt: authTs("created_at").notNull().defaultNow(),
  updatedAt: authTs("updated_at").notNull().defaultNow(),
})

/** API tokens (and MCP agents): inherit the user's role, optionally restricted to chosen Expeditions. */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  start: text("start"),
  keyHash: text("key_hash").notNull().unique(),
  expeditionIds: text("expedition_ids").array(),
  createdAt: authTs("created_at").notNull().defaultNow(),
  lastUsedAt: authTs("last_used_at"),
  expiresAt: authTs("expires_at"),
})

/** BYOK mode only. */
export const aiKeys = pgTable(
  "ai_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    last4: text("last4").notNull(),
    createdAt: authTs("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })]
)

/**
 * A reader's AI settings (spec §3.10): which of their keys builds use, model
 * overrides per provider and stage (BYOK mode), and the per-ask spending cap
 * (null: the default).
 */
export const aiSettings = pgTable("ai_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider"),
  models: jsonb("models")
    .$type<Record<string, Partial<Record<string, string>>>>()
    .notNull()
    .default({}),
  askCapCents: integer("ask_cap_cents"),
  updatedAt: authTs("updated_at").notNull().defaultNow(),
})

// --- Expeditions (plain columns + logged fields) ---------------------------

export const expeditions = pgTable("expeditions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  visibility: text("visibility", { enum: ["private", "unlisted", "public"] })
    .notNull()
    .default("private"),
  forkedFrom: jsonb("forked_from").$type<{ exp: string; seq: number }>(),
  deletedAt: ts("deleted_at"),
  headSeq: bigint("head_seq", { mode: "number" }).notNull().default(0),
  // logged
  title: text("title").notNull().default(""),
  summary: text("summary").notNull().default(""),
  status: text("status", { enum: ["draft", "building", "ready"] })
    .notNull()
    .default("draft"),
  bestViewId: text("best_view_id"),
})

export const expeditionTags = pgTable(
  "expedition_tags",
  { expeditionId: exp(), tag: text("tag").notNull() },
  (t) => [primaryKey({ columns: [t.expeditionId, t.tag] })]
)

export const sources = pgTable(
  "sources",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    kind: text("kind", { enum: ["chat", "file", "prompt"] }).notNull(),
    title: text("title").notNull(),
    blobKey: text("blob_key"),
    segmentsKey: text("segments_key"),
    mime: text("mime"),
    size: bigint("size", { mode: "number" }),
    addedBy: text("added_by").notNull(),
    addedAt: ts("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

/**
 * Search (spec §2.8) adds trigger-maintained `search` tsvector columns here
 * and on `expeditions`, plus `concepts.search_title`, in
 * packages/server/drizzle/0001_search.sql. They are left out of this schema:
 * only search reads them, and nothing writes them but the triggers.
 */
export const concepts = pgTable(
  "concepts",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    aliases: text("aliases").array().notNull().default([]),
    kind: text("kind").notNull(),
    summary: text("summary"),
    overview: text("overview"),
    overviewProv: jsonb("overview_prov").$type<Prov>().notNull().default([]),
    attributes: jsonb("attributes")
      .$type<Record<string, AttributeValue>>()
      .notNull()
      .default({}),
    date: text("date"),
    dateEnd: text("date_end"),
    dateApprox: boolean("date_approx"),
    lane: text("lane"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    weightPin: text("weight_pin", { enum: ["core", "aux"] }),
    prov: jsonb("prov").$type<Prov>().notNull().default([]),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.id] }),
    index("concepts_title_idx").on(t.expeditionId, t.title),
  ]
)

export const articleSections = pgTable(
  "article_sections",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    conceptId: text("concept_id").notNull(),
    orderKey: text("order_key").notNull(),
    heading: text("heading").notNull().default(""),
    md: text("md").notNull().default(""),
    prov: jsonb("prov").$type<Prov>().notNull().default([]),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.id] }),
    index("article_sections_concept_idx").on(
      t.expeditionId,
      t.conceptId,
      t.orderKey
    ),
  ]
)

export const conceptTags = pgTable(
  "concept_tags",
  {
    expeditionId: exp(),
    conceptId: text("concept_id").notNull(),
    tag: text("tag").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.conceptId, t.tag] }),
    index("concept_tags_tag_idx").on(t.expeditionId, t.tag),
  ]
)

export const relationships = pgTable(
  "relationships",
  {
    expeditionId: exp(),
    from: text("from_id").notNull(),
    type: text("type").notNull(),
    to: text("to_id").notNull(),
    note: text("note"),
    prov: jsonb("prov").$type<Prov>().notNull().default([]),
    deletedAt: ts("deleted_at"),
    /** The Concept whose delete tombstoned this Relationship (restoring it brings it back). */
    deletedWith: text("deleted_with"),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.from, t.type, t.to] }),
    index("relationships_to_idx").on(t.expeditionId, t.to),
  ]
)

const palette = PALETTE

/** Custom Kinds, and rows hiding a built-in (label null). */
export const kindDefs = pgTable(
  "kind_defs",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    label: text("label"),
    color: text("color", { enum: palette }),
    icon: text("icon"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

export const relTypeDefs = pgTable(
  "rel_type_defs",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    label: text("label"),
    inverseLabel: text("inverse_label"),
    color: text("color", { enum: palette }),
    dashed: boolean("dashed"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

export const attributeDefs = pgTable(
  "attribute_defs",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    label: text("label").notNull(),
    type: text("type", {
      enum: ["text", "number", "money", "bool", "enum"],
    }).notNull(),
    unit: text("unit"),
    enumValues: text("enum_values").array(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

export const views = pgTable(
  "views",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    viewType: text("view_type", { enum: VIEW_TYPE_IDS }).notNull(),
    label: text("label").notNull(),
    question: text("question"),
    orderKey: text("order_key").notNull(),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    settingsVersion: integer("settings_version").notNull().default(1),
    status: text("status", { enum: ["queued", "building", "ready", "failed"] })
      .notNull()
      .default("queued"),
    failReason: text("fail_reason"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

// --- History ---------------------------------------------------------------

export const changes = pgTable(
  "changes",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    author: text("author").notNull(),
    origin: text("origin", {
      enum: ["human", "build", "ai", "mcp", "import", "restore", "merge"],
    }).notNull(),
    label: text("label").notNull(),
    firstSeq: bigint("first_seq", { mode: "number" }).notNull(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull(),
    at: ts("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

/** The op log. An op's actor is its Change's author. */
export const ops = pgTable(
  "ops",
  {
    expeditionId: exp(),
    serverSeq: bigint("server_seq", { mode: "number" }).notNull(),
    opId: text("op_id").notNull(),
    changeId: text("change_id").notNull(),
    clientSeq: integer("client_seq").notNull(),
    schemaV: integer("schema_v").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    path: text("path"),
    value: jsonb("value"),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.serverSeq] }),
    uniqueIndex("ops_op_id_idx").on(t.expeditionId, t.opId),
    index("ops_change_idx").on(t.expeditionId, t.changeId),
  ]
)

// --- Proposals -------------------------------------------------------------

export const proposals = pgTable(
  "proposals",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    author: text("author").notNull(),
    origin: text("origin", { enum: ["ai", "mcp"] }).notNull(),
    rationale: text("rationale").notNull(),
    status: text("status", {
      enum: ["pending", "partly", "accepted", "rejected", "withdrawn"],
    })
      .notNull()
      .default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.expeditionId, t.id] })]
)

export const proposalItems = pgTable(
  "proposal_items",
  {
    expeditionId: exp(),
    id: text("id").notNull(),
    proposalId: text("proposal_id").notNull(),
    ops: jsonb("ops").$type<OpBody[]>().notNull(),
    /** The values the item expected to replace, by field. */
    base: jsonb("base").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", {
      enum: ["pending", "accepted", "dismissed", "stale"],
    })
      .notNull()
      .default("pending"),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.id] }),
    index("proposal_items_proposal_idx").on(t.expeditionId, t.proposalId),
  ]
)

// --- Sharing (plain rows, not logged) --------------------------------------

export const collaborators = pgTable(
  "collaborators",
  {
    expeditionId: exp(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.userId] }),
    index("collaborators_user_idx").on(t.userId),
  ]
)

export const trash = pgTable("trash", {
  expeditionId: text("expedition_id").primaryKey(),
  deletedBy: text("deleted_by").notNull(),
  purgeAfter: ts("purge_after").notNull(),
})

// --- Per-reader state (outside the log) ------------------------------------

export const readingStatus = pgTable(
  "reading_status",
  {
    userId: text("user_id").notNull(),
    expeditionId: exp(),
    conceptId: text("concept_id").notNull(),
    state: text("state", { enum: ["unread", "read", "known"] }).notNull(),
    at: ts("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.expeditionId, t.conceptId] })]
)

export const personalViewSettings = pgTable(
  "personal_view_settings",
  {
    userId: text("user_id").notNull(),
    expeditionId: exp(),
    viewId: text("view_id").notNull(),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    at: ts("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.expeditionId, t.viewId] })]
)

export const readerPosition = pgTable(
  "reader_position",
  {
    userId: text("user_id").notNull(),
    expeditionId: exp(),
    viewId: text("view_id"),
    focusConceptId: text("focus_concept_id"),
    step: integer("step"),
    panelDepth: text("panel_depth"),
    at: ts("at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.expeditionId] }),
    index("reader_position_recent_idx").on(t.userId, t.at),
  ]
)

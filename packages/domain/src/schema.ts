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

/**
 * Personal API tokens (spec §2.6, WP-5.4): Better Auth's API key plugin
 * (`@better-auth/api-key`) owns the rows. `referenceId` is the user; only the
 * key's hash is stored. `permissions` holds the token's scopes as
 * `{"mcp": ["expeditions:read", …]}` and `metadata` its restriction to chosen
 * Expeditions (`{"expeditions": [ids]}`, absent: every Expedition the user
 * can see). A token inherits its user's role and writes only Proposals (or a
 * first build).
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: authTs("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: authTs("last_request"),
    expiresAt: authTs("expires_at"),
    createdAt: authTs("created_at").notNull(),
    updatedAt: authTs("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (t) => [
    index("api_keys_reference_id_idx").on(t.referenceId),
    uniqueIndex("api_keys_key_idx").on(t.key),
  ]
)

// --- MCP OAuth (Better Auth's `@better-auth/mcp`, WP-5.4) ----------------------
// The OAuth 2.1 authorization server's tables (`@better-auth/oauth-provider`,
// which `mcp()` builds on) and the JWT plugin's signing keys. Better Auth owns
// the rows; the shapes follow its schema for 1.7.

/** The JWT plugin's signing keys (access tokens are JWTs; `/jwks` serves the public halves). */
export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: authTs("created_at").notNull(),
  expiresAt: authTs("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
})

/** OAuth clients: MCP clients known by their Client ID Metadata Document URL (CIMD). */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes")
      .array()
      .default([]),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: authTs("created_at"),
    updatedAt: authTs("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required"
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (t) => [index("oauth_clients_user_id_idx").on(t.userId)]
)

/** Protected resources (the `/mcp` endpoint). */
export const oauthResources = pgTable("oauth_resources", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean(
    "dpop_bound_access_tokens_required"
  ).default(false),
  disabled: boolean("disabled").default(false),
  createdAt: authTs("created_at"),
  updatedAt: authTs("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
})

export const oauthClientResources = pgTable(
  "oauth_client_resources",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: authTs("created_at"),
  },
  (t) => [
    uniqueIndex("oauth_client_resources_client_resource_uidx").on(
      t.clientId,
      t.resourceId
    ),
    index("oauth_client_resources_resource_id_idx").on(t.resourceId),
  ]
)

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: authTs("expires_at"),
    createdAt: authTs("created_at"),
    revoked: authTs("revoked"),
    rotatedAt: authTs("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: authTs("rotation_replay_expires_at"),
    authTime: authTs("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    index("oauth_refresh_tokens_client_id_idx").on(t.clientId),
    index("oauth_refresh_tokens_user_id_idx").on(t.userId),
    index("oauth_refresh_tokens_authorization_code_id_idx").on(
      t.authorizationCodeId
    ),
  ]
)

export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: authTs("expires_at"),
    createdAt: authTs("created_at"),
    revoked: authTs("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    index("oauth_access_tokens_client_id_idx").on(t.clientId),
    index("oauth_access_tokens_user_id_idx").on(t.userId),
    index("oauth_access_tokens_refresh_id_idx").on(t.refreshId),
  ]
)

/** What a user agreed to give an OAuth client (the consent screen). */
export const oauthConsents = pgTable(
  "oauth_consents",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: authTs("created_at"),
    updatedAt: authTs("updated_at"),
  },
  (t) => [
    index("oauth_consents_client_id_idx").on(t.clientId),
    index("oauth_consents_user_id_idx").on(t.userId),
  ]
)

/** Replay protection for client assertions. */
export const oauthClientAssertions = pgTable("oauth_client_assertions", {
  id: text("id").primaryKey(),
  expiresAt: authTs("expires_at").notNull(),
})

/**
 * An OAuth grant's restriction to chosen Expeditions (spec §6.1: chosen at
 * consent). One row per user and client; no row, or null ids, means every
 * Expedition the user can see. Ours, not Better Auth's.
 */
export const agentGrants = pgTable(
  "agent_grants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    expeditionIds: text("expedition_ids").array(),
    updatedAt: authTs("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clientId] })]
)

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
    /** Its place in the Proposal (the order the items were suggested in). */
    position: integer("position").notNull().default(0),
    ops: jsonb("ops").$type<OpBody[]>().notNull(),
    /**
     * The values the item expected to replace, by field key (`proposalBase`;
     * null: unset). Stale is computed against it, never stored.
     */
    base: jsonb("base").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", {
      enum: ["pending", "accepted", "dismissed", "stale"],
    })
      .notNull()
      .default("pending"),
    /** The Change that accepted it (undoing that Change makes it pending again). */
    changeId: text("change_id"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
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
    /** Who invited them (null for the owner who created it). */
    invitedBy: text("invited_by"),
    addedAt: ts("added_at").notNull().defaultNow(),
    /**
     * When they first opened it; null shows the Library's New badge under
     * "Shared with you" (spec §3.9). The creating owner's is set at once.
     */
    seenAt: ts("seen_at"),
  },
  (t) => [
    primaryKey({ columns: [t.expeditionId, t.userId] }),
    index("collaborators_user_idx").on(t.userId),
  ]
)

/**
 * An invite to an Expedition as editor or viewer (spec §3.9), by email. The
 * link carries a random token; only its SHA-256 is stored. It is accepted
 * once: by whoever opens the link signed in, or by the account with that
 * (verified) email when it signs in. Accepted invites are kept for the record.
 */
export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    expeditionId: exp(),
    /** Lower-cased. */
    email: text("email").notNull(),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: ts("accepted_at"),
  },
  (t) => [
    index("invites_expedition_idx").on(t.expeditionId),
    index("invites_email_idx").on(t.email),
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

// --- Jobs and notifications (plain rows, not logged; spec §2.5) -------------

/**
 * Long server work (builds, writers, the test job): one row per job. The
 * runtime's own state (the Workflow instance, later a pg-boss job) holds the
 * step checkpoints; this row is what the API reads and what the room's
 * `build` events summarise. A View's build status is its own logged field.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    expeditionId: exp(),
    kind: text("kind").notNull(),
    input: jsonb("input").$type<unknown>().notNull().default({}),
    startedBy: text("started_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "paused", "complete", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    /** What it is doing now, in plain words. */
    step: text("step"),
    progress: doublePrecision("progress").notNull().default(0),
    /** A plain failure reason, when failed. */
    error: text("error"),
    /** How many times it was started: 1, then one more per retry. */
    attempt: integer("attempt").notNull().default(1),
    /** How many times the reader chose Continue at the spending cap. */
    capRaises: integer("cap_raises").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_expedition_idx").on(t.expeditionId, t.status)]
)

/**
 * A job attempt's recorded step results on Node (spec §2.5; the pg-boss
 * engine in apps/server-node). Workflows keep their own on Cloudflare. Once a
 * step has a row, a replay of that attempt returns its result instead of
 * running it again; a retry is a new attempt and starts from the top.
 */
export const jobSteps = pgTable(
  "job_steps",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    name: text("name").notNull(),
    /** The step's JSON result (null is a result too). */
    result: jsonb("result").$type<unknown>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.attempt, t.name] })]
)

/** A browser's web push subscription (per user; asked on "Leave it building"). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The browser's P-256 public key and auth secret, base64url. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)]
)

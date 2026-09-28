import { z } from "zod"

/** Colours are palette names, never hex, so dark mode works (spec §1.2). */
export const PALETTE = [
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "violet",
  "indigo",
  "slate",
  "brown",
  "olive",
] as const
export const PaletteColor = z.enum(PALETTE)
export type PaletteColor = z.infer<typeof PaletteColor>

export const Visibility = z.enum(["private", "unlisted", "public"])
export type Visibility = z.infer<typeof Visibility>

export const Role = z.enum(["owner", "editor", "viewer"])
export type Role = z.infer<typeof Role>

export const ExpeditionStatus = z.enum(["draft", "building", "ready"])
export type ExpeditionStatus = z.infer<typeof ExpeditionStatus>

export const SourceKind = z.enum(["chat", "file", "prompt"])
export type SourceKind = z.infer<typeof SourceKind>

export const WeightPin = z.enum(["core", "aux"])
export type WeightPin = z.infer<typeof WeightPin>

export const AttributeType = z.enum(["text", "number", "money", "bool", "enum"])
export type AttributeType = z.infer<typeof AttributeType>

export const ViewStatus = z.enum(["queued", "building", "ready", "failed"])
export type ViewStatus = z.infer<typeof ViewStatus>

export const ChangeOrigin = z.enum([
  "human",
  "build",
  "ai",
  "mcp",
  "import",
  "restore",
  "merge",
])
export type ChangeOrigin = z.infer<typeof ChangeOrigin>

export const ProposalOrigin = z.enum(["ai", "mcp"])
export const ProposalStatus = z.enum([
  "pending",
  "partly",
  "accepted",
  "rejected",
  "withdrawn",
])
export const ProposalItemStatus = z.enum([
  "pending",
  "accepted",
  "dismissed",
  "stale",
])

export const ReadingState = z.enum(["unread", "read", "known"])
export type ReadingState = z.infer<typeof ReadingState>

/**
 * An entity id. Client-generated (ULIDs in the product; the committed sample
 * keeps its readable ids). `|` is reserved as the Relationship key separator
 * and `.` as the settings path separator.
 */
export const Id = z
  .string()
  .min(1)
  .regex(/^[^|.\s]+$/, 'ids may not contain "|", "." or whitespace')

/** A provenance ref. An empty list means background knowledge. */
export const ProvRef = z.strictObject({
  source: z.string().min(1),
  segment: z.string().min(1),
  quote: z.string().optional(),
})
export type ProvRef = z.infer<typeof ProvRef>
export const Prov = z.array(ProvRef)
export type Prov = z.infer<typeof Prov>

/** Date precision is the string's: "1987", "2026-11", "2026-11-03". */
export const DateString = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
export const DateEnd = z.union([DateString, z.literal("ongoing")])

export const AttributeValue = z.union([z.string(), z.number(), z.boolean()])
export type AttributeValue = z.infer<typeof AttributeValue>

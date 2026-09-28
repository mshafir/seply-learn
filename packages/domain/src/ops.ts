// Op kinds (spec §1.3) as Zod schemas. An op is an envelope plus a body
// `{kind, target, path?, value?}`. `value: null` unsets an optional field.
import { z } from "zod"
import {
  AttributeType,
  AttributeValue,
  DateEnd,
  DateString,
  ExpeditionStatus,
  Id,
  PaletteColor,
  Prov,
  SourceKind,
  ViewStatus,
  WeightPin,
} from "./common.ts"
import { isBuiltinId } from "./builtins.ts"
import { ULID_RE } from "./ulid.ts"
import { ViewTypeId, parseSharedSettings } from "./view-types.ts"

/** The current op schema version. The server upgrades older ops on replay. */
export const SCHEMA_V = 1

export const OpEnvelope = z.object({
  opId: z.string().regex(ULID_RE, "op ids are ULIDs"),
  expeditionId: Id,
  actor: z.string().min(1),
  changeId: z.string().min(1),
  clientSeq: z.number().int().min(0),
  schemaV: z.number().int().min(1),
})
export type OpEnvelope = z.infer<typeof OpEnvelope>

const Tag = z.string().trim().min(1)
const OrderKey = z.string().regex(/^[0-9a-z]*[1-9a-z]$/, "fractional index key")
const RelKeyString = z
  .string()
  .regex(/^[^|.\s]+\|[^|.\s]+\|[^|.\s]+$/, "from|type|to")
const LinkId = Id.refine((id) => !isBuiltinId(id), "built-in ids are reserved")

// --- field schemas: what each settable path accepts -----------------------

type Fields = Record<string, z.ZodType>
const nullable = (f: Fields): Fields =>
  Object.fromEntries(Object.entries(f).map(([k, s]) => [k, s.nullable()]))

export const EXPEDITION_FIELDS = {
  title: z.string(),
  summary: z.string(),
  status: ExpeditionStatus,
  bestViewId: Id.nullable(),
} satisfies Fields

/** Concept fields settable by `concept.set`; the optional ones accept null (unset). */
export const CONCEPT_FIELDS = {
  title: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  kind: Id,
  overviewProv: Prov,
  prov: Prov,
  ...nullable({
    summary: z.string(),
    overview: z.string(),
    date: DateString,
    dateEnd: DateEnd,
    dateApprox: z.boolean(),
    lane: z.string(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    weightPin: WeightPin,
  }),
} satisfies Fields
export type ConceptField = keyof typeof CONCEPT_FIELDS
export const ATTRIBUTE_PATH_PREFIX = "attributes."

export const SECTION_FIELDS = {
  heading: z.string(),
  md: z.string(),
  prov: Prov,
} satisfies Fields
export const RELATIONSHIP_FIELDS = {
  note: z.string().nullable(),
  prov: Prov,
} satisfies Fields
export const VIEW_FIELDS = {
  label: z.string().min(1),
  question: z.string().nullable(),
  status: ViewStatus,
  failReason: z.string().nullable(),
  settingsVersion: z.number().int().min(1),
} satisfies Fields
export const SETTINGS_PATH = "settings"

function checkPath(
  fields: Fields,
  extra?: (path: string, value: unknown, ctx: z.RefinementCtx) => boolean
) {
  return (op: { path: string; value?: unknown }, ctx: z.RefinementCtx) => {
    if (extra?.(op.path, op.value, ctx)) return
    const schema = fields[op.path]
    if (!schema) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: `unknown path "${op.path}"`,
      })
      return
    }
    const r = schema.safeParse(op.value)
    if (!r.success) {
      for (const issue of r.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: ["value", ...issue.path.map(String)],
          message: issue.message,
        })
      }
    }
  }
}

// --- values ----------------------------------------------------------------

export const ConceptCreateValue = z.strictObject({
  title: z.string().min(1),
  kind: Id,
  aliases: z.array(z.string().min(1)).optional(),
  tags: z.array(Tag).optional(),
  summary: z.string().optional(),
  overview: z.string().optional(),
  overviewProv: Prov.optional(),
  attributes: z.record(Id, AttributeValue).optional(),
  date: DateString.optional(),
  dateEnd: DateEnd.optional(),
  dateApprox: z.boolean().optional(),
  lane: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  weightPin: WeightPin.optional(),
  prov: Prov.optional(),
})
export type ConceptCreateValue = z.infer<typeof ConceptCreateValue>

export const SectionCreateValue = z.strictObject({
  conceptId: Id,
  orderKey: OrderKey,
  heading: z.string(),
  md: z.string(),
  prov: Prov.optional(),
})

export const RelationshipAddValue = z.strictObject({
  note: z.string().optional(),
  prov: Prov.optional(),
})

export const KindDefineValue = z.strictObject({
  label: z.string().min(1),
  color: PaletteColor,
  icon: z.string().optional(),
})

export const RelTypeDefineValue = z.strictObject({
  label: z.string().min(1),
  inverseLabel: z.string().min(1),
  color: PaletteColor,
  dashed: z.boolean().optional(),
})

export const AttributeDefineValue = z
  .strictObject({
    label: z.string().min(1),
    type: AttributeType,
    unit: z.string().optional(),
    enumValues: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (v) => v.type !== "enum" || (v.enumValues && v.enumValues.length > 0),
    {
      message: "an enum Attribute needs enumValues",
    }
  )

export const ViewCreateValue = z
  .strictObject({
    viewType: ViewTypeId,
    label: z.string().min(1),
    question: z.string().optional(),
    orderKey: OrderKey,
    settings: z.record(z.string(), z.unknown()),
    settingsVersion: z.number().int().min(1).optional(),
    status: ViewStatus.optional(),
    failReason: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const r = parseSharedSettings(v.viewType, v.settings)
    if (!r.success) {
      for (const issue of r.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: ["settings", ...issue.path.map(String)],
          message: issue.message,
        })
      }
    }
  })

export const SourceAddValue = z.strictObject({
  kind: SourceKind,
  title: z.string().min(1),
  blobKey: z.string().optional(),
  segmentsKey: z.string().optional(),
  mime: z.string().optional(),
  size: z.number().int().min(0).optional(),
  addedBy: z.string().min(1),
  addedAt: z.iso.datetime(),
})

// --- bodies ----------------------------------------------------------------

const body = <K extends string, S extends z.core.$ZodLooseShape>(
  kind: K,
  shape: S
) => z.strictObject({ kind: z.literal(kind), target: Id, ...shape })

export const OpBody = z.discriminatedUnion("kind", [
  body("expedition.set", { path: z.string(), value: z.unknown() }).superRefine(
    checkPath(EXPEDITION_FIELDS)
  ),
  body("expedition.tag.add", { value: Tag }),
  body("expedition.tag.remove", { value: Tag }),

  body("concept.create", { value: ConceptCreateValue }),
  body("concept.set", { path: z.string(), value: z.unknown() }).superRefine(
    checkPath(CONCEPT_FIELDS, (path, value, ctx) => {
      if (!path.startsWith(ATTRIBUTE_PATH_PREFIX)) return false
      const attr = path.slice(ATTRIBUTE_PATH_PREFIX.length)
      if (!Id.safeParse(attr).success)
        ctx.addIssue({
          code: "custom",
          path: ["path"],
          message: "bad Attribute id",
        })
      if (!AttributeValue.nullable().safeParse(value).success) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "bad Attribute value",
        })
      }
      return true
    })
  ),
  body("concept.delete", {}),
  body("concept.restore", {}),
  body("concept.tag.add", { value: Tag }),
  body("concept.tag.remove", { value: Tag }),

  body("section.create", { value: SectionCreateValue }),
  body("section.set", { path: z.string(), value: z.unknown() }).superRefine(
    checkPath(SECTION_FIELDS)
  ),
  body("section.move", { value: OrderKey }),
  body("section.delete", {}),

  z.strictObject({
    kind: z.literal("relationship.add"),
    target: RelKeyString,
    value: RelationshipAddValue,
  }),
  z
    .strictObject({
      kind: z.literal("relationship.set"),
      target: RelKeyString,
      path: z.string(),
      value: z.unknown(),
    })
    .superRefine(checkPath(RELATIONSHIP_FIELDS)),
  z.strictObject({
    kind: z.literal("relationship.remove"),
    target: RelKeyString,
  }),

  z.strictObject({
    kind: z.literal("kind.define"),
    target: LinkId,
    value: KindDefineValue,
  }),
  body("kind.hide", { value: z.boolean() }),
  z.strictObject({
    kind: z.literal("reltype.define"),
    target: LinkId,
    value: RelTypeDefineValue,
  }),
  body("reltype.hide", { value: z.boolean() }),
  body("attribute.define", { value: AttributeDefineValue }),
  body("attribute.delete", {}),

  body("view.create", { value: ViewCreateValue }),
  body("view.set", { path: z.string(), value: z.unknown() }).superRefine(
    checkPath(VIEW_FIELDS, (path, _value, ctx) => {
      if (path !== SETTINGS_PATH && !path.startsWith(`${SETTINGS_PATH}.`))
        return false
      if (path.split(".").some((seg) => seg === "")) {
        ctx.addIssue({
          code: "custom",
          path: ["path"],
          message: "empty settings path segment",
        })
      }
      return true // validated against the View Type's schema in `apply`
    })
  ),
  body("view.move", { value: OrderKey }),
  body("view.delete", {}),

  body("source.add", { value: SourceAddValue }),
  body("source.remove", {}),
])
export type OpBody = z.infer<typeof OpBody>
export type OpKind = OpBody["kind"]

export const OP_KINDS = OpBody.options.map(
  (o) => o.shape.kind.value
) as OpKind[]

export const Op = z.intersection(OpEnvelope, OpBody)
export type Op = OpEnvelope & OpBody

/** Validates an op (envelope and body). */
export const parseOp = (input: unknown) => Op.safeParse(input)
export const parseOpBody = (input: unknown) => OpBody.safeParse(input)

/** Envelope factory: wraps bodies into ops of one Change. */
export function makeOps(
  bodies: readonly OpBody[],
  env: {
    expeditionId: string
    actor: string
    changeId: string
    nextOpId: () => string
    firstClientSeq?: number
  }
): Op[] {
  let seq = env.firstClientSeq ?? 0
  return bodies.map((b) => ({
    opId: env.nextOpId(),
    expeditionId: env.expeditionId,
    actor: env.actor,
    changeId: env.changeId,
    clientSeq: seq++,
    schemaV: SCHEMA_V,
    ...b,
  }))
}

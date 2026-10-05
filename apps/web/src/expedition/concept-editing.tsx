// Editing in place (spec §3.7, WP-4.5), for owners and editors: the Concept
// panel's "Edit" mode (fields, Attributes, Relationships, article sections)
// and its actions menu: "Merge with…", re-parenting in the open View ("Just
// this View" or "Everywhere"), sibling order and hiding in that View.
//
// - Field edits go through the sync collections, so the client coalesces
//   them into Changes ("Edited Attention").
// - Merge, re-parent, order and hide are @seply/domain commands, each
//   proposed as one Change of its own with a label (`Editing.commit`).
// - Layouts are always computed: structure only ever changes through
//   Relationships and the View's `placement` / `order` / `hide` overrides.
import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CombineIcon,
  EllipsisIcon,
  EyeOffIcon,
  FolderInputIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  hideInView,
  keyBetween,
  mergeConcepts,
  orderInView,
  parentInView,
  relKey,
  reparent,
  ulid,
  type AttributeValue,
  type OpBody,
  type ReparentScope,
} from "@seply/domain"
import { Button } from "@seply/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@seply/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@seply/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@seply/ui/components/select"
import { Textarea } from "@seply/ui/components/textarea"
import { toast } from "@seply/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@seply/ui/components/toggle-group"
import type {
  ArticleSectionRow,
  ConceptRow,
  SyncClient,
  ViewRow,
} from "@seply/sync"

import {
  hasStructure,
  kindVocabulary,
  parentCandidates,
  parseList,
  parseTags,
  placeInView,
  relTypeVocabulary,
} from "@/expedition/editing.ts"
import { ConceptMarkdownEditor } from "@/expedition/markdown-field.tsx"
import { relTypeLabels } from "@/expedition/reading.ts"
import { refused } from "@/expedition/refused.ts"
import type { ExpeditionData } from "@/expedition/use-expedition-data.ts"

/** What editing needs from the screen (owners and editors, online). */
export type Editing = {
  client: SyncClient
  data: ExpeditionData
  /** The View on the canvas: re-parent, order and hide apply to it. */
  view: ViewRow | undefined
  /** Proposes the ops of one Change (a Merge, a re-parent…); false, with a toast, when refused. */
  commit: (ops: readonly OpBody[], label: string, origin?: "merge") => boolean
  /** After a Merge: the reader's status follows, the panel shows the survivor. */
  onMerged: (survivorId: string, loserId: string) => void
}

/** Runs a collection edit; a refusal (now, or when it persists) is a toast. */
function mutate(title: string, run: () => unknown) {
  try {
    const tx = run() as { isPersisted?: { promise: Promise<unknown> } } | void
    tx?.isPersisted?.promise.catch((e: unknown) => refused(title, e))
  } catch (e) {
    refused(title, e)
  }
}

const viewName = (view: ViewRow) => view.label || "this View"

// ─── The actions menu ──────────────────────────────────────────────────────

/** "Edit" / "Done", and the ⋯ menu: Merge with…, Move…, order, hide. */
export function ConceptEditActions({
  concept,
  editing,
  editMode,
  onEditMode,
}: {
  concept: ConceptRow
  editing: Editing
  editMode: boolean
  onEditMode: (on: boolean) => void
}) {
  const [dialog, setDialog] = React.useState<"merge" | "move" | null>(null)
  const { client, view } = editing
  const state = client.engine.state
  const place = view ? placeInView(state, view.id, concept.id) : null
  const at = place ? place.siblings.indexOf(concept.id) : -1
  const structured = !!view && hasStructure(state, view.id)

  const move = (by: number) => {
    if (!view || !place) return
    const ops = orderInView(
      client.engine.state.views[view.id]!,
      place.parentId,
      place.siblings,
      concept.id,
      at + by
    )
    editing.commit(ops, `Reordered ${viewName(view)}`)
  }
  const hide = () => {
    if (!view) return
    const v = client.engine.state.views[view.id]!
    if (
      editing.commit(
        hideInView(v, concept.id, true),
        `Hid ${concept.title} in ${viewName(view)}`
      )
    )
      toast.add({
        title: `Hid ${concept.title} in ${viewName(view)}`,
        description: "Show it again from the View's panel.",
      })
  }

  return (
    <>
      <Button
        variant={editMode ? "default" : "ghost"}
        size="sm"
        aria-pressed={editMode}
        data-testid="concept-edit"
        onClick={() => onEditMode(!editMode)}
      >
        {editMode ? <CheckIcon /> : <PencilIcon />}
        {editMode ? "Done" : "Edit"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
              data-testid="concept-actions"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onClick={() => setDialog("merge")}>
            <CombineIcon />
            Merge with…
          </DropdownMenuItem>
          {view && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>In {viewName(view)}</DropdownMenuLabel>
                {structured && (
                  <DropdownMenuItem onClick={() => setDialog("move")}>
                    <FolderInputIcon />
                    Move under…
                  </DropdownMenuItem>
                )}
                {place && (
                  <>
                    <DropdownMenuItem
                      disabled={at <= 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUpIcon />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={at < 0 || at >= place.siblings.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDownIcon />
                      Move down
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={hide}>
                  <EyeOffIcon />
                  Hide from this View
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "merge" && (
        <MergeDialog
          concept={concept}
          editing={editing}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "move" && view && (
        <ReparentDialog
          concept={concept}
          view={view}
          editing={editing}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

// ─── Picking a Concept ─────────────────────────────────────────────────────

function ConceptPicker({
  concepts,
  placeholder,
  onPick,
}: {
  concepts: readonly ConceptRow[]
  placeholder: string
  onPick: (id: string) => void
}) {
  const sorted = React.useMemo(
    () => [...concepts].sort((a, b) => a.title.localeCompare(b.title)),
    [concepts]
  )
  return (
    <Command className="rounded-lg! border" data-testid="concept-picker">
      <CommandInput placeholder={placeholder} autoFocus />
      <CommandList className="max-h-72">
        <CommandEmpty>No Concepts found.</CommandEmpty>
        {sorted.map((c) => (
          <CommandItem
            key={c.id}
            value={c.id}
            keywords={[c.title, ...c.aliases]}
            onSelect={() => onPick(c.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{c.title}</div>
              {c.summary && (
                <div className="truncate text-xs text-muted-foreground">
                  {c.summary}
                </div>
              )}
            </div>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}

// ─── Merge with… ───────────────────────────────────────────────────────────

function MergeDialog({
  concept,
  editing,
  onClose,
}: {
  concept: ConceptRow
  editing: Editing
  onClose: () => void
}) {
  const { data } = editing
  const [other, setOther] = React.useState<string | null>(null)
  const [keep, setKeep] = React.useState<string>(concept.id)
  const otherRow = data.concepts.find((c) => c.id === other)
  const survivor = keep === concept.id ? concept : otherRow
  const loser = keep === concept.id ? otherRow : concept
  const moving = loser
    ? data.relationships.filter((r) => r.from === loser.id || r.to === loser.id)
        .length
    : 0

  const merge = () => {
    if (!survivor || !loser) return
    let ops: OpBody[]
    try {
      ops = mergeConcepts(editing.client.engine.state, survivor.id, loser.id)
    } catch (e) {
      refused("Couldn't merge", e)
      return
    }
    if (
      editing.commit(
        ops,
        `Merged ${loser.title} into ${survivor.title}`,
        "merge"
      )
    ) {
      editing.onMerged(survivor.id, loser.id)
      toast.add({
        title: `Merged ${loser.title} into ${survivor.title}`,
        type: "success",
      })
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>Merge {concept.title} with…</DialogTitle>
          <DialogDescription>
            Two Concepts that are the same idea become one. The other's title
            stays as an alias.
          </DialogDescription>
        </DialogHeader>
        {!otherRow ? (
          <ConceptPicker
            concepts={data.concepts.filter((c) => c.id !== concept.id)}
            placeholder="Search Concepts"
            onPick={setOther}
          />
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>Keep</FieldLabel>
              <ToggleGroup
                aria-label="Keep"
                variant="outline"
                size="sm"
                spacing={0}
                value={[keep]}
                onValueChange={(v: unknown[]) => {
                  const next = v[0] as string | undefined
                  if (next) setKeep(next)
                }}
              >
                <ToggleGroupItem value={concept.id}>
                  {concept.title}
                </ToggleGroupItem>
                <ToggleGroupItem value={otherRow.id}>
                  {otherRow.title}
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription data-testid="merge-summary">
                {loser!.title} becomes an alias of {survivor!.title}.{" "}
                {moving === 1
                  ? "Its Relationship moves"
                  : `Its ${moving} Relationships move`}{" "}
                over, with its Tags and provenance, and every reader keeps the
                higher Reading status. One Change: History can undo it.
              </FieldDescription>
            </Field>
          </FieldGroup>
        )}
        <DialogFooter>
          {otherRow ? (
            <>
              <Button variant="outline" onClick={() => setOther(null)}>
                Back
              </Button>
              <Button onClick={merge} data-testid="merge-confirm">
                <CombineIcon />
                Merge
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Re-parent: "Just this View" or "Everywhere" ────────────────────────────

function ReparentDialog({
  concept,
  view,
  editing,
  onClose,
}: {
  concept: ConceptRow
  view: ViewRow
  editing: Editing
  onClose: () => void
}) {
  const { data, client } = editing
  const state = client.engine.state
  const [parent, setParent] = React.useState<string | null>(null)
  const byId = new Map(data.concepts.map((c) => [c.id, c]))
  const candidates = React.useMemo(
    () => new Set(parentCandidates(state, view.id, concept.id)),
    [state, view.id, concept.id]
  )
  const v = state.views[view.id]
  const current = v ? parentInView(state, v, concept.id) : undefined
  const parentRow = parent ? byId.get(parent) : undefined

  const apply = (scope: ReparentScope) => {
    if (!parentRow) return
    let ops: OpBody[]
    try {
      ops = reparent(
        client.engine.state,
        view.id,
        concept.id,
        parentRow.id,
        scope
      )
    } catch (e) {
      refused("Couldn't move it", e)
      return
    }
    const where = scope === "view" ? `in ${viewName(view)}` : "everywhere"
    if (ops.length === 0) {
      onClose()
      return
    }
    if (
      editing.commit(
        ops,
        `Moved ${concept.title} under ${parentRow.title} ${where}`
      )
    )
      onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="reparent-dialog">
        <DialogHeader>
          <DialogTitle>Move {concept.title} under…</DialogTitle>
          <DialogDescription>
            {current && byId.get(current)
              ? `Now under ${byId.get(current)!.title} in ${viewName(view)}.`
              : `Now at the top of ${viewName(view)}.`}
          </DialogDescription>
        </DialogHeader>
        {!parentRow ? (
          <ConceptPicker
            concepts={data.concepts.filter(
              (c) => candidates.has(c.id) && c.id !== current
            )}
            placeholder="Search for its new parent"
            onPick={setParent}
          />
        ) : (
          <p className="text-sm" data-testid="reparent-question">
            Move {concept.title} under <strong>{parentRow.title}</strong> just
            in {viewName(view)}, or everywhere its shared parent shows?
          </p>
        )}
        <DialogFooter>
          {parentRow ? (
            <>
              <Button variant="outline" onClick={() => setParent(null)}>
                Back
              </Button>
              <Button variant="outline" onClick={() => apply("everywhere")}>
                Everywhere
              </Button>
              <Button onClick={() => apply("view")}>Just this View</Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit mode: the overview's fields ──────────────────────────────────────

/** A text field that writes when it loses focus (or on Enter, single line). */
function TextField({
  label,
  value,
  onCommit,
  multiline,
  rows,
  description,
  placeholder,
  name,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  rows?: number
  description?: string
  placeholder?: string
  name: string
}) {
  const id = React.useId()
  const commit = (next: string) => {
    if (next !== value) onCommit(next)
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          // A change from elsewhere resets the field.
          key={value}
          id={id}
          name={name}
          rows={rows}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      ) : (
        <Input
          key={value}
          id={id}
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
        />
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

/** A markdown field: the rich editor, which writes when it loses focus. */
function MarkdownField({
  label,
  value,
  concepts,
  description,
  onCommit,
}: {
  label: string
  value: string
  concepts: readonly ConceptRow[]
  description?: string
  onCommit: (value: string) => void
}) {
  const id = React.useId()
  return (
    <Field>
      <FieldLabel id={`${id}-label`}>{label}</FieldLabel>
      <ConceptMarkdownEditor
        value={value}
        concepts={concepts}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        onCommit={onCommit}
      />
      {description && (
        <FieldDescription id={`${id}-description`}>
          {description}
        </FieldDescription>
      )}
    </Field>
  )
}

const UNSET = "__unset"

/** The overview depth in edit mode: fields, Attributes, Relationships. */
export function ConceptEditor({
  concept,
  editing,
}: {
  concept: ConceptRow
  editing: Editing
}) {
  const { client, data } = editing
  const concepts = client.collections.concepts
  const set = (title: string, write: (draft: ConceptRow) => void) =>
    mutate(title, () => concepts.update(concept.id, write))
  const state = client.engine.state
  const kinds = kindVocabulary(state).filter(
    (k) => !k.hidden || k.id === concept.kind
  )
  const optional = (v: string) => (v.trim() ? v : undefined)

  return (
    <form
      data-testid="concept-editor"
      className="flex flex-col gap-6"
      onSubmit={(e) => e.preventDefault()}
    >
      <FieldGroup>
        <TextField
          label="Title"
          name="title"
          value={concept.title}
          onCommit={(v) => {
            if (!v.trim()) return
            set("Couldn't rename it", (d) => {
              d.title = v.trim()
            })
          }}
        />
        <Field>
          <FieldLabel>Kind</FieldLabel>
          <Select
            items={kinds.map((k) => ({ value: k.id, label: k.label }))}
            value={concept.kind}
            onValueChange={(v) => {
              if (typeof v === "string" && v !== concept.kind)
                set("Couldn't change the Kind", (d) => {
                  d.kind = v
                })
            }}
          >
            <SelectTrigger aria-label="Kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <TextField
          label="Summary"
          name="summary"
          value={concept.summary ?? ""}
          multiline
          rows={2}
          description="One line."
          onCommit={(v) =>
            set("Couldn't save the summary", (d) => {
              d.summary = optional(v)
            })
          }
        />
        <MarkdownField
          label="Overview"
          value={concept.overview ?? ""}
          concepts={data.concepts}
          description="One deep paragraph. Link other Concepts from the toolbar."
          onCommit={(v) =>
            set("Couldn't save the overview", (d) => {
              d.overview = optional(v)
            })
          }
        />
        <TextField
          label="Also called"
          name="aliases"
          value={concept.aliases.join(", ")}
          placeholder="Other names, separated by commas"
          onCommit={(v) =>
            set("Couldn't save the aliases", (d) => {
              d.aliases = parseList(v)
            })
          }
        />
        <TextField
          label="Tags"
          name="tags"
          value={concept.tags.join(", ")}
          placeholder="#tag, #another"
          onCommit={(v) =>
            set("Couldn't save the Tags", (d) => {
              d.tags = parseTags(v)
            })
          }
        />
      </FieldGroup>
      <AttributeFields concept={concept} editing={editing} />
      <RelationshipEditor concept={concept} editing={editing} data={data} />
    </form>
  )
}

function AttributeFields({
  concept,
  editing,
}: {
  concept: ConceptRow
  editing: Editing
}) {
  const defs = editing.data.attributeDefs
  if (defs.length === 0) return null
  const write = (attrId: string, value: AttributeValue | undefined) =>
    mutate("Couldn't save the Attribute", () =>
      editing.client.collections.concepts.update(concept.id, (d) => {
        if (value === undefined) delete d.attributes[attrId]
        else d.attributes[attrId] = value
      })
    )
  return (
    <section aria-label="Attributes" className="flex flex-col gap-3">
      <h3 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        Attributes
      </h3>
      <FieldGroup className="gap-3">
        {defs.map((a) => {
          const value = concept.attributes[a.id]
          const label = a.unit ? `${a.label} (${a.unit})` : a.label
          if (a.type === "enum" || a.type === "bool") {
            const options =
              a.type === "bool"
                ? [
                    { value: "true", label: "Yes" },
                    { value: "false", label: "No" },
                  ]
                : (a.enumValues ?? []).map((v) => ({ value: v, label: v }))
            const items = [{ value: UNSET, label: "—" }, ...options]
            return (
              <Field key={a.id} orientation="horizontal">
                <FieldLabel className="flex-1">{label}</FieldLabel>
                <Select
                  items={items}
                  value={value === undefined ? UNSET : String(value)}
                  onValueChange={(v) =>
                    write(
                      a.id,
                      v === UNSET || v == null
                        ? undefined
                        : a.type === "bool"
                          ? v === "true"
                          : String(v)
                    )
                  }
                >
                  <SelectTrigger aria-label={a.label} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )
          }
          const numeric = a.type === "number" || a.type === "money"
          return (
            <Field key={a.id} orientation="horizontal">
              <FieldLabel className="flex-1">{label}</FieldLabel>
              <Input
                key={String(value ?? "")}
                aria-label={a.label}
                className="w-40"
                type={numeric ? "number" : "text"}
                defaultValue={value === undefined ? "" : String(value)}
                onBlur={(e) => {
                  const raw = e.currentTarget.value.trim()
                  const next = raw ? (numeric ? Number(raw) : raw) : undefined
                  if (numeric && next !== undefined && !Number.isFinite(next))
                    return
                  if (next !== value) write(a.id, next)
                }}
              />
            </Field>
          )
        })}
      </FieldGroup>
    </section>
  )
}

function RelationshipEditor({
  concept,
  editing,
  data,
}: {
  concept: ConceptRow
  editing: Editing
  data: ExpeditionData
}) {
  const rels = editing.client.collections.relationships
  const byId = new Map(data.concepts.map((c) => [c.id, c]))
  const types = relTypeVocabulary(editing.client.engine.state).filter(
    (t) => !t.hidden
  )
  const label = (typeId: string) => relTypeLabels(typeId, data.relTypeDefs)
  const mine = data.relationships.filter(
    (r) =>
      (r.from === concept.id || r.to === concept.id) &&
      byId.has(r.from) &&
      byId.has(r.to)
  )
  const [type, setType] = React.useState(types[0]?.id ?? "")
  const [target, setTarget] = React.useState<string | null>(null)
  const [picking, setPicking] = React.useState(false)
  const [note, setNote] = React.useState("")

  const add = () => {
    if (!target || !type) return
    const key = relKey(concept.id, type, target)
    mutate("Couldn't add the Relationship", () =>
      rels.insert({
        key,
        from: concept.id,
        type,
        to: target,
        ...(note.trim() ? { note: note.trim() } : {}),
        prov: [],
        deletedAt: null,
      })
    )
    setTarget(null)
    setNote("")
  }

  return (
    <section aria-label="Edit Relationships" className="flex flex-col gap-3">
      <h3 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        Relationships
      </h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {mine.map((r) => {
          const out = r.from === concept.id
          const other = byId.get(out ? r.to : r.from)!
          const l = label(r.type)
          const phrase = out ? l.label : l.inverseLabel
          return (
            <li
              key={r.key}
              data-testid="relationship-edit"
              className="flex items-start gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground">{phrase}</span>{" "}
                <span className="font-medium">{other.title}</span>
                {r.note && (
                  <span className="text-muted-foreground"> ({r.note})</span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove “${phrase} ${other.title}”`}
                onClick={() =>
                  mutate("Couldn't remove the Relationship", () =>
                    rels.delete(r.key)
                  )
                }
              >
                <XIcon />
              </Button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{concept.title}</span>
          <Select
            items={types.map((t) => ({ value: t.id, label: t.label }))}
            value={type}
            onValueChange={(v) => typeof v === "string" && setType(v)}
          >
            <SelectTrigger aria-label="Relationship Type" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Pick a Concept"
                />
              }
            >
              {target ? byId.get(target)?.title : "Pick a Concept…"}
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <ConceptPicker
                concepts={data.concepts.filter((c) => c.id !== concept.id)}
                placeholder="Search Concepts"
                onPick={(id) => {
                  setTarget(id)
                  setPicking(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Note"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            className="h-8"
          />
          <Button size="sm" disabled={!target} onClick={add}>
            <PlusIcon />
            Add
          </Button>
        </div>
      </div>
    </section>
  )
}

// ─── Edit mode: the article's sections ─────────────────────────────────────

export function ArticleEditor({
  concept,
  sections,
  editing,
}: {
  concept: ConceptRow
  sections: readonly ArticleSectionRow[]
  editing: Editing
}) {
  const col = editing.client.collections.articleSections
  const setSection = (id: string, write: (d: ArticleSectionRow) => void) =>
    mutate("Couldn't save the section", () => col.update(id, write))
  const moveTo = (i: number, to: number) => {
    const s = sections[i]
    if (!s || to < 0 || to >= sections.length) return
    const rest = sections.filter((x) => x.id !== s.id)
    const key = keyBetween(
      rest[to - 1]?.orderKey ?? null,
      rest[to]?.orderKey ?? null
    )
    setSection(s.id, (d) => {
      d.orderKey = key
    })
  }
  const add = () =>
    mutate("Couldn't add a section", () =>
      col.insert({
        id: ulid(Date.now()),
        conceptId: concept.id,
        orderKey: keyBetween(sections.at(-1)?.orderKey ?? null, null),
        heading: "New section",
        md: "",
        prov: [],
        deletedAt: null,
      })
    )
  return (
    <div data-testid="article-editor" className="flex flex-col gap-6">
      {sections.map((s, i) => (
        <section
          key={s.id}
          aria-label={s.heading || "Introduction"}
          className="flex flex-col gap-2 rounded-lg border p-3"
        >
          <div className="flex items-center gap-1">
            <Input
              key={s.heading}
              aria-label="Heading"
              defaultValue={s.heading}
              placeholder="Heading (none for the introduction)"
              onBlur={(e) => {
                const v = e.currentTarget.value
                if (v !== s.heading)
                  setSection(s.id, (d) => {
                    d.heading = v
                  })
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Move the section up"
              disabled={i === 0}
              onClick={() => moveTo(i, i - 1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Move the section down"
              disabled={i === sections.length - 1}
              onClick={() => moveTo(i, i + 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete the section"
              onClick={() =>
                mutate("Couldn't delete the section", () => col.delete(s.id))
              }
            >
              <Trash2Icon />
            </Button>
          </div>
          <ConceptMarkdownEditor
            aria-label="Text"
            value={s.md}
            concepts={editing.data.concepts}
            onCommit={(v) =>
              setSection(s.id, (d) => {
                d.md = v
              })
            }
          />
        </section>
      ))}
      <Button variant="outline" onClick={add}>
        <PlusIcon />
        Add a section
      </Button>
    </div>
  )
}

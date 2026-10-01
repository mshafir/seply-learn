// The Expedition's vocabulary (spec §1.2, §1.3; WP-4.5), for owners and
// editors: its Kinds, Relationship Types and Attributes. Add one, rename
// the Expedition's own, show a hidden one again, and remove one in use the
// way §1.3 asks: its members are first reassigned (or deleted), in the same
// Change. Built-ins are hidden, never deleted; Attributes are tombstoned,
// and their values come back with undo.
import * as React from "react"
import { BookAIcon, EyeIcon, PlusIcon, Trash2Icon } from "lucide-react"

import {
  AttributeType,
  PALETTE,
  removeAttribute,
  removeKind,
  removeRelType,
  type DomainState,
  type OpBody,
  type RemoveOptions,
} from "@seply/domain"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import { Input } from "@seply/ui/components/input"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@seply/ui/components/select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@seply/ui/components/tabs"
import { kindColor } from "@seply/ui/lib/kinds"

import type { Editing } from "@/expedition/concept-editing.tsx"
import { refused } from "@/expedition/refused.ts"
import {
  attributeVocabulary,
  kindVocabulary,
  reassignTargets,
  relTypeVocabulary,
  vocabId,
  type VocabItem,
} from "@/expedition/editing.ts"

type Tab = "kinds" | "relTypes" | "attributes"

const NOUN: Record<Tab, { one: string; member: (n: number) => string }> = {
  kinds: {
    one: "Kind",
    member: (n) => (n === 1 ? "1 Concept" : `${n} Concepts`),
  },
  relTypes: {
    one: "Relationship Type",
    member: (n) => (n === 1 ? "1 Relationship" : `${n} Relationships`),
  },
  attributes: {
    one: "Attribute",
    member: (n) =>
      n === 1 ? "1 Concept has a value" : `${n} Concepts have a value`,
  },
}

/** The header button and its dialog. */
export function VocabularyButton({ editing }: { editing: Editing }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Kinds, Relationship Types and Attributes"
        title="Kinds, Relationship Types and Attributes"
        data-testid="vocabulary-open"
        onClick={() => setOpen(true)}
      >
        <BookAIcon />
      </Button>
      {open && (
        <VocabularyDialog editing={editing} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function VocabularyDialog({
  editing,
  onClose,
}: {
  editing: Editing
  onClose: () => void
}) {
  const [tab, setTab] = React.useState<Tab>("kinds")
  // Re-read on every render: the screen re-renders on every change.
  const state = editing.client.engine.state
  const lists: Record<Tab, VocabItem[]> = {
    kinds: kindVocabulary(state),
    relTypes: relTypeVocabulary(state),
    attributes: attributeVocabulary(state),
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="vocabulary-dialog">
        <DialogHeader>
          <DialogTitle>Kinds, Relationship Types and Attributes</DialogTitle>
          <DialogDescription>
            This Expedition's vocabulary. Removing one in use first moves what
            uses it to another, or deletes it, in one Change.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="kinds">Kinds</TabsTrigger>
            <TabsTrigger value="relTypes">Relationship Types</TabsTrigger>
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
          </TabsList>
          {(Object.keys(lists) as Tab[]).map((t) => (
            <TabsContent key={t} value={t} className="flex flex-col gap-3 pt-2">
              <ScrollArea className="h-80 pr-3">
                <ul className="flex flex-col divide-y">
                  {lists[t].map((item) => (
                    <VocabRow
                      key={item.id}
                      tab={t}
                      item={item}
                      items={lists[t]}
                      editing={editing}
                    />
                  ))}
                </ul>
              </ScrollArea>
              <AddForm tab={t} state={state} editing={editing} />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/** The ops that remove an item, reassigning or deleting its members first. */
function removeOps(
  state: DomainState,
  tab: Tab,
  id: string,
  opts: RemoveOptions
): OpBody[] {
  if (tab === "kinds") return removeKind(state, id, opts)
  if (tab === "relTypes") return removeRelType(state, id, opts)
  return removeAttribute(state, id, opts)
}

function VocabRow({
  tab,
  item,
  items,
  editing,
}: {
  tab: Tab
  item: VocabItem
  items: VocabItem[]
  editing: Editing
}) {
  const [removing, setRemoving] = React.useState(false)
  const targets = reassignTargets(items, item)
  const [to, setTo] = React.useState(targets[0]?.id ?? "")
  const noun = NOUN[tab]
  const state = () => editing.client.engine.state

  const remove = (opts: RemoveOptions) => {
    let ops: OpBody[]
    try {
      ops = removeOps(state(), tab, item.id, opts)
    } catch (e) {
      refused(`Couldn't remove ${item.label}`, e)
      return
    }
    const how =
      "reassignTo" in opts
        ? `, moving its uses to ${items.find((i) => i.id === opts.reassignTo)?.label}`
        : ""
    if (editing.commit(ops, `Removed the ${noun.one} ${item.label}${how}`))
      setRemoving(false)
  }

  const showAgain = () => {
    const s = state()
    const op: OpBody | null =
      tab === "kinds"
        ? { kind: "kind.hide", target: item.id, value: false }
        : tab === "relTypes"
          ? { kind: "reltype.hide", target: item.id, value: false }
          : (() => {
              const a = s.attributes[item.id]
              if (!a) return null
              return {
                kind: "attribute.define",
                target: a.id,
                value: {
                  label: a.label,
                  type: a.type,
                  ...(a.unit ? { unit: a.unit } : {}),
                  ...(a.enumValues ? { enumValues: a.enumValues } : {}),
                },
              }
            })()
    if (op) editing.commit([op], `Brought back the ${noun.one} ${item.label}`)
  }

  const rename = (label: string) => {
    const s = state()
    const next = label.trim()
    if (!next || next === item.label) return
    const op: OpBody | null =
      tab === "kinds"
        ? {
            kind: "kind.define",
            target: item.id,
            value: {
              label: next,
              color: item.color ?? "slate",
              ...(s.kinds[item.id]?.icon
                ? { icon: s.kinds[item.id]!.icon }
                : {}),
            },
          }
        : tab === "relTypes"
          ? {
              kind: "reltype.define",
              target: item.id,
              value: {
                label: next,
                inverseLabel: s.relTypes[item.id]?.inverseLabel ?? next,
                color: item.color ?? "slate",
                ...(s.relTypes[item.id]?.dashed ? { dashed: true } : {}),
              },
            }
          : null
    if (op) editing.commit([op], `Renamed the ${noun.one} ${item.label}`)
    else
      editing.commit(
        [
          {
            kind: "attribute.define",
            target: item.id,
            value: {
              ...stripTombstone(s.attributes[item.id]!),
              label: next,
            },
          },
        ],
        `Renamed the ${noun.one} ${item.label}`
      )
  }

  return (
    <li
      data-testid="vocab-item"
      data-id={item.id}
      data-hidden={item.hidden ? "" : undefined}
      className="flex flex-col gap-2 py-2"
    >
      <div className="flex items-center gap-2">
        {item.color && (
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ background: kindColor(item.color) }}
          />
        )}
        <div className="min-w-0 flex-1">
          {item.builtin || item.hidden ? (
            <span
              className={
                item.hidden ? "text-muted-foreground line-through" : ""
              }
            >
              {item.label}
            </span>
          ) : (
            <Input
              key={item.label}
              aria-label={`${noun.one} name`}
              defaultValue={item.label}
              className="h-7"
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
            />
          )}
          <div className="text-xs text-muted-foreground">
            {item.detail ? `${item.detail} · ` : ""}
            {noun.member(item.uses)}
          </div>
        </div>
        {item.builtin && <Badge variant="secondary">Built-in</Badge>}
        {item.hidden ? (
          <Button variant="ghost" size="sm" onClick={showAgain}>
            <EyeIcon />
            Show again
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${item.label}`}
            onClick={() =>
              item.uses === 0
                ? remove({ deleteMembers: true })
                : setRemoving((r) => !r)
            }
          >
            <Trash2Icon />
            Remove
          </Button>
        )}
      </div>
      {removing && (
        <div
          data-testid="vocab-remove"
          className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
        >
          <p>
            {noun.member(item.uses)}{" "}
            {tab === "attributes" ? "" : item.uses === 1 ? "uses" : "use"} it.
            Move {item.uses === 1 ? "it" : "them"} first:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {targets.length > 0 && (
              <>
                <Select
                  items={targets.map((t) => ({ value: t.id, label: t.label }))}
                  value={to}
                  onValueChange={(v) => typeof v === "string" && setTo(v)}
                >
                  <SelectTrigger aria-label="Reassign to" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!to}
                  onClick={() => remove({ reassignTo: to })}
                >
                  Reassign and remove
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => remove({ deleteMembers: true })}
            >
              {tab === "kinds"
                ? "Delete the Concepts too"
                : tab === "relTypes"
                  ? "Remove the Relationships too"
                  : "Hide the values"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRemoving(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function stripTombstone(a: DomainState["attributes"][string]) {
  return {
    label: a.label,
    type: a.type,
    ...(a.unit ? { unit: a.unit } : {}),
    ...(a.enumValues ? { enumValues: a.enumValues } : {}),
  }
}

function AddForm({
  tab,
  state,
  editing,
}: {
  tab: Tab
  state: DomainState
  editing: Editing
}) {
  const [label, setLabel] = React.useState("")
  const [inverse, setInverse] = React.useState("")
  const [type, setType] = React.useState<AttributeType>("text")
  const [unit, setUnit] = React.useState("")
  const [values, setValues] = React.useState("")
  const noun = NOUN[tab].one
  const taken = new Set([
    ...Object.keys(state.kinds),
    ...Object.keys(state.relTypes),
    ...Object.keys(state.attributes),
  ])
  const colour =
    PALETTE[
      (tab === "kinds"
        ? Object.keys(state.kinds).length
        : Object.keys(state.relTypes).length) % PALETTE.length
    ]!
  const enumValues = values
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  const ready =
    label.trim() &&
    (tab !== "relTypes" || inverse.trim()) &&
    (tab !== "attributes" || type !== "enum" || enumValues.length > 0)

  const add = () => {
    if (!ready) return
    const id = vocabId(label, taken)
    const name = label.trim()
    const op: OpBody =
      tab === "kinds"
        ? {
            kind: "kind.define",
            target: id,
            value: { label: name, color: colour },
          }
        : tab === "relTypes"
          ? {
              kind: "reltype.define",
              target: id,
              value: {
                label: name,
                inverseLabel: inverse.trim(),
                color: colour,
              },
            }
          : {
              kind: "attribute.define",
              target: id,
              value: {
                label: name,
                type,
                ...(unit.trim() ? { unit: unit.trim() } : {}),
                ...(type === "enum" ? { enumValues } : {}),
              },
            }
    if (editing.commit([op], `Added the ${noun} ${name}`)) {
      setLabel("")
      setInverse("")
      setUnit("")
      setValues("")
    }
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t pt-3"
      aria-label={`Add a ${noun}`}
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
    >
      <Input
        aria-label={tab === "relTypes" ? "Label (from → to)" : "Name"}
        placeholder={
          tab === "relTypes"
            ? "Label, e.g. “is caused by”"
            : `New ${noun.toLowerCase()}`
        }
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        className="h-8 w-48"
      />
      {tab === "relTypes" && (
        <Input
          aria-label="Inverse label (to → from)"
          placeholder="Inverse, e.g. “causes”"
          value={inverse}
          onChange={(e) => setInverse(e.currentTarget.value)}
          className="h-8 w-44"
        />
      )}
      {tab === "attributes" && (
        <>
          <Select
            items={AttributeType.options.map((t) => ({ value: t, label: t }))}
            value={type}
            onValueChange={(v) =>
              typeof v === "string" && setType(v as AttributeType)
            }
          >
            <SelectTrigger aria-label="Type" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AttributeType.options.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {type === "enum" ? (
            <Input
              aria-label="Values"
              placeholder="Values, comma-separated"
              value={values}
              onChange={(e) => setValues(e.currentTarget.value)}
              className="h-8 w-48"
            />
          ) : (
            <Input
              aria-label="Unit"
              placeholder="Unit (optional)"
              value={unit}
              onChange={(e) => setUnit(e.currentTarget.value)}
              className="h-8 w-28"
            />
          )}
        </>
      )}
      <Button type="submit" size="sm" disabled={!ready}>
        <PlusIcon />
        Add
      </Button>
    </form>
  )
}

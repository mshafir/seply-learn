// The View panel (spec §3.6), opened by the floating View button: the View's
// description, its shared settings (owners and editors only), your settings,
// "Duplicate" and "Read the View Type".
//
// - Shared settings are the View's own, for everyone: each change is checked
//   against the View Type's schema, then written to the View row, which the
//   sync client turns into `view.set` ops by settings path.
// - Your settings are personal (spec §1.6): saved per reader, never shared.
// - Both forms are generated from the View Type's Zod schemas (settings/).
// - "Read the View Type" shows its docs/view-types file in the panel.
import * as React from "react"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CopyIcon,
  EyeIcon,
  StarIcon,
  Undo2Icon,
} from "lucide-react"

import { Button } from "@seply/ui/components/button"
import { ScrollArea } from "@seply/ui/components/scroll-area"
import { Separator } from "@seply/ui/components/separator"
import { SheetDescription } from "@seply/ui/components/sheet"
import {
  BUILTIN_KINDS,
  BUILTIN_REL_TYPES,
  hideInView,
  keyBetween,
  parseSharedSettings,
  ulid,
  VIEW_TYPES,
  type ViewOverrides,
} from "@seply/domain"
import type { EngineCollections, ViewRow } from "@seply/sync"

import type { Editing } from "@/expedition/concept-editing.tsx"
import { refused } from "@/expedition/refused.ts"
import { viewTypeMeta } from "@/expedition/labels.ts"
import { PanelHeader } from "@/expedition/panel-header.tsx"
import { Prose } from "@/expedition/prose.tsx"
import { settingsFields, setAt } from "@/expedition/settings/fields.ts"
import {
  SettingsForm,
  type RefOptions,
} from "@/expedition/settings/settings-form.tsx"
import type { ExpeditionData } from "@/expedition/use-expedition-data.ts"
import { viewTypeDoc } from "@/expedition/view-type-docs.ts"

export type ViewPanelProps = {
  view: ViewRow
  data: ExpeditionData
  collections: EngineCollections
  /** Owners and editors see and change shared settings, and can Duplicate. */
  canEdit: boolean
  personal: {
    values: Record<string, unknown>
    set: (key: string, value: unknown) => void
  }
  /** A copy of the View was made: open it. */
  onDuplicated: (viewId: string) => void
  /** Editing in place (owners and editors, online): best View, hidden Concepts, placements. */
  editing?: Editing
}

export function ViewPanel({
  onClose,
  inline,
  ...props
}: ViewPanelProps & { onClose: () => void; inline: boolean }) {
  const { view } = props
  const [readingType, setReadingType] = React.useState(false)
  const Description = inline ? "p" : SheetDescription
  const meta = viewTypeMeta(view.viewType)
  return (
    <>
      <PanelHeader
        eyebrow={`View · ${meta.name}`}
        title={readingType ? meta.name : view.label || meta.name}
        onClose={onClose}
        inline={inline}
      >
        {readingType ? (
          <Description className="sr-only">
            The {meta.name} View Type
          </Description>
        ) : (
          view.question && (
            <Description className="font-reading text-lg text-muted-foreground">
              {view.question}
            </Description>
          )
        )}
      </PanelHeader>
      {/* Keyed, so switching between the two starts at the top. */}
      <ScrollArea key={String(readingType)} className="min-h-0 flex-1">
        {readingType ? (
          <ViewTypeReading
            viewType={view.viewType}
            onBack={() => setReadingType(false)}
          />
        ) : (
          <ViewSettings {...props} onReadType={() => setReadingType(true)} />
        )}
      </ScrollArea>
    </>
  )
}

function ViewSettings({
  view,
  data,
  collections,
  canEdit,
  personal,
  onDuplicated,
  onReadType,
  editing,
}: ViewPanelProps & { onReadType: () => void }) {
  const spec = VIEW_TYPES[view.viewType]
  const doc = viewTypeDoc(view.viewType)
  const sharedFields = React.useMemo(
    () => settingsFields(spec.shared, spec.refs),
    [spec]
  )
  const personalFields = React.useMemo(
    () => settingsFields(spec.personal),
    [spec]
  )
  const options = useRefOptions(data)

  const writeShared = (path: string[], value: unknown): string | null => {
    const next = setAt(view.settings, path, value)
    const checked = parseSharedSettings(view.viewType, next)
    if (!checked.success)
      return checked.error.issues[0]?.message ?? "Not a valid setting."
    try {
      collections.views.update(view.id, (draft) => {
        draft.settings = next
      })
    } catch (e) {
      console.error("View settings: the change wasn't saved", e)
      return "This change couldn't be saved."
    }
    return null
  }

  const writePersonal = (path: string[], value: unknown): string | null => {
    personal.set(path[0]!, value)
    return null
  }

  const duplicate = () => {
    const views = data.views
    const at = views.findIndex((v) => v.id === view.id)
    const id = ulid(Date.now())
    const label = `${view.label || viewTypeMeta(view.viewType).name} (copy)`
    try {
      collections.views.insert({
        id,
        viewType: view.viewType,
        label,
        ...(view.question ? { question: view.question } : {}),
        orderKey: keyBetween(view.orderKey, views[at + 1]?.orderKey ?? null),
        settings: structuredClone(view.settings),
        settingsVersion: view.settingsVersion,
        status: "ready",
        deletedAt: null,
      })
    } catch (e) {
      console.error("Duplicate View: not saved", e)
      return
    }
    onDuplicated(id)
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-5">
      {doc?.intro && (
        <section aria-label="Description" data-testid="view-description">
          <Prose
            md={doc.intro}
            onConceptLink={() => {}}
            conceptExists={() => false}
            className="text-base"
          />
        </section>
      )}

      {canEdit && sharedFields.length > 0 && (
        <section
          aria-labelledby="shared-settings-title"
          className="flex flex-col gap-4"
        >
          <SectionTitle
            id="shared-settings-title"
            hint="What this View includes. Changes are saved for everyone."
          >
            Shared settings
          </SectionTitle>
          <SettingsForm
            key={view.id}
            name="shared"
            fields={sharedFields}
            values={view.settings}
            onChange={writeShared}
            options={options}
          />
        </section>
      )}

      {editing && <ViewStructure view={view} editing={editing} />}

      <section
        aria-labelledby="your-settings-title"
        className="flex flex-col gap-4"
      >
        <SectionTitle
          id="your-settings-title"
          hint={
            personalFields.length
              ? "Only you see these."
              : "This View Type has no settings of your own."
          }
        >
          Your settings
        </SectionTitle>
        {personalFields.length > 0 && (
          <SettingsForm
            key={view.id}
            name="personal"
            fields={personalFields}
            values={personal.values}
            onChange={writePersonal}
            options={options}
          />
        )}
      </section>

      <Separator />
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="outline" onClick={duplicate}>
            <CopyIcon />
            Duplicate
          </Button>
        )}
        {doc && (
          <Button variant="outline" onClick={onReadType}>
            <BookOpenIcon />
            Read the View Type
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Editors: whether the Expedition opens on this View (its best View), the
 * Concepts hidden here and the ones placed differently here, each with a way
 * back (spec §1.6, §3.6).
 */
function ViewStructure({ view, editing }: { view: ViewRow; editing: Editing }) {
  const { data, client } = editing
  const name = view.label || viewTypeMeta(view.viewType).name
  const best = data.expedition?.bestViewId === view.id
  const byId = new Map(data.concepts.map((c) => [c.id, c]))
  const s = view.settings as ViewOverrides
  const hidden = (s.hide ?? []).filter((id) => byId.has(id))
  const placed = Object.entries(s.placement ?? {}).filter(
    ([id, p]) => byId.has(id) && byId.has(p)
  )
  const live = () => client.engine.state.views[view.id]!

  const makeBest = () => {
    const exp = data.expedition
    if (!exp) return
    try {
      client.collections.expeditions.update(exp.id, (d) => {
        d.bestViewId = view.id
      })
    } catch (e) {
      refused("Couldn't change the best View", e)
    }
  }

  return (
    <section
      aria-labelledby="view-structure-title"
      data-testid="view-structure"
      className="flex flex-col gap-4"
    >
      <SectionTitle
        id="view-structure-title"
        hint="For everyone. Concepts are hidden, moved and ordered from their panel."
      >
        This View
      </SectionTitle>
      {best ? (
        <p className="flex items-center gap-2 text-sm" data-testid="best-view">
          <StarIcon className="size-4 text-primary" />
          The Expedition opens on this View.
        </p>
      ) : (
        <Button
          variant="outline"
          className="self-start"
          data-testid="best-view"
          onClick={makeBest}
        >
          <StarIcon />
          Open the Expedition on this View
        </Button>
      )}
      {hidden.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium">Hidden here</h4>
          <ul className="flex flex-col gap-1" data-testid="hidden-concepts">
            {hidden.map((id) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {byId.get(id)!.title}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Show ${byId.get(id)!.title} again`}
                  onClick={() =>
                    editing.commit(
                      hideInView(live(), id, false),
                      `Showed ${byId.get(id)!.title} in ${name}`
                    )
                  }
                >
                  <EyeIcon />
                  Show
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {placed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium">Placed differently here</h4>
          <ul className="flex flex-col gap-1" data-testid="placed-concepts">
            {placed.map(([id, parent]) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {byId.get(id)!.title}{" "}
                  <span className="text-muted-foreground">under</span>{" "}
                  {byId.get(parent)!.title}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Put ${byId.get(id)!.title} back under its shared parent`}
                  onClick={() =>
                    editing.commit(
                      [
                        {
                          kind: "view.set",
                          target: view.id,
                          path: `settings.placement.${id}`,
                          value: null,
                        },
                      ],
                      `Put ${byId.get(id)!.title} back in ${name}`
                    )
                  }
                >
                  <Undo2Icon />
                  Reset
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function SectionTitle({
  id,
  hint,
  children,
}: {
  id: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3
        id={id}
        className="font-mono text-xs tracking-wider text-primary uppercase"
      >
        {children}
      </h3>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

function ViewTypeReading({
  viewType,
  onBack,
}: {
  viewType: string
  onBack: () => void
}) {
  const doc = viewTypeDoc(viewType)
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeftIcon />
        Back to the View
      </Button>
      {doc?.answers && (
        <p className="font-reading text-lg text-muted-foreground">
          Answers: {doc.answers}
        </p>
      )}
      <Prose
        data-testid="view-type-doc"
        md={doc?.body ?? ""}
        onConceptLink={() => {}}
        conceptExists={() => false}
      />
    </div>
  )
}

/** What the settings forms offer for ids: Relationship Types, Kinds, Concepts. */
function useRefOptions(data: ExpeditionData): RefOptions {
  const { relTypeDefs, kindDefs, concepts } = data
  return React.useMemo(() => {
    // Built-ins, then the Expedition's own rows (which may relabel or hide one).
    const merge = (
      builtins: readonly { id: string; label: string }[],
      own: readonly { id: string; label?: string; hidden: boolean }[]
    ) => {
      const rows = new Map(own.map((d) => [d.id, d]))
      const all = [
        ...builtins,
        ...own.filter((d) => !builtins.some((b) => b.id === d.id)),
      ]
      return all
        .filter((d) => !rows.get(d.id)?.hidden)
        .map((d) => ({
          id: d.id,
          label: rows.get(d.id)?.label ?? d.label ?? d.id,
        }))
    }
    return {
      relTypes: merge(BUILTIN_REL_TYPES, relTypeDefs),
      kinds: merge(BUILTIN_KINDS, kindDefs),
      concepts: [...concepts]
        .map((c) => ({ id: c.id, label: c.title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [relTypeDefs, kindDefs, concepts])
}

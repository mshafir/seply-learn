// The Expedition's details (issue #139), for owners and editors: its title,
// its summary and its Tags, in one dialog. It opens from the pencil next to
// the title in the header and from the Expedition menu. Save writes only what
// changed, through the sync client, as one edit (Tags as add/remove), so it
// lands in History like any other edit. Built from prebuilt parts: Dialog,
// Field, Input, Textarea and the Tag picker (MultiCombobox) Concepts use.
import * as React from "react"

import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import { MultiCombobox } from "@seply/ui/components/multi-combobox"
import { Textarea } from "@seply/ui/components/textarea"

import {
  detailsChanges,
  parseTags,
  type ExpeditionDetails,
} from "@/expedition/editing.ts"

export function ExpeditionDetailsDialog({
  open,
  onOpenChange,
  details,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  details: ExpeditionDetails
  /** Called with only what changed. */
  onSave: (changes: Partial<ExpeditionDetails>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="details-dialog">
        <DialogHeader>
          <DialogTitle>Expedition details</DialogTitle>
        </DialogHeader>
        {/* Mounted fresh on each open, so it starts from the latest details. */}
        {open && (
          <DetailsForm
            details={details}
            onCancel={() => onOpenChange(false)}
            onSave={(changes) => {
              if (Object.keys(changes).length) onSave(changes)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailsForm({
  details,
  onCancel,
  onSave,
}: {
  details: ExpeditionDetails
  onCancel: () => void
  onSave: (changes: Partial<ExpeditionDetails>) => void
}) {
  const [title, setTitle] = React.useState(details.title)
  const [summary, setSummary] = React.useState(details.summary)
  const [tags, setTags] = React.useState<string[]>(details.tags)
  // Every Tag it had or has now, so a new one reads "#tag" too.
  const options = React.useMemo(
    () =>
      [...new Set([...details.tags, ...tags])]
        .sort((a, b) => a.localeCompare(b))
        .map((t) => ({ id: t, label: `#${t}` })),
    [details.tags, tags]
  )
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(detailsChanges(details, { title, summary, tags }))
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="expedition-title">Title</FieldLabel>
          <Input
            id="expedition-title"
            value={title}
            required
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="expedition-summary">Summary</FieldLabel>
          <Textarea
            id="expedition-summary"
            rows={3}
            value={summary}
            placeholder="One or two sentences: what this Expedition covers"
            onChange={(e) => setSummary(e.currentTarget.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="expedition-tags">Tags</FieldLabel>
          <MultiCombobox
            id="expedition-tags"
            aria-label="Expedition Tags"
            options={options}
            value={tags}
            onValueChange={setTags}
            placeholder="#tag"
            empty="Type to add a Tag"
            create={(text) => parseTags(text)[0] ?? null}
          />
          <FieldDescription>
            Remove a Tag with its ×; type to add one.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          data-testid="details-save"
          disabled={!title.trim()}
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

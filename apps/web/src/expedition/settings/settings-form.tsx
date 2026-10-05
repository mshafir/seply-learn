// A settings form generated from a View Type's Zod schema (see fields.ts).
// Every control writes one path at once: switches, checkboxes and selects on
// change, text and numbers on blur or Enter. The caller checks the new value
// against the schema and returns an error to show, or null once written.
// Inputs are keyed by their value, so an edit arriving from another tab
// replaces what they show.
import * as React from "react"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import {
  MultiCombobox,
  SearchCombobox,
} from "@seply/ui/components/multi-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@seply/ui/components/select"
import { Switch } from "@seply/ui/components/switch"
import { Textarea } from "@seply/ui/components/textarea"

import {
  getAt,
  humanize,
  parseTags,
  type RefKind,
  type SettingsField,
} from "@/expedition/settings/fields.ts"

export type RefOption = { id: string; label: string }
/** What each kind of reference offers, plus the Expedition's Tags. */
export type RefOptions = Record<RefKind | "tags", RefOption[]>

export type SettingsFormProps = {
  /** Distinguishes this form's control ids ("shared", "personal"). */
  name: string
  fields: SettingsField[]
  values: Record<string, unknown>
  /** Writes one path; returns an error message, or null when written. */
  onChange: (path: string[], value: unknown) => string | null
  options: RefOptions
}

const NONE = "__none__"

export function SettingsForm({
  name,
  fields,
  values,
  onChange,
  options,
}: SettingsFormProps) {
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const report = (path: string[], error: string | null) => {
    const key = path.join(".")
    setErrors((e) => {
      if (!error && !(key in e)) return e
      const next = { ...e }
      if (error) next[key] = error
      else delete next[key]
      return next
    })
  }
  const write = (path: string[], value: unknown) =>
    report(path, onChange(path, value))
  return (
    <FieldGroup data-testid={`${name}-settings`} className="gap-5">
      {fields.map((field) => (
        <SettingControl
          key={field.path.join(".")}
          name={name}
          field={field}
          values={values}
          write={write}
          report={report}
          errors={errors}
          options={options}
        />
      ))}
    </FieldGroup>
  )
}

type ControlProps = {
  name: string
  field: SettingsField
  values: Record<string, unknown>
  write: (path: string[], value: unknown) => void
  report: (path: string[], error: string | null) => void
  errors: Record<string, string>
  options: RefOptions
}

function SettingControl(props: ControlProps) {
  const { name, field, values, write, report, errors, options } = props
  const id = `${name}-${field.path.join("-")}`
  const value = getAt(values, field.path)
  const error = errors[field.path.join(".")]
  const shown = value === undefined ? field.defaultValue : value
  const { control } = field

  switch (control.type) {
    case "boolean":
      return (
        <Field orientation="horizontal" data-invalid={!!error || undefined}>
          <FieldContent>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
            <FieldError>{error}</FieldError>
          </FieldContent>
          <Switch
            id={id}
            checked={shown === true}
            onCheckedChange={(on) => write(field.path, on)}
          />
        </Field>
      )

    case "enum": {
      const items = control.options.map((o) => ({ id: o, label: humanize(o) }))
      const list = field.optional
        ? [{ id: NONE, label: "None" }, ...items]
        : items
      return (
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <Select
            items={list.map((o) => ({ value: o.id, label: o.label }))}
            value={typeof value === "string" ? value : NONE}
            onValueChange={(v) =>
              write(field.path, v === NONE || v == null ? undefined : v)
            }
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{error}</FieldError>
        </Field>
      )
    }

    case "ref":
      return (
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <SearchCombobox
            id={id}
            options={options[control.ref]}
            value={typeof value === "string" ? value : null}
            onValueChange={(v) => write(field.path, v ?? undefined)}
            placeholder={field.optional ? "None" : "Choose…"}
          />
          <FieldError>{error}</FieldError>
        </Field>
      )

    case "refs": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <MultiCombobox
            id={id}
            options={options[control.ref]}
            value={selected}
            onValueChange={(next) =>
              write(
                field.path,
                next.length || !field.optional ? next : undefined
              )
            }
          />
          <FieldError>{error}</FieldError>
        </Field>
      )
    }

    case "group":
      return (
        <FieldSet>
          <FieldLegend variant="label">{field.label}</FieldLegend>
          <FieldGroup className="gap-4 border-l pl-4">
            {control.fields.map((f) => (
              <SettingControl key={f.path.join(".")} {...props} field={f} />
            ))}
          </FieldGroup>
        </FieldSet>
      )

    case "tags": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <MultiCombobox
            id={id}
            options={options.tags}
            value={selected}
            onValueChange={(next) =>
              write(
                field.path,
                next.length || !field.optional ? next : undefined
              )
            }
            placeholder="#tag"
            empty="Type to add a Tag"
            create={(text) => parseTags(text)[0] ?? null}
          />
          <FieldError>{error}</FieldError>
        </Field>
      )
    }

    case "number":
      return (
        <TextField
          id={id}
          field={field}
          error={error}
          type="number"
          min={control.min}
          step={control.integer ? 1 : "any"}
          text={typeof value === "number" ? String(value) : ""}
          onCommit={(text) => {
            const t = text.trim()
            write(field.path, t === "" ? undefined : Number(t))
          }}
        />
      )

    case "text":
      return (
        <TextField
          id={id}
          field={field}
          error={error}
          text={typeof value === "string" ? value : ""}
          onCommit={(text) =>
            write(field.path, text === "" && field.optional ? undefined : text)
          }
        />
      )

    case "json":
      return (
        <TextField
          id={id}
          field={field}
          error={error}
          multiline
          description="JSON"
          text={value === undefined ? "" : JSON.stringify(value, null, 2)}
          onCommit={(text) => {
            if (text.trim() === "") return write(field.path, undefined)
            let parsed: unknown
            try {
              parsed = JSON.parse(text)
            } catch {
              return report(field.path, "This isn't valid JSON.")
            }
            write(field.path, parsed)
          }}
        />
      )
  }
}

/** Options, plus any chosen id they don't list (e.g. a hidden Kind). */
function TextField({
  id,
  field,
  error,
  text,
  description,
  multiline = false,
  onCommit,
  ...inputProps
}: {
  id: string
  field: SettingsField
  error?: string
  text: string
  description?: string
  multiline?: boolean
  onCommit: (text: string) => void
} & Pick<React.ComponentProps<"input">, "type" | "min" | "step">) {
  const commit = (next: string) => {
    if (next !== text) onCommit(next)
  }
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {multiline ? (
        <Textarea
          key={text}
          id={id}
          defaultValue={text}
          aria-invalid={!!error || undefined}
          className="min-h-24 font-mono text-xs"
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      ) : (
        <Input
          key={text}
          id={id}
          defaultValue={text}
          aria-invalid={!!error || undefined}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value)
          }}
          {...inputProps}
        />
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

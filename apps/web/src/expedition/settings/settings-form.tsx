// A settings form generated from a View Type's Zod schema (see fields.ts).
// Every control writes one path at once: switches, checkboxes and selects on
// change, text and numbers on blur or Enter. The caller checks the new value
// against the schema and returns an error to show, or null once written.
// Inputs are keyed by their value, so an edit arriving from another tab
// replaces what they show.
import * as React from "react"

import { Checkbox } from "@umbel/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@umbel/ui/components/field"
import { Input } from "@umbel/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@umbel/ui/components/select"
import { Switch } from "@umbel/ui/components/switch"
import { Textarea } from "@umbel/ui/components/textarea"

import {
  getAt,
  humanize,
  parseTags,
  type RefKind,
  type SettingsField,
} from "@/expedition/settings/fields.ts"

export type RefOption = { id: string; label: string }
export type RefOptions = Record<RefKind, RefOption[]>

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

    case "enum":
    case "ref": {
      const items: RefOption[] =
        control.type === "enum"
          ? control.options.map((o) => ({ id: o, label: humanize(o) }))
          : withUnknown(options[control.ref], value)
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

    case "refs": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      const items = withUnknown(options[control.ref], selected)
      const toggle = (itemId: string, on: boolean) => {
        const next = on
          ? [...selected, itemId]
          : selected.filter((s) => s !== itemId)
        write(field.path, next.length || !field.optional ? next : undefined)
      }
      return (
        <FieldSet data-invalid={!!error || undefined}>
          <FieldLegend variant="label">{field.label}</FieldLegend>
          <FieldDescription>{selected.length} chosen</FieldDescription>
          <div
            data-slot="checkbox-group"
            className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-lg border p-3"
          >
            {items.map((o) => {
              const itemId = `${id}-${o.id}`
              return (
                <Field key={o.id} orientation="horizontal">
                  <Checkbox
                    id={itemId}
                    checked={selected.includes(o.id)}
                    onCheckedChange={(on) => toggle(o.id, on)}
                  />
                  <FieldLabel htmlFor={itemId} className="font-normal">
                    {o.label}
                  </FieldLabel>
                </Field>
              )
            })}
          </div>
          <FieldError>{error}</FieldError>
        </FieldSet>
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

    case "tags":
      return (
        <TextField
          id={id}
          field={field}
          error={error}
          text={Array.isArray(value) ? (value as string[]).join(", ") : ""}
          description="Comma-separated"
          onCommit={(text) => {
            const tags = parseTags(text)
            write(field.path, tags.length || !field.optional ? tags : undefined)
          }}
        />
      )

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
function withUnknown(options: RefOption[], chosen: unknown): RefOption[] {
  const ids = new Set(options.map((o) => o.id))
  const extra = (Array.isArray(chosen) ? chosen : [chosen]).filter(
    (c): c is string => typeof c === "string" && !ids.has(c)
  )
  return [...options, ...extra.map((c) => ({ id: c, label: c }))]
}

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

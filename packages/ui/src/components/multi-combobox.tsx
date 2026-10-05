// Pickers over the shadcn Combobox (Base UI): a multi-select with chips, and a
// searchable single select. Values are ids; `options` gives each id its
// label. A multi-select can also take values that aren't options yet
// (`create`), e.g. a new Tag: typing offers "Add …".
import * as React from "react"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@seply/ui/components/combobox"

export type ComboboxOption = { id: string; label: string }

const bare = (s: string) => s.trim().replace(/^#/, "").toLowerCase()

export function MultiCombobox({
  id,
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  empty = "Nothing found",
  create,
  "aria-label": ariaLabel,
  className,
}: {
  id?: string
  options: readonly ComboboxOption[]
  value: readonly string[]
  onValueChange: (value: string[]) => void
  placeholder?: string
  empty?: string
  /** Turns typed text into a new value (null: not a valid one). */
  create?: (input: string) => string | null
  "aria-label"?: string
  className?: string
}) {
  const anchor = useComboboxAnchor()
  const [query, setQuery] = React.useState("")
  const labels = React.useMemo(
    () => new Map(options.map((o) => [o.id, o.label])),
    [options]
  )
  const created = create && query.trim() ? create(query) : null
  const items = React.useMemo(() => {
    // Selected values that aren't options (e.g. a Tag no Concept has yet)
    // stay listed, so they can be unticked.
    const ids = [...options.map((o) => o.id)]
    for (const v of value) if (!labels.has(v)) ids.push(v)
    if (created && !ids.includes(created)) ids.push(created)
    return ids
  }, [options, value, labels, created])
  const labelOf = (v: string) => labels.get(v) ?? v

  return (
    <Combobox
      multiple
      items={items}
      value={[...value]}
      onValueChange={(next) => {
        setQuery("")
        onValueChange(next as string[])
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={labelOf}
      // Case-insensitive, ignoring a leading "#" (Tags), and always offering
      // what `create` made of the text.
      filter={(v: string, q: string) =>
        v === created || bare(labelOf(v)).includes(bare(q))
      }
    >
      <ComboboxChips ref={anchor} className={className}>
        <ComboboxValue>
          {(selected: string[]) => (
            <>
              {selected.map((v) => (
                <ComboboxChip key={v}>{labelOf(v)}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                id={id}
                aria-label={ariaLabel}
                placeholder={selected.length ? "" : placeholder}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>{empty}</ComboboxEmpty>
        <ComboboxList>
          {(v: string) => (
            <ComboboxItem key={v} value={v}>
              {v === created && !labels.has(v) && !value.includes(v)
                ? `Add “${v}”`
                : labelOf(v)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/** One value from a searchable list; `null` when nothing is chosen. */
export function SearchCombobox({
  id,
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  empty = "Nothing found",
  "aria-label": ariaLabel,
  className,
}: {
  id?: string
  options: readonly ComboboxOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  empty?: string
  "aria-label"?: string
  className?: string
}) {
  const labels = React.useMemo(
    () => new Map(options.map((o) => [o.id, o.label])),
    [options]
  )
  const items = React.useMemo(() => {
    const ids = options.map((o) => o.id)
    return value && !labels.has(value) ? [...ids, value] : ids
  }, [options, value, labels])
  const labelOf = (v: string) => labels.get(v) ?? v

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next) => onValueChange((next as string | null) ?? null)}
      itemToStringLabel={labelOf}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={className ?? "w-full"}
      />
      <ComboboxContent>
        <ComboboxEmpty>{empty}</ComboboxEmpty>
        <ComboboxList>
          {(v: string) => (
            <ComboboxItem key={v} value={v}>
              {labelOf(v)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

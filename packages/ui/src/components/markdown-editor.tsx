"use client"

// A rich editor for markdown (divergence: see DIVERGENCES.md). Plate
// (platejs.org) does the editing; markdown is the stored format, read and
// written through `markdown-source`, which leaves untouched blocks exactly as
// they were. The toolbar is built from our Base UI Toggle, Tooltip, Popover,
// Combobox and Separator; the content is styled by Typeset, as the reader is.
//
// It writes on blur, like the textarea it replaces: `onCommit` gets the new
// markdown when focus leaves the editor (and its toolbar and link popover)
// and the text changed. This module is heavy; import it lazily.
import * as React from "react"
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react"
import { CodeBlockPlugin, CodeLinePlugin } from "@platejs/code-block/react"
import { toggleCodeBlock } from "@platejs/code-block"
import { IndentPlugin } from "@platejs/indent/react"
import { unwrapLink, upsertLink } from "@platejs/link"
import { LinkPlugin } from "@platejs/link/react"
import { isOrderedList } from "@platejs/list"
import {
  ListPlugin,
  useListToolbarButton,
  useListToolbarButtonState,
} from "@platejs/list/react"
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react"
import { KEYS, type TLinkElement, type TListElement } from "platejs"
import {
  createPlateEditor,
  ParagraphPlugin,
  Plate,
  PlateContent,
  PlateElement,
  useEditorRef,
  useEditorSelector,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
  usePlateEditor,
  type PlateEditor,
  type PlateElementProps,
  type RenderNodeWrapper,
} from "platejs/react"
import {
  BoldIcon,
  CodeIcon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SquareCodeIcon,
} from "lucide-react"
import { cn } from "cn"

import { Button } from "@seply/ui/components/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@seply/ui/components/combobox"
import { Input } from "@seply/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@seply/ui/components/popover"
import { Separator } from "@seply/ui/components/separator"
import { Toggle } from "@seply/ui/components/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@seply/ui/components/tooltip"
import {
  deserializeMarkdown,
  MarkdownKit,
  serializeMarkdown,
} from "@seply/ui/lib/markdown-source"

/** A suggested link target, offered in the link popover. */
export interface LinkTarget {
  /** What the picker shows, and the link text when nothing is selected. */
  label: string
  href: string
}

export interface MarkdownEditorProps {
  /** The markdown. A change from elsewhere resets the editor unless it has focus. */
  value: string
  /** Called on blur with the new markdown, only if it changed. */
  onCommit: (markdown: string) => void
  id?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  placeholder?: string
  className?: string
  /** Extra attributes for a link's `<a>`, e.g. to style in-app links. */
  linkAttributes?: (url: string) => Record<string, string> | undefined
  /** Targets the link popover offers in a searchable list. */
  linkTargets?: readonly LinkTarget[]
  /** What `linkTargets` are, for the picker's placeholder, e.g. "Concepts". */
  linkTargetsNoun?: string
}

// ─── Nodes ─────────────────────────────────────────────────────────────────
// Semantic elements only: Typeset styles them the way the reader does.

const LinkAttributesContext =
  React.createContext<MarkdownEditorProps["linkAttributes"]>(undefined)

function LinkElement(props: PlateElementProps<TLinkElement>) {
  const extra = React.useContext(LinkAttributesContext)?.(props.element.url)
  return (
    <PlateElement
      {...props}
      as="a"
      attributes={{
        ...props.attributes,
        ...extra,
        href: props.element.url,
        // Clicking a link edits it; it never navigates away.
        onClick: (e: React.MouseEvent) => e.preventDefault(),
      }}
    >
      {props.children}
    </PlateElement>
  )
}

function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props}>
      <div contentEditable={false}>
        <hr />
      </div>
      {props.children}
    </PlateElement>
  )
}

function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="typeset-scroll">
      <table>
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  )
}

const TableRowElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="tr" />
)
const TableCellElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="td" />
)
const TableHeaderCellElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="th" />
)

function CodeBlockElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="pre">
      <code>{props.children}</code>
    </PlateElement>
  )
}

const CodeLineElement = (props: PlateElementProps) => (
  <PlateElement {...props} className="block" />
)

/** Plate's lists are flat, indented blocks; each renders in its own list. */
const BlockList: RenderNodeWrapper = ({ element }) => {
  if (!element.listStyleType) return
  return function List(props) {
    const { listStart, listStyleType } = props.element as TListElement
    const Tag = isOrderedList(props.element) ? "ol" : "ul"
    return (
      <Tag className="m-0 ps-6" style={{ listStyleType }} start={listStart}>
        <li className="m-0">{props.children}</li>
      </Tag>
    )
  }
}

/** Paragraphs space out as Typeset's do; list items, one per block, close up. */
function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      className={props.element.listStyleType ? "mt-1" : "mt-(--typeset-flow)"}
    />
  )
}

const LIST_TARGETS = [KEYS.p, ...KEYS.heading, KEYS.blockquote, KEYS.codeBlock]

export const markdownEditorPlugins = [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin.withComponent(HrElement),
  BoldPlugin.configure({ shortcuts: { toggle: { keys: "mod+b" } } }),
  ItalicPlugin.configure({ shortcuts: { toggle: { keys: "mod+i" } } }),
  CodePlugin.configure({ shortcuts: { toggle: { keys: "mod+e" } } }),
  StrikethroughPlugin,
  LinkPlugin.withComponent(LinkElement),
  IndentPlugin.configure({ inject: { targetPlugins: LIST_TARGETS } }),
  ListPlugin.configure({
    inject: { targetPlugins: LIST_TARGETS },
    render: { belowNodes: BlockList },
  }),
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableHeaderCellElement),
  CodeBlockPlugin.withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  MarkdownKit,
]

/**
 * A headless editor loaded with `markdown` and normalized, as the mounted
 * one is: for tests, with `serializeMarkdown` to read it back.
 */
export function createMarkdownEditor(markdown: string) {
  const editor = createPlateEditor({ plugins: markdownEditorPlugins })
  editor.tf.setValue(deserializeMarkdown(editor, markdown))
  editor.tf.normalize({ force: true })
  return editor
}

// ─── Toolbar ───────────────────────────────────────────────────────────────

function ToolbarToggle({
  label,
  shortcut,
  pressed,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            aria-label={label}
            pressed={pressed}
            // Keep the editor's focus and selection.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="opacity-70">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function MarkToggle({
  nodeType,
  label,
  shortcut,
  children,
}: {
  nodeType: string
  label: string
  shortcut?: string
  children: React.ReactNode
}) {
  const { props } = useMarkToolbarButton(
    useMarkToolbarButtonState({ nodeType })
  )
  return (
    <ToolbarToggle
      label={label}
      shortcut={shortcut}
      pressed={props.pressed}
      onClick={props.onClick}
    >
      {children}
    </ToolbarToggle>
  )
}

function ListToggle({
  nodeType,
  label,
  children,
}: {
  nodeType: string
  label: string
  children: React.ReactNode
}) {
  const { props } = useListToolbarButton(
    useListToolbarButtonState({ nodeType })
  )
  return (
    <ToolbarToggle
      label={label}
      pressed={props.pressed}
      onClick={props.onClick}
    >
      {children}
    </ToolbarToggle>
  )
}

function BlockToggle({
  type,
  label,
  children,
}: {
  type: string
  label: string
  children: React.ReactNode
}) {
  const editor = useEditorRef()
  const pressed = useEditorSelector(
    (e) => e.api.some({ match: { type } }),
    [type]
  )
  return (
    <ToolbarToggle
      label={label}
      pressed={pressed}
      onClick={() => {
        if (type === KEYS.codeBlock) toggleCodeBlock(editor)
        else editor.tf.toggleBlock(type)
        editor.tf.focus()
      }}
    >
      {children}
    </ToolbarToggle>
  )
}

function LinkPopover({
  open,
  onOpenChange,
  targets,
  targetsNoun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets?: readonly LinkTarget[]
  targetsNoun?: string
}) {
  const editor = useEditorRef()
  const current = useEditorSelector(
    (e) =>
      e.api.above<TLinkElement>({ match: { type: e.getType(KEYS.link) } })?.[0]
        .url,
    []
  )
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Toggle
                  size="sm"
                  aria-label="Link"
                  pressed={current !== undefined}
                  onMouseDown={(e) => e.preventDefault()}
                />
              }
            />
          }
        >
          <LinkIcon />
        </TooltipTrigger>
        <TooltipContent>Link</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-80"
        // Back to the text, where the selection is, however it closes.
        finalFocus={() => {
          editor.tf.focus()
          return false
        }}
      >
        {open && (
          <LinkForm
            key={current ?? ""}
            editor={editor}
            initial={current ?? ""}
            targets={targets}
            targetsNoun={targetsNoun}
            onDone={() => onOpenChange(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function LinkForm({
  editor,
  initial,
  targets,
  targetsNoun = "pages",
  onDone,
}: {
  editor: PlateEditor
  initial: string
  targets?: readonly LinkTarget[]
  targetsNoun?: string
  onDone: () => void
}) {
  const [url, setUrl] = React.useState(initial)
  const apply = (href: string, label?: string) => {
    const next = href.trim()
    if (!next) return
    editor.tf.focus()
    // With nothing selected, the link's text is the target's name or the URL.
    const text = editor.api.isExpanded() ? undefined : (label ?? next)
    upsertLink(editor, { url: next, text })
    onDone()
  }
  return (
    <form
      data-testid="link-form"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        apply(url)
      }}
    >
      {targets && targets.length > 0 && (
        <Combobox
          items={[...targets]}
          itemToStringLabel={(t: LinkTarget) => t.label}
          onValueChange={(t: LinkTarget | null) => {
            if (t) apply(t.href, t.label)
          }}
        >
          <ComboboxInput
            aria-label={`Link to one of the ${targetsNoun}`}
            placeholder={`Search ${targetsNoun}`}
            showTrigger={false}
            className="w-full"
          />
          <ComboboxContent>
            <ComboboxEmpty>No matches.</ComboboxEmpty>
            <ComboboxList>
              {(t: LinkTarget) => (
                <ComboboxItem key={t.href} value={t}>
                  {t.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
      <div className="flex gap-2">
        <Input
          aria-label="Link address"
          placeholder="https://…"
          value={url}
          autoFocus={!targets?.length}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
        <Button type="submit" size="sm" disabled={!url.trim()}>
          {initial ? "Update" : "Add"}
        </Button>
      </div>
      {initial && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            editor.tf.focus()
            unwrapLink(editor)
            onDone()
          }}
        >
          Remove link
        </Button>
      )}
    </form>
  )
}

function Toolbar({
  linkOpen,
  onLinkOpenChange,
  targets,
  targetsNoun,
}: {
  linkOpen: boolean
  onLinkOpenChange: (open: boolean) => void
  targets?: readonly LinkTarget[]
  targetsNoun?: string
}) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b p-1"
    >
      <MarkToggle nodeType={KEYS.bold} label="Bold" shortcut="⌘B">
        <BoldIcon />
      </MarkToggle>
      <MarkToggle nodeType={KEYS.italic} label="Italic" shortcut="⌘I">
        <ItalicIcon />
      </MarkToggle>
      <MarkToggle nodeType={KEYS.code} label="Inline code" shortcut="⌘E">
        <CodeIcon />
      </MarkToggle>
      <Separator orientation="vertical" className="mx-1 my-1" />
      <BlockToggle type={KEYS.h3} label="Heading">
        <Heading3Icon />
      </BlockToggle>
      <ListToggle nodeType={KEYS.ul} label="Bulleted list">
        <ListIcon />
      </ListToggle>
      <ListToggle nodeType={KEYS.ol} label="Numbered list">
        <ListOrderedIcon />
      </ListToggle>
      <BlockToggle type={KEYS.blockquote} label="Quote">
        <QuoteIcon />
      </BlockToggle>
      <BlockToggle type={KEYS.codeBlock} label="Code block">
        <SquareCodeIcon />
      </BlockToggle>
      <Separator orientation="vertical" className="mx-1 my-1" />
      <LinkPopover
        open={linkOpen}
        onOpenChange={onLinkOpenChange}
        targets={targets}
        targetsNoun={targetsNoun}
      />
    </div>
  )
}

// ─── The editor ────────────────────────────────────────────────────────────

export function MarkdownEditor({
  value,
  onCommit,
  id,
  placeholder,
  className,
  linkAttributes,
  linkTargets,
  linkTargetsNoun,
  ...aria
}: MarkdownEditorProps) {
  const editor = usePlateEditor({
    plugins: markdownEditorPlugins,
    value: (e) => deserializeMarkdown(e, value),
  })
  const [linkOpen, setLinkOpen] = React.useState(false)
  const linkOpenRef = React.useRef(false)
  // What the editor holds, as markdown: the value it loaded or last wrote.
  const heldRef = React.useRef(value)

  // A change from elsewhere (another person, an undo) replaces the text,
  // unless the person is typing here; their next blur writes over it.
  React.useEffect(() => {
    if (value === heldRef.current) return
    let focused = false
    try {
      focused = editor.api.isFocused()
    } catch {
      // Not mounted yet.
    }
    if (focused) return
    heldRef.current = value
    editor.tf.setValue(deserializeMarkdown(editor, value))
  }, [editor, value])

  const commit = () => {
    const next = serializeMarkdown(editor)
    if (next === heldRef.current) {
      // Unchanged here, but changed elsewhere while it had focus: catch up.
      if (value !== heldRef.current) {
        heldRef.current = value
        editor.tf.setValue(deserializeMarkdown(editor, value))
      }
      return
    }
    heldRef.current = next
    onCommit(next)
  }

  return (
    <LinkAttributesContext.Provider value={linkAttributes}>
      <Plate editor={editor}>
        <div
          data-slot="markdown-editor"
          className={cn(
            "rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
            className
          )}
          onBlur={(e) => {
            // Focus moving to the toolbar or the link popover isn't a blur.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            if (linkOpenRef.current) return
            commit()
          }}
        >
          <Toolbar
            linkOpen={linkOpen}
            onLinkOpenChange={(open) => {
              linkOpenRef.current = open
              setLinkOpen(open)
            }}
            targets={linkTargets}
            targetsNoun={linkTargetsNoun}
          />
          <PlateContent
            id={id}
            {...aria}
            placeholder={placeholder}
            data-testid="markdown-editor-content"
            className={cn(
              "typeset max-h-[60vh] min-h-32 overflow-y-auto px-3 py-2 text-base outline-none",
              "[&_:is(td,th)>*]:mt-0 [&_a]:text-primary [&>:first-child]:mt-0",
              "[&_[data-slate-placeholder]]:text-muted-foreground"
            )}
          />
        </div>
      </Plate>
    </LinkAttributesContext.Provider>
  )
}

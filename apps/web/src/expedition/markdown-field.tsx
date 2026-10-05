// Concept markdown (an overview, an article section) in Edit mode: the
// shared rich editor from @seply/ui, loaded only when someone starts
// editing, with the in-text Concept links (`[text](#c/<id>)`) the reader
// follows: styled as the reader styles them, and offered by name in the
// link popover.
import * as React from "react"
import type { MarkdownEditorProps } from "@seply/ui/components/markdown-editor"
import { Skeleton } from "@seply/ui/components/skeleton"

import { conceptHref, conceptLinkId } from "@/expedition/reading.ts"

const MarkdownEditor = React.lazy(() =>
  import("@seply/ui/components/markdown-editor").then((m) => ({
    default: m.MarkdownEditor,
  }))
)

const linkAttributes = (url: string) => {
  const id = conceptLinkId(url)
  return id === null ? undefined : { "data-concept-link": id }
}

export function ConceptMarkdownEditor({
  concepts,
  ...props
}: Omit<
  MarkdownEditorProps,
  "linkAttributes" | "linkTargets" | "linkTargetsNoun"
> & {
  /** The Concepts a link can point to. */
  concepts: readonly { id: string; title: string }[]
}) {
  const targets = React.useMemo(
    () => concepts.map((c) => ({ label: c.title, href: conceptHref(c.id) })),
    [concepts]
  )
  return (
    <React.Suspense
      fallback={
        <Skeleton
          data-testid="markdown-editor-loading"
          className="h-44 w-full rounded-lg"
        />
      }
    >
      <MarkdownEditor
        {...props}
        linkAttributes={linkAttributes}
        linkTargets={targets}
        linkTargetsNoun="Concepts"
      />
    </React.Suspense>
  )
}

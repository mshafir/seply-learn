// Concept markdown (overviews, article sections) rendered with shadcn Typeset
// in Newsreader (spec §7.3). In-text links to other Concepts (`#c/<id>`)
// navigate the side panel instead of the page; other links open in a new tab.
// Raw HTML in the markdown is not rendered (react-markdown's default).
import type * as React from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@seply/ui/lib/utils"

import { conceptLinkId } from "@/expedition/reading.ts"

export function Prose({
  md,
  onConceptLink,
  conceptExists,
  className,
  ...props
}: {
  md: string
  /** Called with the Concept id of a clicked `#c/<id>` link. */
  onConceptLink: (conceptId: string) => void
  /** Links to missing Concepts render as plain text. */
  conceptExists: (conceptId: string) => boolean
} & Omit<React.ComponentProps<"div">, "children">) {
  const components: Components = {
    // Wide tables scroll sideways (Typeset's wrapper) in the narrow panel.
    table: ({ children }) => (
      <div className="typeset-scroll">
        <table>{children}</table>
      </div>
    ),
    a: ({ href, title, children }) => {
      const rest = { title }
      const conceptId = conceptLinkId(href)
      if (conceptId !== null) {
        if (!conceptExists(conceptId)) return <span>{children}</span>
        return (
          <a
            {...rest}
            href={href}
            data-concept-link={conceptId}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return
              event.preventDefault()
              onConceptLink(conceptId)
            }}
          >
            {children}
          </a>
        )
      }
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
  }
  return (
    <div
      className={cn(
        "typeset min-w-0 text-base [&_a]:text-primary [&>:first-child]:mt-0",
        className
      )}
      {...props}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </Markdown>
    </div>
  )
}

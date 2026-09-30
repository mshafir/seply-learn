// Divergence 6 (DIVERGENCES.md): a file drop target. shadcn has none; this is
// a native drag-and-drop area (a dashed `--border` box) wrapping a Button that
// opens a hidden `<input type="file">`. Tokens only.
import * as React from "react"
import { UploadIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@seply/ui/components/button"

function FileDropZone({
  onFiles,
  accept,
  multiple = true,
  disabled,
  title = "Drop files here",
  hint,
  browseLabel = "Browse files",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  onFiles: (files: File[]) => void
  /** The file input's `accept`. */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  title?: React.ReactNode
  hint?: React.ReactNode
  browseLabel?: string
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [over, setOver] = React.useState(false)
  const take = (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (files.length && !disabled) onFiles(multiple ? files : files.slice(0, 1))
  }
  return (
    <div
      data-slot="file-drop-zone"
      data-dragging={over || undefined}
      data-disabled={disabled || undefined}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-8 text-center transition-colors data-disabled:opacity-60 data-dragging:border-primary data-dragging:bg-primary/5",
        className
      )}
      {...props}
    >
      <UploadIcon className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {browseLabel}
      </Button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={browseLabel}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ""
        }}
      />
    </div>
  )
}

export { FileDropZone }

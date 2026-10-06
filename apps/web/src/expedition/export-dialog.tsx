// The Expedition menu (the header's "…") and its Export dialog (spec §1.9,
// §3.9): anyone who can view can export. Two formats: our JSON, with the
// Sources' files if the box is ticked (default on for owners and editors; a
// zip then), or a Markdown folder (a zip) that opens in Obsidian. Fork and
// Share join this menu with their work packages.
import * as React from "react"
import { DownloadIcon, EllipsisIcon } from "lucide-react"

import { Alert, AlertDescription } from "@seply/ui/components/alert"
import { Button } from "@seply/ui/components/button"
import { Checkbox } from "@seply/ui/components/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import { Label } from "@seply/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@seply/ui/components/radio-group"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"

import { exportExpedition, type ExportFormat } from "@/lib/api.ts"
import { saveDownload } from "@/lib/export.ts"

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  {
    id: "json",
    label: "JSON",
    hint: "Everything needed to import it again, here or on another server.",
  },
  {
    id: "markdown",
    label: "Markdown folder",
    hint: "One note per Concept, linked by Relationship. Opens in Obsidian.",
  },
]

export function ExpeditionMenu({
  expeditionId,
  title,
  canEdit,
}: {
  expeditionId: string
  title: string
  /** Owners and editors: Source files are included by default. */
  canEdit: boolean
}) {
  const [exporting, setExporting] = React.useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Expedition menu"
              data-testid="expedition-menu"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            data-testid="export-item"
            onClick={() => setExporting(true)}
          >
            <DownloadIcon />
            Export…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        expeditionId={expeditionId}
        title={title}
        canEdit={canEdit}
      />
    </>
  )
}

export function ExportDialog({
  open,
  onOpenChange,
  expeditionId,
  title,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expeditionId: string
  title: string
  canEdit: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="export-dialog" className="sm:max-w-md">
        {/* Mounted only while open: each opening starts from the defaults. */}
        <ChooseExport
          expeditionId={expeditionId}
          title={title}
          canEdit={canEdit}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ChooseExport({
  expeditionId,
  title,
  canEdit,
  onDone,
}: {
  expeditionId: string
  title: string
  canEdit: boolean
  onDone: () => void
}) {
  const [format, setFormat] = React.useState<ExportFormat>("json")
  const [sources, setSources] = React.useState(canEdit)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const file = await exportExpedition(
        expeditionId,
        format,
        format === "json" && sources
      )
      saveDownload(file)
      toast.add({
        title: `Exported ${title || "the Expedition"}`,
        description:
          format === "markdown"
            ? `${file.filename}: unzip it and open the folder as an Obsidian vault.`
            : file.sourceFiles
              ? `${file.filename}, with ${file.sourceFiles === 1 ? "1 Source file" : `${file.sourceFiles} Source files`}. Import it from the Library.`
              : `${file.filename}. Import it from the Library.`,
        type: "success",
      })
      onDone()
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export {title || "this Expedition"}</DialogTitle>
        <DialogDescription>
          Its current Concepts, Relationships and Views. History, suggestions,
          collaborators and your reading aren't included.
        </DialogDescription>
      </DialogHeader>

      <RadioGroup
        aria-label="Format"
        value={format}
        onValueChange={(v) => setFormat(v as ExportFormat)}
        className="gap-2"
      >
        {FORMATS.map((f) => (
          <Label
            key={f.id}
            data-testid={`export-format-${f.id}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5"
          >
            <RadioGroupItem value={f.id} className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold">{f.label}</span>
              <span className="text-sm text-muted-foreground">{f.hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

      {format === "json" && (
        <Label className="flex cursor-pointer items-start gap-3 font-normal">
          <Checkbox
            checked={sources}
            onCheckedChange={(v) => setSources(v === true)}
            data-testid="export-sources"
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span>Include Source files</span>
            <span className="text-sm text-muted-foreground">
              The chats and files it was built from. It downloads as a zip.
            </span>
          </span>
        </Label>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Couldn't export it: {error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button
          disabled={busy}
          onClick={() => void download()}
          data-testid="export-download"
        >
          {busy ? <Spinner /> : <DownloadIcon />}
          Download
        </Button>
      </DialogFooter>
    </>
  )
}

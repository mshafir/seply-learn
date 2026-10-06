// Export and import in the browser (spec §1.9): saving an export as a file,
// and what an import brought in, in the glossary's words.
import type { ExportDownload, ImportResult } from "@/lib/api.ts"

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

/** "201 Concepts, 425 Relationships, 12 Views, 2 Sources (1 with its file)." */
export function importedLabel(counts: ImportResult["counts"]): string {
  const parts = [
    count(counts.concepts, "Concept"),
    count(counts.relationships, "Relationship"),
    count(counts.views, "View"),
  ]
  if (counts.sources) {
    const files =
      counts.sourceFiles === 0
        ? ""
        : counts.sourceFiles === counts.sources
          ? counts.sources === 1
            ? " (with its file)"
            : " (with their files)"
          : ` (${counts.sourceFiles} with ${counts.sourceFiles === 1 ? "its file" : "their files"})`
    parts.push(`${count(counts.sources, "Source")}${files}`)
  }
  return `${parts.join(", ")}.`
}

/** Saves a download through a temporary link (the browser's own download). */
export function saveDownload({ blob, filename }: ExportDownload): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.append(a)
  a.click()
  a.remove()
  // Revoked later: some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// PDF → one text per page, with unpdf (a serverless build of PDF.js that
// runs in Workers and Node). Scanned PDFs without a text layer come out
// empty; there is no OCR in v1.
import { extractText, getDocumentProxy, getMeta } from "unpdf"

export async function pdfPages(
  bytes: Uint8Array
): Promise<{ pages: string[]; title?: string }> {
  // PDF.js takes ownership of the buffer it is given; pass a copy.
  const pdf = await getDocumentProxy(bytes.slice())
  try {
    const { text } = await extractText(pdf, { mergePages: false })
    let title: string | undefined
    try {
      const meta = await getMeta(pdf)
      const t = (meta.info as { Title?: unknown } | undefined)?.Title
      title = typeof t === "string" && t.trim() ? t.trim() : undefined
    } catch {
      title = undefined
    }
    return { pages: text, title }
  } finally {
    await pdf.cleanup().catch(() => {})
  }
}

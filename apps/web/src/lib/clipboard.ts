import { toast } from "@seply/ui/components/toast"

/** Copies text, with a "Copied." toast. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: "Copied.", type: "success" })
  } catch {
    // No clipboard (an insecure origin): the text is selectable.
  }
}

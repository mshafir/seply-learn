// The toast for an edit that didn't apply (a refused op, a Merge into a
// Concept someone just deleted, …).
import { toast } from "@seply/ui/components/toast"

/** Says why an edit didn't apply. */
export function refused(title: string, e: unknown) {
  toast.add({
    title,
    description: e instanceof Error ? e.message : String(e),
    type: "error",
  })
}

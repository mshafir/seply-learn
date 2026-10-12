// Waiting for approval (spec §3.12; WP-7.3). With hosted access approval on,
// an account that isn't approved yet reads as usual, sees a calm banner in the
// Library, and finds Create, Import and Fork still there: they open a small
// dialog with the same explanation instead of failing. Both offer Request
// access (an optional note), then "Request sent" with the date.
import * as React from "react"
import { ClockIcon, SendIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import { Field, FieldLabel } from "@seply/ui/components/field"
import { Spinner } from "@seply/ui/components/spinner"
import { Textarea } from "@seply/ui/components/textarea"
import { toast } from "@seply/ui/components/toast"

import { requestAccess, type AccessState } from "@/lib/api.ts"
import { useWaiting, WAITING_COPY } from "@/lib/approval.ts"
import { useSession } from "@/lib/session.ts"

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

/**
 * Request access: a button that opens an optional note, then "Request sent"
 * with the date. One pending request per account.
 */
function RequestAccess({ access }: { access: AccessState }) {
  const { setAccess } = useSession()
  const [writing, setWriting] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [sending, setSending] = React.useState(false)

  if (access.request)
    return (
      <p data-testid="request-sent" className="text-sm text-foreground">
        Request sent on {dateFormat.format(new Date(access.request.createdAt))}.
        An admin will look at it soon.
      </p>
    )

  const send = async () => {
    setSending(true)
    try {
      const request = await requestAccess(note.trim())
      setAccess({ ...access, request })
    } catch (e) {
      toast.add({
        title: "Couldn't send your request",
        description: (e as Error).message,
        type: "error",
      })
    } finally {
      setSending(false)
    }
  }

  if (!writing)
    return (
      <div>
        <Button size="sm" onClick={() => setWriting(true)}>
          Request access
        </Button>
      </div>
    )

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <Field>
        <FieldLabel htmlFor="access-note">
          A note for the admins (optional)
        </FieldLabel>
        <Textarea
          id="access-note"
          value={note}
          rows={2}
          maxLength={1000}
          placeholder="What would you like to use Seply Learn for?"
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={sending}>
          {sending ? <Spinner /> : <SendIcon />}
          Send request
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={sending}
          onClick={() => setWriting(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** The Library's banner while the account waits for approval. */
export function WaitingListBanner() {
  const access = useWaiting()
  if (!access) return null
  return (
    <Alert role="status" data-testid="waiting-list-banner">
      <ClockIcon />
      <AlertTitle>Waiting for approval</AlertTitle>
      <AlertDescription>
        <p>{WAITING_COPY}</p>
        <RequestAccess access={access} />
      </AlertDescription>
    </Alert>
  )
}

/** Create, Import and Fork open this instead of failing. */
export function WaitingListDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const access = useWaiting()
  return (
    <Dialog open={open && !!access} onOpenChange={onOpenChange}>
      <DialogContent data-testid="waiting-list-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Waiting for approval</DialogTitle>
          <DialogDescription>{WAITING_COPY}</DialogDescription>
        </DialogHeader>
        {access && <RequestAccess access={access} />}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

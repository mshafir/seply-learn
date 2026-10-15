// This server's AI (spec §2.6, §3.12; WP-7.3). Everyone can sign up and
// create; with hosted access approval on, only accounts an admin has enabled
// use the server's AI key. The rest bring their own key (AI_KEY_MODE=both) or
// their own agent over MCP. Here: the request form (an optional note, then
// "Request sent" with the date), the dialog around it, the link that opens
// it (or says it was asked for), and the short line shown where AI is needed
// but there's no key to use.
import * as React from "react"
import { SendIcon } from "lucide-react"
import { Link } from "wouter"

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

import { ConnectLink } from "@/connect/connect-link.tsx"
import { serverAiAskable } from "@/lib/ai-setup.ts"
import { requestAccess, type AccessState, type AiOverview } from "@/lib/api.ts"
import { SERVER_AI_COPY, useServerAiRequest } from "@/lib/approval.ts"
import { useSession } from "@/lib/session.ts"

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

/**
 * Ask to use this server's AI: a button that opens an optional note, then
 * "Request sent" with the date. One pending request per account.
 */
export function RequestServerAi({ access }: { access: AccessState }) {
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
        <Button size="sm" variant="outline" onClick={() => setWriting(true)}>
          Ask to use this server's AI
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

/** The request form in a dialog, opened from a `NoServerAi` line. */
export function ServerAiDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const access = useServerAiRequest()
  return (
    <Dialog open={open && !!access} onOpenChange={onOpenChange}>
      <DialogContent data-testid="server-ai-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use this server's AI</DialogTitle>
          <DialogDescription>{SERVER_AI_COPY}</DialogDescription>
        </DialogHeader>
        {access && <RequestServerAi access={access} />}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

const inline = "underline underline-offset-4 hover:text-foreground"

/**
 * "Ask to use this server's AI", opening the request dialog; once asked,
 * "Requested" with the date. Only in both mode, when the server has AI of
 * its own that isn't on for the account.
 */
export function AskServerAi({
  ai,
  className,
}: {
  ai: AiOverview | null
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const access = useServerAiRequest()
  if (!access || !serverAiAskable(ai)) return null
  return (
    <>
      {access.request ? (
        <span
          data-testid="server-ai-requested"
          className={`text-muted-foreground ${className ?? ""}`}
        >
          You asked to use this server's AI on{" "}
          {dateFormat.format(new Date(access.request.createdAt))}.
        </span>
      ) : (
        <Button
          variant="link"
          className={className}
          data-testid="ask-server-ai"
          onClick={() => setOpen(true)}
        >
          Ask to use this server's AI
        </Button>
      )}
      {/* Stays mounted once asked, so the dialog can say "Request sent". */}
      <ServerAiDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/**
 * Where AI is needed and the account has no key it may use: one short line.
 * `needs-key`: no key of its own and the server's AI isn't on for it (both
 * mode). `approval`: the server's AI isn't on for it, and it can't add a key
 * (instance mode).
 */
export function NoServerAi({
  reason,
  className,
  "data-testid": testId = "no-server-ai",
}: {
  reason: "needs-key" | "approval"
  className?: string
  "data-testid"?: string
}) {
  const [open, setOpen] = React.useState(false)
  const canAsk = useServerAiRequest() !== null
  const ask = canAsk ? (
    <button type="button" className={inline} onClick={() => setOpen(true)}>
      {reason === "approval" ? "Ask" : "ask"} to use this server's AI
    </button>
  ) : (
    `${reason === "approval" ? "Ask" : "ask"} an admin to turn on this server's AI`
  )
  return (
    <>
      <p data-testid={testId} className={className}>
        {reason === "needs-key" ? (
          <>
            Add your own AI key in{" "}
            <Link href="/settings#ai" className={inline}>
              Settings
            </Link>
            , {ask}, or use your own agent over{" "}
            <ConnectLink as="text">MCP</ConnectLink>.
          </>
        ) : (
          <>
            {ask}, or use your own agent over{" "}
            <ConnectLink as="text">MCP</ConnectLink>.
          </>
        )}
      </p>
      <ServerAiDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

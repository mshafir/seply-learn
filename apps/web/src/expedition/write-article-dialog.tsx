// "Write the article" asks before it spends (spec §3.7): how long an article,
// with what each length would cost on this Expedition's Sources. Cancel
// spends nothing. A length over the reader's per-ask cap says so, and
// confirming it lets that one ask spend up to half again its estimate.
import * as React from "react"
import { PenLineIcon } from "lucide-react"
import { Link } from "wouter"

import { Alert, AlertDescription } from "@seply/ui/components/alert"
import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import { Label } from "@seply/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@seply/ui/components/radio-group"
import { Skeleton } from "@seply/ui/components/skeleton"

import { formatUsd } from "@/create/flow.ts"
import {
  ApiError,
  type ArticleEstimate,
  type ArticleLength,
} from "@/lib/api.ts"

const LENGTHS: { id: ArticleLength; label: string; hint: string }[] = [
  { id: "short", label: "Short", hint: "The essentials, in a few sections" },
  { id: "standard", label: "Standard", hint: "How it works, why it matters" },
  { id: "long", label: "Long", hint: "In depth, with examples" },
]

/** What "Write it" starts: the length, and a cap when it's over the reader's. */
export type ArticleRequest = { length: ArticleLength; capUsd?: number }

export function WriteArticleDialog({
  open,
  onOpenChange,
  conceptTitle,
  estimate,
  onWrite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conceptTitle: string
  /** Prices each length (asked each time the dialog opens). */
  estimate: () => Promise<ArticleEstimate>
  onWrite: (request: ArticleRequest) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="write-article-dialog" className="sm:max-w-md">
        {/* Mounted only while open: each opening prices afresh. */}
        <ChooseLength
          conceptTitle={conceptTitle}
          estimate={estimate}
          onWrite={(request) => {
            onWrite(request)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

type Pricing =
  | { status: "loading" }
  | { status: "ready"; estimate: ArticleEstimate }
  | { status: "failed"; reason: string; noKey: boolean }

function ChooseLength({
  conceptTitle,
  estimate,
  onWrite,
}: {
  conceptTitle: string
  estimate: () => Promise<ArticleEstimate>
  onWrite: (request: ArticleRequest) => void
}) {
  const [length, setLength] = React.useState<ArticleLength>("standard")
  const [state, setState] = React.useState<Pricing>({ status: "loading" })

  // Priced once per opening (the caller's function may change every render).
  const price = React.useEffectEvent(() => estimate())
  React.useEffect(() => {
    let live = true
    price().then(
      (e) => live && setState({ status: "ready", estimate: e }),
      (err: unknown) => {
        if (!live) return
        const noKey =
          err instanceof ApiError &&
          (err.body.error === "no-key" || err.body.error === "not-configured")
        setState({
          status: "failed",
          noKey,
          reason: noKey
            ? "There's no AI key to write with yet."
            : err instanceof Error
              ? err.message
              : String(err),
        })
      }
    )
    return () => {
      live = false
    }
  }, [])

  const ready = state.status === "ready" ? state.estimate : null
  const chosen = ready?.lengths[length]
  const overCap = !!chosen && !!ready && chosen.usd > ready.askCapUsd
  const capUsd = overCap
    ? Math.min(20, Math.ceil(chosen!.usd * 1.5 * 100) / 100)
    : undefined

  return (
    <>
      <DialogHeader>
        <DialogTitle>Write the article for {conceptTitle}</DialogTitle>
        <DialogDescription>
          The AI writes it from this Expedition's Sources. It's suggested for
          review before it's added.
        </DialogDescription>
      </DialogHeader>

      <RadioGroup
        aria-label="Length"
        value={length}
        onValueChange={(v) => setLength(v as ArticleLength)}
        className="gap-2"
      >
        {LENGTHS.map((l) => {
          const priced = ready?.lengths[l.id]
          return (
            <Label
              key={l.id}
              data-testid={`article-length-${l.id}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5"
            >
              <RadioGroupItem value={l.id} className="mt-0.5" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{l.label}</span>
                  {priced ? (
                    <span
                      data-testid="article-cost"
                      className="text-sm text-muted-foreground tabular-nums"
                    >
                      about {formatUsd(priced.usd)}
                    </span>
                  ) : state.status === "loading" ? (
                    <Skeleton className="h-4 w-16" />
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {priced
                    ? `About ${priced.words.toLocaleString()} words. `
                    : ""}
                  {l.hint}
                </span>
              </span>
            </Label>
          )
        })}
      </RadioGroup>

      {state.status === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.reason}{" "}
            {state.noKey && (
              <Link href="/settings" className="underline">
                Add one in Settings
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {overCap && (
        <Alert data-testid="article-over-cap">
          <AlertDescription>
            That's more than your {formatUsd(ready!.askCapUsd)} limit per ask.
            Writing it lets this one spend up to {formatUsd(capUsd!)}.
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button
          disabled={!chosen}
          onClick={() =>
            onWrite({ length, ...(capUsd !== undefined && { capUsd }) })
          }
        >
          <PenLineIcon />
          {chosen ? `Write it · about ${formatUsd(chosen.usd)}` : "Write it"}
        </Button>
      </DialogFooter>
    </>
  )
}

// The header activity indicator (spec §3.5): while a build runs, a button
// with its progress ("Building · 1 of 3 Views ready") opens a popover with
// the step, each View's status, and the controls: Cancel (keeps the finished
// Views) and "Leave it building; we'll notify you". At the spending cap it
// reads "Paused" and offers Continue or Stop.
//
// "Leave it building" asks first (a Dialog), then the browser's permission
// prompt (lib/push.ts), then goes back to the Library.
import * as React from "react"
import { BellRingIcon, CirclePauseIcon, XIcon } from "lucide-react"
import { useLocation } from "wouter"

import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@seply/ui/components/popover"
import { Progress } from "@seply/ui/components/progress"
import { Separator } from "@seply/ui/components/separator"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"
import type { ViewRow } from "@seply/sync"

import {
  readyLabel,
  type BuildSummary,
  type ViewBuild,
} from "@/expedition/build-state.ts"
import { viewTypeMeta } from "@/expedition/labels.ts"
import { enablePush, type PushOutcome } from "@/lib/push.ts"

const STATUS_LABEL: Record<ViewBuild["status"], string> = {
  ready: "Ready",
  queued: "Queued",
  building: "Building",
  failed: "Failed",
  stopped: "Not built",
}

const STATUS_VARIANT = {
  ready: "success",
  queued: "queued",
  building: "progress",
  failed: "destructive",
  stopped: "queued",
} as const

export function BuildActivity({
  summary,
  views,
  buildOf,
  canEdit,
  onCancel,
  onContinue,
}: {
  summary: BuildSummary
  views: ViewRow[]
  buildOf: (view: ViewRow) => ViewBuild
  canEdit: boolean
  /** Cancel, or Stop at the spending cap. */
  onCancel: () => Promise<unknown>
  onContinue: () => Promise<unknown>
}) {
  const [open, setOpen] = React.useState(false)
  const [leaving, setLeaving] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const job = summary.job
  if (!job) return null
  const paused = job.status === "paused"
  // Every View is done: the writers are writing overviews and articles.
  const writing = !paused && summary.pending === 0
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true)
    fn().finally(() => setBusy(false))
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              data-testid="build-activity"
              data-status={job.status}
              className="min-w-0 gap-1.5"
            />
          }
        >
          {paused ? (
            <CirclePauseIcon className="text-suggested-text" />
          ) : (
            <Spinner className="text-suggested-text" />
          )}
          <span className="truncate">
            {paused ? "Paused" : writing ? "Writing" : "Building"}
            <span className="hidden text-muted-foreground sm:inline">
              {" · "}
              {readyLabel(summary)}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80" data-testid="build-panel">
          <PopoverHeader>
            <PopoverTitle>
              {paused
                ? "Paused at the spending cap"
                : writing
                  ? "Writing overviews and articles"
                  : "Building"}
            </PopoverTitle>
            <PopoverDescription>
              {paused
                ? `${job.reason ?? "The build reached its spending cap"}. Continue to spend as much again, or stop and keep the finished Views.`
                : `${job.step ?? "Starting"} · You can start reading as Views finish.`}
            </PopoverDescription>
          </PopoverHeader>
          <Progress
            value={Math.round(job.progress * 100)}
            aria-label="Build progress"
            className="**:data-[slot=progress-indicator]:bg-suggested"
          />
          <ul className="flex flex-col gap-1.5">
            {views.map((v) => {
              const b = buildOf(v)
              return (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {v.label || viewTypeMeta(v.viewType).name}
                  </span>
                  <Badge variant={STATUS_VARIANT[b.status]}>
                    {STATUS_LABEL[b.status]}
                  </Badge>
                </li>
              )
            })}
          </ul>
          <Separator />
          <div className="flex flex-wrap justify-end gap-2">
            {paused && canEdit ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(onCancel)}
                >
                  Stop
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => run(onContinue)}
                >
                  Continue
                </Button>
              </>
            ) : (
              <>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => run(onCancel)}
                  >
                    <XIcon />
                    Cancel
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    setLeaving(true)
                  }}
                >
                  <BellRingIcon />
                  Leave it building
                </Button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <LeaveBuildingDialog open={leaving} onOpenChange={setLeaving} />
    </>
  )
}

const OUTCOME_TOAST: Record<
  PushOutcome,
  { title: string; type?: "success" | "info" }
> = {
  enabled: { title: "We'll notify you when it's built", type: "success" },
  denied: { title: "Notifications are off for this site" },
  unsupported: { title: "This browser can't notify you" },
  unavailable: { title: "Notifications aren't set up on this server" },
}

/** "Leave it building; we'll notify you": the web push prompt, then the Library. */
export function LeaveBuildingDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [, navigate] = useLocation()
  const [asking, setAsking] = React.useState(false)

  const leave = (outcome: PushOutcome | null) => {
    onOpenChange(false)
    if (outcome) {
      const t = OUTCOME_TOAST[outcome]
      toast.add({
        title: t.title,
        description:
          outcome === "enabled"
            ? undefined
            : "The Library shows how the build is going.",
        type: t.type,
      })
    }
    navigate("/")
  }

  const notify = () => {
    setAsking(true)
    enablePush()
      .catch((e) => {
        console.error("push: enabling failed", e)
        return "unavailable" as const
      })
      .then((outcome) => {
        setAsking(false)
        leave(outcome)
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="leave-building">
        <DialogHeader>
          <DialogTitle>Leave it building</DialogTitle>
          <DialogDescription>
            The build carries on without this page. We can send a notification
            to this device when it's done; your browser will ask first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={asking}
            onClick={() => leave(null)}
          >
            Just leave
          </Button>
          <Button disabled={asking} onClick={notify}>
            {asking ? <Spinner /> : <BellRingIcon />}
            Notify me
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

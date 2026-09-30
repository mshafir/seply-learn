// Create: Choose Views (spec §3.4, canvas 02b). The skim's proposed Views as
// cards (the View Type thumbnail, the question in the reader's words, and
// why it was proposed), the 3–4 best pre-selected; "Suggest more Views",
// "Ask for a specific View", and a live "N Concepts found across M Sources"
// counter. There is no Concept review step. "Create Expedition with N Views"
// saves the chosen Views (queued) and hands the draft to the build; "Save
// draft" keeps everything for later.
import * as React from "react"
import { PlusIcon, SendHorizontalIcon, SparklesIcon } from "lucide-react"
import { Link, useLocation } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import { Checkbox } from "@seply/ui/components/checkbox"
import { Field, FieldLabel } from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@seply/ui/components/input-group"
import { Progress } from "@seply/ui/components/progress"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"
import { ViewTypeThumbnail } from "@seply/ui/components/view-type-thumbnail"

import { viewTypeMeta } from "@/expedition/labels.ts"
import {
  ApiError,
  runSkim,
  savePlan,
  startBuild,
  type SkimAsk,
  type SkimAnswer,
} from "@/lib/api.ts"

import type { Flow } from "./create-screen.tsx"
import {
  addProposals,
  chosenInOrder,
  counterLabel,
  createLabel,
  existingOf,
  fromDraft,
  fromProposal,
  hasOwnTitle,
  planViews,
  sourcesKey,
  toggle,
  withSavedIds,
  writeCache,
  type Choice,
  type Proposal,
} from "./flow.ts"

/** The skim takes 10–20 s; the bar fills over this long, then waits. */
const EXPECTED_SKIM_MS = 15_000
/** How often the live counter asks the server. */
const COUNTER_POLL_MS = 3000

type SkimState =
  | { status: "idle" }
  | { status: "running"; mode: SkimAsk["mode"]; started: number }
  | { status: "failed"; mode: SkimAsk["mode"]; error: ApiError | Error }

function skimProblem(e: ApiError | Error): { title: string; body: React.ReactNode } {
  if (e instanceof ApiError && e.body.error === "no-key")
    return {
      title: "Add an AI key to propose Views",
      body: (
        <>
          This server uses your own key. Add one in{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          , then try again. Your Sources are saved.
        </>
      ),
    }
  if (e instanceof ApiError && e.body.error === "not-configured")
    return {
      title: "AI isn't set up on this server",
      body: "Ask whoever runs it to add an AI key. Your Sources are saved.",
    }
  return {
    title: "Couldn't propose Views",
    body: e instanceof ApiError && e.body.message ? e.body.message : e.message,
  }
}

function useElapsed(since: number | null): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (since === null) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [since])
  return since === null ? 0 : Math.max(0, now - since)
}

export function ChooseViewsStep({ flow }: { flow: Flow }) {
  const { draft, expeditionId, cache, setCache, refresh } = flow
  const [, navigate] = useLocation()
  const key = sourcesKey(draft.sources)
  // The cache is this tab's skim of these Sources; a different set skims again.
  const cached = cache.sources === key ? cache.choice : null
  const saved = React.useMemo(() => fromDraft(draft), [draft])
  const choice: Choice | null = cached ?? (saved.proposals.length ? saved : null)
  const [skim, setSkim] = React.useState<SkimState>({ status: "idle" })
  const [ask, setAsk] = React.useState("")
  const [busy, setBusy] = React.useState<"save" | "create" | null>(null)
  const elapsed = useElapsed(skim.status === "running" ? skim.started : null)
  const title = cache.sources === key && cache.title ? cache.title : draft.expedition.title
  const abort = React.useRef<AbortController | null>(null)

  const setChoice = React.useCallback(
    (next: Choice, extra: Partial<{ title: string; summary: string }> = {}) =>
      setCache((c) => ({
        ...c,
        ...(c.sources === key ? {} : { title: "", summary: "" }),
        ...extra,
        sources: key,
        choice: next,
      })),
    [setCache, key]
  )

  const run = React.useCallback(
    async (req: SkimAsk) => {
      abort.current?.abort()
      const ctl = new AbortController()
      abort.current = ctl
      setSkim({ status: "running", mode: req.mode, started: Date.now() })
      let answer: SkimAnswer
      try {
        answer = await runSkim(expeditionId, req, ctl.signal)
      } catch (e) {
        if (ctl.signal.aborted) return
        setSkim({ status: "failed", mode: req.mode, error: e as Error })
        return
      }
      setSkim({ status: "idle" })
      const { skim: out } = answer
      if (req.mode === "propose") {
        setChoice(fromProposal(out.views), {
          title: hasOwnTitle(draft.expedition.title) ? draft.expedition.title : out.title,
          summary: out.summary,
        })
        return
      }
      const before = choice ?? { proposals: [], chosen: [] }
      const next = addProposals(before, out.views, req.mode === "ask")
      if (next.proposals.length === before.proposals.length)
        toast.add({
          title: "Nothing new to suggest",
          description: "These Sources don't raise other questions the Views can answer.",
        })
      setChoice(next)
      if (req.mode === "ask") setAsk("")
    },
    [expeditionId, setChoice, choice, draft.expedition.title]
  )

  // First visit with these Sources: skim.
  const started = React.useRef(false)
  React.useEffect(() => {
    if (started.current || choice) return
    started.current = true
    void run({ mode: "propose", goals: cache.goals })
  }, [choice, run, cache.goals])
  React.useEffect(() => () => abort.current?.abort(), [])

  // The live counter: Concepts found so far (the build's, once it runs).
  React.useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, COUNTER_POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const chosen = choice ? chosenInOrder(choice) : []
  const running = skim.status === "running"

  const save = async (then: "save" | "create") => {
    if (!choice) return
    setBusy(then)
    try {
      const after = await savePlan(expeditionId, {
        title: title.trim() || "Untitled Expedition",
        ...(cache.summary ? { summary: cache.summary } : {}),
        views: planViews(choice),
      })
      setChoice(withSavedIds(choice, after))
      if (then === "save") {
        toast.add({
          title: "Draft saved",
          description: "It's in your Library under Drafts.",
          type: "success",
        })
        navigate("/")
        return
      }
      try {
        await startBuild(expeditionId, cache.goals)
        writeCache(expeditionId, null)
        navigate(`/e/${expeditionId}`)
      } catch (e) {
        // 501: this server runs no jobs (the draft stays a draft).
        if (e instanceof ApiError && e.status === 501) {
          toast.add({
            title: "Your draft is saved",
            description: e.body.message ?? "Building isn't available yet.",
          })
          navigate("/")
          return
        }
        throw e
      }
    } catch (e) {
      toast.add({
        title: then === "save" ? "Couldn't save the draft" : "Couldn't create the Expedition",
        description: e instanceof ApiError && e.body.message ? e.body.message : (e as Error).message,
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const problem = skim.status === "failed" ? skimProblem(skim.error) : null
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-reading text-3xl font-medium">Here are the questions your Sources raise</h1>
        <p className="text-muted-foreground">
          Each View answers one. Pick the ones to start with; the first you pick is where the
          Expedition opens.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Field className="max-w-md">
          <FieldLabel htmlFor="expedition-title">Title</FieldLabel>
          <Input
            id="expedition-title"
            value={title}
            maxLength={200}
            disabled={!choice}
            onChange={(e) => setCache((c) => ({ ...c, sources: key, choice, title: e.target.value }))}
          />
        </Field>
        <Badge variant="outline" className="h-7 px-3 text-sm" data-testid="concept-counter" aria-live="polite">
          {counterLabel(draft.counts.concepts, draft.counts.sources)}
        </Badge>
      </div>

      {problem && (
        <Alert variant="destructive">
          <AlertTitle>{problem.title}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{problem.body}</span>
            {skim.status === "failed" && skim.mode === "propose" && (
              <Button variant="outline" size="sm" onClick={() => void run({ mode: "propose", goals: cache.goals })}>
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {running && (
        <Progress
          value={Math.min(95, (elapsed / EXPECTED_SKIM_MS) * 100)}
          aria-label="Reading your Sources"
          className="max-w-md"
        >
          <span className="text-sm text-muted-foreground">
            {skim.mode === "propose"
              ? "Reading your Sources to find the questions they raise. This takes 10 to 20 seconds."
              : skim.mode === "more"
                ? "Looking for other questions…"
                : "Working out that View…"}
          </span>
        </Progress>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="view-cards">
        {choice?.proposals.map((p) => (
          <ViewCard
            key={p.key}
            proposal={p}
            on={choice.chosen.includes(p.key)}
            best={chosen[0]?.key === p.key}
            onChange={(on) => setChoice(toggle(choice, p.key, on))}
          />
        ))}
        {running && skim.mode === "propose" &&
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>

      {choice && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Suggest more Views</CardTitle>
              <CardDescription>Other questions these Sources could answer.</CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  disabled={running}
                  onClick={() => void run({ mode: "more", goals: cache.goals, ...existingOf(choice) })}
                >
                  {running && skim.mode === "more" ? <Spinner /> : <PlusIcon />}
                  Suggest more
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <label htmlFor="ask-view">Ask for a specific View</label>
              </CardTitle>
              <form
                className="col-span-full"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (ask.trim())
                    void run({ mode: "ask", goals: cache.goals, request: ask.trim(), ...existingOf(choice) })
                }}
              >
                <InputGroup>
                  <InputGroupInput
                    id="ask-view"
                    value={ask}
                    maxLength={500}
                    placeholder="A timeline of when each idea appeared"
                    onChange={(e) => setAsk(e.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton type="submit" disabled={!ask.trim() || running}>
                      {running && skim.mode === "ask" ? <Spinner /> : <SendHorizontalIcon />}
                      Propose it
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </form>
            </CardHeader>
          </Card>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col-reverse gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-muted-foreground">
          You can add, change or remove Views any time after the Expedition is built.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" disabled={!choice || !!busy} onClick={() => void save("save")}>
            {busy === "save" && <Spinner />}
            Save draft
          </Button>
          <Button disabled={!chosen.length || !!busy || running} onClick={() => void save("create")}>
            {busy === "create" ? <Spinner /> : <SparklesIcon />}
            {createLabel(chosen.length)}
          </Button>
        </div>
      </div>
    </main>
  )
}

function ViewCard({
  proposal,
  on,
  best,
  onChange,
}: {
  proposal: Proposal
  on: boolean
  best: boolean
  onChange: (on: boolean) => void
}) {
  const meta = viewTypeMeta(proposal.viewType)
  return (
    <label className="block cursor-pointer">
      <Card
        data-testid="view-card"
        data-selected={on || undefined}
        className="h-full pt-0 transition-colors hover:bg-accent/40 data-selected:ring-2 data-selected:ring-primary"
      >
        <div className="flex h-28 items-center justify-center border-b bg-sidebar px-6 py-3">
          <ViewTypeThumbnail viewType={proposal.viewType} className="max-h-full w-auto" />
        </div>
        <CardHeader>
          <CardDescription className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
            <meta.icon className="size-3.5" aria-hidden />
            {meta.name}
            {best && <Badge variant="secondary">Opens here</Badge>}
          </CardDescription>
          <CardTitle className="font-reading text-lg leading-snug font-medium">{proposal.question}</CardTitle>
          <CardAction>
            <Checkbox checked={on} onCheckedChange={(v) => onChange(v === true)} aria-label={proposal.question} />
          </CardAction>
          {proposal.why && <CardDescription>{proposal.why}</CardDescription>}
        </CardHeader>
      </Card>
    </label>
  )
}

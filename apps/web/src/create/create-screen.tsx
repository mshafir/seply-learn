// The create flow (spec §3.3, §3.4; canvases 02a and 02b): Sources, then
// Choose Views, then the Expedition opens (building: WP-3.5b and WP-3.7).
//   /new/:id         Sources: paste a chat, drop files, write a prompt; goal
//                    chips; the Sources list; the estimate; Next.
//   /new/:id/views   Choose Views: the skim's proposals as cards, Suggest more,
//                    Ask for a specific View, the live Concept counter, the
//                    title; Save draft or Create.
// The Expedition is a draft from New onwards: Sources are saved as they're
// added, and the chosen Views when the reader saves or creates.
import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"
import { Link, Redirect, useLocation } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Button } from "@seply/ui/components/button"
import { Spinner } from "@seply/ui/components/spinner"
import { StepIndicator } from "@seply/ui/components/step-indicator"

import { AccountMenu } from "@/components/account-menu.tsx"
import { ApiError, getDraft, type Draft, type Goal } from "@/lib/api.ts"

import { ChooseViewsStep } from "./choose-views-step.tsx"
import { readCache, writeCache, type FlowCache } from "./flow.ts"
import { SourcesStep } from "./sources-step.tsx"

const STEPS = ["Sources", "Choose Views", "Open"] as const

type DraftState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; draft: Draft }

/** The flow's shared state: the draft, the goals and Choose Views' choices. */
export type Flow = {
  expeditionId: string
  draft: Draft
  refresh: () => Promise<Draft | null>
  cache: FlowCache
  setCache: (update: (c: FlowCache) => FlowCache) => void
}

const emptyCache = (): FlowCache => ({
  sources: "",
  goals: [],
  choice: null,
  title: "",
  summary: "",
})

export function CreateScreen({
  expeditionId,
  step,
}: {
  expeditionId: string
  step: "sources" | "views"
}) {
  const [state, setState] = React.useState<DraftState>({ status: "loading" })
  const [cache, setCacheState] = React.useState<FlowCache>(
    () => readCache(expeditionId) ?? emptyCache()
  )
  const [, navigate] = useLocation()

  const refresh = React.useCallback(async () => {
    try {
      const draft = await getDraft(expeditionId)
      setState({ status: "ready", draft })
      return draft
    } catch (e) {
      setState((s) => (s.status === "ready" ? s : { status: "error", error: e as Error }))
      return null
    }
  }, [expeditionId])
  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // Written through at once (not in a state updater), so a save that
  // navigates away right after still leaves the cache up to date.
  const latest = React.useRef(cache)
  const setCache = React.useCallback(
    (update: (c: FlowCache) => FlowCache) => {
      const next = update(latest.current)
      latest.current = next
      writeCache(expeditionId, next)
      setCacheState(next)
    },
    [expeditionId]
  )

  // A built Expedition (or one being built) opens as itself.
  const built = state.status === "ready" && state.draft.expedition.status !== "draft"
  const viewer = state.status === "ready" && state.draft.expedition.role === "viewer"
  React.useEffect(() => {
    if (built || viewer) navigate(`/e/${expeditionId}`, { replace: true })
  }, [built, viewer, expeditionId, navigate])

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
        <Button variant="ghost" size="sm" render={<Link href="/" />}>
          <ArrowLeftIcon />
          Library
        </Button>
        <span className="hidden font-medium md:inline">New Expedition</span>
        <div className="flex flex-1 justify-center">
          <StepIndicator steps={STEPS} current={step === "sources" ? 0 : 1} />
        </div>
        <AccountMenu />
      </header>
      {state.status === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      )}
      {state.status === "error" && (
        <div className="mx-auto w-full max-w-xl p-6">
          <Alert variant="destructive">
            <AlertTitle>
              {state.error instanceof ApiError && state.error.status === 404
                ? "This draft wasn't found"
                : "Couldn't open this draft"}
            </AlertTitle>
            <AlertDescription>{state.error.message}</AlertDescription>
          </Alert>
        </div>
      )}
      {state.status === "ready" && !built && !viewer && (
        <FlowStep
          step={step}
          flow={{ expeditionId, draft: state.draft, refresh, cache, setCache }}
        />
      )}
    </div>
  )
}

function FlowStep({ step, flow }: { step: "sources" | "views"; flow: Flow }) {
  const [, navigate] = useLocation()
  const setGoals = (goals: Goal[]) => flow.setCache((c) => ({ ...c, goals }))
  if (step === "sources")
    return (
      <SourcesStep
        flow={flow}
        onGoals={setGoals}
        onNext={() => navigate(`/new/${flow.expeditionId}/views`)}
      />
    )
  // Nothing to skim: back to Sources.
  if (!flow.draft.sources.length)
    return <Redirect to={`/new/${flow.expeditionId}`} replace />
  return <ChooseViewsStep flow={flow} />
}

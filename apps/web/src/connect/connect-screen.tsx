// Connect an agent (spec §6.4): from nothing to an agent's first result, in
// four steps on one page. Choose the agent, copy its install commands (with
// this server's address filled in), sign in from the agent, copy a first
// prompt. What each step says comes from steps.ts.
//
// - The sign-in step watches Connected agents and ticks itself when a new
//   agent appears (or a token is first used).
// - `?e=<id>` (an Expedition the reader can suggest on) turns the first
//   prompt into one about that Expedition.
// - If the server can't say what it is, the self-hosted steps show: they
//   work everywhere.
import * as React from "react"
import { ArrowLeftIcon, CheckIcon } from "lucide-react"
import { Link, useSearch } from "wouter"

import { Badge } from "@seply/ui/components/badge"
import { Wordmark } from "@seply/ui/components/brand"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import { Spinner } from "@seply/ui/components/spinner"

import { AccountMenu } from "@/components/account-menu.tsx"
import {
  AgentTabs,
  ConnectStatus,
  FirstPrompts,
  Install,
} from "@/connect/agent-setup.tsx"
import {
  useAgentChoice,
  useInstance,
  useNewAgent,
} from "@/connect/agent-hooks.ts"
import { installSteps, signInSteps } from "@/connect/steps.ts"
import { listExpeditions } from "@/lib/api.ts"

/** A numbered step. */
function Step({
  n,
  title,
  description,
  done,
  children,
}: {
  n: number
  title: string
  description?: string
  done?: boolean
  children: React.ReactNode
}) {
  return (
    <Card data-testid={`connect-step-${n}`} data-done={done || undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge
            variant={done ? "secondary" : "default"}
            className="size-6 rounded-full p-0 tabular-nums"
          >
            {done ? <CheckIcon aria-label="done" /> : n}
          </Badge>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

type Named = { id: string; title: string }

/**
 * The Expedition `?e=` names, when the reader can suggest on it; null when
 * there is none (the create prompts show), undefined while it loads.
 */
function useExpedition(id: string | null): Named | null | undefined {
  const [found, setFound] = React.useState<Named | null | undefined>(undefined)
  React.useEffect(() => {
    if (!id) return
    let live = true
    listExpeditions().then(
      (all) => {
        const e = all.find((x) => x.id === id && x.role !== "viewer")
        if (live) setFound(e ? { id: e.id, title: e.title } : null)
      },
      () => live && setFound(null)
    )
    return () => {
      live = false
    }
  }, [id])
  return id ? found : null
}

export function ConnectScreen() {
  const expedition = useExpedition(new URLSearchParams(useSearch()).get("e"))
  const { agent, label, choose } = useAgentChoice()
  const instance = useInstance()
  const { overview, connected } = useNewAgent()
  const back = expedition ? `/e/${expedition.id}` : "/"

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
        <Link href="/" aria-label="Library">
          <Wordmark />
        </Link>
        <div className="flex-1" />
        <AccountMenu />
      </header>
      <main
        data-testid="connect"
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                expedition ? "Back to the Expedition" : "Back to the Library"
              }
              render={<Link href={back} />}
            >
              <ArrowLeftIcon />
            </Button>
            <h1 className="text-2xl font-semibold">Connect an agent</h1>
          </div>
          <p className="text-muted-foreground">
            The AI agent you already use can read your Expeditions, create new
            ones from a chat and suggest changes. Its suggestions wait in
            Suggestions until you accept them.
          </p>
        </div>

        <Step n={1} title="Choose your agent">
          <AgentTabs agent={agent} onChange={choose} />
        </Step>

        <Step n={2} title={`Add Seply Learn to ${label}`}>
          {instance ? (
            <Install
              items={installSteps(agent, window.location.origin, instance)}
              overview={overview}
            />
          ) : (
            <Spinner className="text-muted-foreground" />
          )}
        </Step>

        <Step n={3} title="Sign in from the agent" done={!!connected}>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            {signInSteps(agent).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <ConnectStatus connected={connected} />
        </Step>

        <Step
          n={4}
          title="Give it a first prompt"
          description={
            expedition
              ? `Paste this into ${label}.`
              : `Paste one of these into ${label}.`
          }
        >
          {expedition === undefined && (
            <Spinner className="text-muted-foreground" />
          )}
          {expedition !== undefined && <FirstPrompts expedition={expedition} />}
          <div>
            <Button variant="outline" render={<Link href={back} />}>
              {expedition ? "Back to the Expedition" : "Go to the Library"}
            </Button>
          </div>
        </Step>
      </main>
    </div>
  )
}

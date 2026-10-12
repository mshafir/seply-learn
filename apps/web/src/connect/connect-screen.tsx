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
import {
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
} from "lucide-react"
import { Link, useSearch } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
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
import { Tabs, TabsList, TabsTrigger } from "@seply/ui/components/tabs"
import { toast } from "@seply/ui/components/toast"

import { AccountMenu } from "@/components/account-menu.tsx"
import { CopyField } from "@/connect/copy-field.tsx"
import {
  AGENTS,
  firstPrompts,
  installSteps,
  newAgent,
  signInSteps,
  type AgentId,
  type InstallItem,
} from "@/connect/steps.ts"
import {
  createApiToken,
  getAgents,
  getInstance,
  listExpeditions,
  type AgentsOverview,
  type Instance,
} from "@/lib/api.ts"

const AGENT_KEY = "seply-connect-agent"
const POLL_MS = 3000

function rememberedAgent(): AgentId {
  try {
    const saved = localStorage.getItem(AGENT_KEY)
    if (AGENTS.some((a) => a.id === saved)) return saved as AgentId
  } catch {
    // No storage: the first agent.
  }
  return "claude-code"
}

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

/** Makes a token for an agent that can't sign in; its key is shown once. */
function TokenStep({ overview }: { overview: AgentsOverview | null }) {
  const [key, setKey] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  if (key)
    return (
      <Alert data-testid="connect-token">
        <KeyRoundIcon />
        <AlertTitle>Copy your token now</AlertTitle>
        <AlertDescription className="flex min-w-0 flex-col gap-2">
          <span>
            You won't see it again. Anyone with it can act as you. Send it as
            this header:
          </span>
          <CopyField
            id="connect-token-header"
            value={`Authorization: Bearer ${key}`}
            label="header"
          />
        </AlertDescription>
      </Alert>
    )
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={!overview || busy}
        onClick={() => {
          if (!overview) return
          setBusy(true)
          createApiToken({
            name: "My agent",
            scopes: overview.scopes.map((s) => s.id),
            expeditions: null,
          })
            .then(
              (made) => setKey(made.key),
              (e: unknown) =>
                toast.add({
                  title:
                    e instanceof Error ? e.message : "Couldn't make a token.",
                  type: "error",
                })
            )
            .finally(() => setBusy(false))
        }}
      >
        {busy ? <Spinner /> : <KeyRoundIcon />}
        Create a token
      </Button>
      <span className="text-sm text-muted-foreground">
        It can do everything you can.{" "}
        <Link href="/settings" className="underline underline-offset-4">
          Make a narrower one in Settings
        </Link>
        .
      </span>
    </div>
  )
}

function Install({
  items,
  overview,
}: {
  items: InstallItem[]
  overview: AgentsOverview | null
}) {
  return (
    <>
      {items.map((item, i) => {
        switch (item.kind) {
          case "text":
            return (
              <p key={i} className="text-sm text-muted-foreground">
                {item.text}
              </p>
            )
          case "command":
            return (
              <CopyField
                key={i}
                id={`connect-install-${i}`}
                value={item.value}
                label={item.label}
              />
            )
          case "link":
            return (
              <div key={i}>
                <Button render={<a href={item.href} />}>
                  <ExternalLinkIcon />
                  {item.label}
                </Button>
              </div>
            )
          case "token":
            return <TokenStep key={i} overview={overview} />
        }
      })}
    </>
  )
}

/**
 * The reader's connected agents, re-read every few seconds while the page is
 * visible, until one connects: the first reading, and the new agent's name.
 */
function useNewAgent() {
  const [first, setFirst] = React.useState<AgentsOverview | null>(null)
  const [connected, setConnected] = React.useState<string | null>(null)
  const baseline = React.useRef<AgentsOverview | null>(null)
  React.useEffect(() => {
    if (connected) return
    let live = true
    const read = () => {
      if (document.visibilityState !== "visible") return
      getAgents().then(
        (now) => {
          if (!live) return
          if (!baseline.current) {
            baseline.current = now
            setFirst(now)
            return
          }
          const name = newAgent(baseline.current, now)
          if (name) setConnected(name)
        },
        () => {
          // Offline, or a hiccup: the next reading tries again.
        }
      )
    }
    read()
    const timer = window.setInterval(read, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [connected])
  return { overview: first, connected }
}

/** The Expedition `?e=` names, when the reader can suggest on it. */
function useExpedition(id: string | null) {
  const [found, setFound] = React.useState<{
    id: string
    title: string
  } | null>(null)
  React.useEffect(() => {
    if (!id) return
    let live = true
    listExpeditions().then(
      (all) => {
        const e = all.find((x) => x.id === id && x.role !== "viewer")
        if (live && e) setFound({ id: e.id, title: e.title })
      },
      () => {
        // The create prompts show instead.
      }
    )
    return () => {
      live = false
    }
  }, [id])
  return id ? found : null
}

export function ConnectScreen() {
  const expedition = useExpedition(new URLSearchParams(useSearch()).get("e"))
  const [agent, setAgent] = React.useState<AgentId>(rememberedAgent)
  const [instance, setInstance] = React.useState<Instance | null>(null)
  const { overview, connected } = useNewAgent()

  React.useEffect(() => {
    let live = true
    void getInstance().then((i) => live && setInstance(i))
    return () => {
      live = false
    }
  }, [])

  const choose = (id: AgentId) => {
    setAgent(id)
    try {
      localStorage.setItem(AGENT_KEY, id)
    } catch {
      // Not remembered; nothing else changes.
    }
  }
  const label = AGENTS.find((a) => a.id === agent)!.label
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
            Let the AI agent you already use read your Expeditions, make new
            ones from a chat, and suggest changes, as you. What it suggests
            waits in Suggestions until you accept it.
          </p>
        </div>

        <Step n={1} title="Choose your agent">
          <Tabs value={agent} onValueChange={(v) => choose(v as AgentId)}>
            <TabsList className="h-auto w-full flex-wrap sm:w-fit">
              {AGENTS.map((a) => (
                <TabsTrigger key={a.id} value={a.id}>
                  {a.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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
          <p
            role="status"
            data-testid="connect-status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            {connected ? (
              <>
                <CheckIcon className="size-4 text-foreground" />
                <span className="text-foreground">Connected: {connected}</span>
              </>
            ) : (
              <>
                <Spinner />
                Waiting for your agent. This page notices when it connects.
              </>
            )}
          </p>
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
          {firstPrompts(expedition).map((p, i) => (
            <div key={p.prompt} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{p.label}</span>
              <CopyField
                id={`connect-prompt-${i}`}
                value={p.prompt}
                label="prompt"
              />
              <span className="text-sm text-muted-foreground">{p.then}</span>
            </div>
          ))}
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

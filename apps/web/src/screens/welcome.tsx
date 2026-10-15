// The welcome step (spec §3.1): where a new account lands, once. Connect
// the agent you already use: its tabs, then numbered steps (add Seply
// Learn, sign in when the agent asks, ask it for an Expedition) and a status
// line that ticks when the agent's first call arrives. Skip for now, or Go to my Library. The pieces and the words come
// from the setup page's (connect/agent-setup.tsx, connect/steps.ts).
//
// Whether the account has seen it is part of the account (`welcomed` on
// GET /me). The Library sends an account that hasn't here (App.tsx), however
// it signed in: Google, email or the desktop app. Showing it marks the
// account, so leaving by any way counts and the Library won't send it back.
import * as React from "react"
import { Link } from "wouter"

import { Badge } from "@seply/ui/components/badge"
import { Wordmark } from "@seply/ui/components/brand"
import { Button, buttonVariants } from "@seply/ui/components/button"
import { Spinner } from "@seply/ui/components/spinner"

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
import { markWelcomed } from "@/lib/api.ts"
import { useSession, useUser } from "@/lib/session.ts"

/** The first word of a name, for the eyebrow. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ""

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li data-testid={`welcome-step-${n}`} className="flex gap-3.5">
      <Badge
        aria-hidden="true"
        className="size-6 shrink-0 rounded-full bg-sprout p-0 text-calyx tabular-nums"
      >
        {n}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-semibold">{title}</span>
        {children}
      </div>
    </li>
  )
}

export function WelcomeScreen() {
  const user = useUser()
  const { setWelcomed } = useSession()
  const { agent, label, choose } = useAgentChoice()
  const instance = useInstance()
  const { overview, connected } = useNewAgent()
  const name = firstName(user.name)

  // Seen: mark the account, here and on the server. If the call fails, the
  // next load shows the step again.
  const unwelcomed = user.welcomed === false
  React.useEffect(() => {
    if (!unwelcomed) return
    setWelcomed()
    markWelcomed().catch((e) => console.warn("welcome: marking failed", e))
  }, [unwelcomed, setWelcomed])

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center border-b bg-card px-4 sm:px-8">
        <Wordmark />
      </header>
      <main
        data-testid="welcome"
        className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 py-10 sm:px-8"
      >
        <div className="flex flex-col gap-2">
          {name && (
            <span className="font-mono text-xs font-medium tracking-wider text-calyx uppercase">
              Welcome, {name}
            </span>
          )}
          <h1 className="font-reading text-3xl font-medium">
            Connect your agent
          </h1>
          <p className="text-base text-muted-foreground">
            Your agent reads your Expeditions, builds new ones from a chat and
            suggests changes. It uses its own plan, so you don't need a key
            here.
          </p>
        </div>

        <AgentTabs agent={agent} onChange={choose} />

        <ol className="flex flex-col gap-5">
          <Step n={1} title={`Add Seply Learn to ${label}`}>
            {instance ? (
              <Install
                items={installSteps(agent, window.location.origin, instance)}
                overview={overview}
              />
            ) : (
              <Spinner className="text-muted-foreground" />
            )}
          </Step>
          <Step n={2} title="Sign in when your agent asks">
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {signInSteps(agent).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Step>
          <Step n={3} title="Ask it to make an Expedition">
            <FirstPrompts expedition={null} />
          </Step>
        </ol>

        <ConnectStatus
          connected={connected}
          className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground"
        />

        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <Link href="/" className={buttonVariants({ variant: "link" })}>
            Skip for now
          </Link>
          <Button size="lg" render={<Link href="/" />}>
            Go to my Library
          </Button>
        </div>
      </main>
    </div>
  )
}

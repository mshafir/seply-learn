// The pieces of connecting an agent (spec §6.4) that the setup page
// (connect-screen.tsx) and the welcome step (screens/welcome.tsx) share: the
// agent tabs (the choice is remembered), the install items for this server,
// the first prompts, and the status line that ticks when the agent's first
// call arrives. What each piece says comes from steps.ts.
import * as React from "react"
import { CheckIcon, ExternalLinkIcon, KeyRoundIcon } from "lucide-react"
import { Link } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Button } from "@seply/ui/components/button"
import { Spinner } from "@seply/ui/components/spinner"
import { Tabs, TabsList, TabsTrigger } from "@seply/ui/components/tabs"
import { toast } from "@seply/ui/components/toast"

import { CopyField } from "@/connect/copy-field.tsx"
import {
  AGENTS,
  firstPrompts,
  type AgentId,
  type InstallItem,
} from "@/connect/steps.ts"
import { createApiToken, type AgentsOverview } from "@/lib/api.ts"

/** One tab per agent. */
export function AgentTabs({
  agent,
  onChange,
}: {
  agent: AgentId
  onChange: (id: AgentId) => void
}) {
  return (
    <Tabs value={agent} onValueChange={(v) => onChange(v as AgentId)}>
      <TabsList className="h-auto w-full flex-wrap sm:w-fit">
        {AGENTS.map((a) => (
          <TabsTrigger key={a.id} value={a.id}>
            {a.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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

/** The install items for one agent: text, commands to copy, links, a token. */
export function Install({
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

/** The first prompts, each with a Copy button and what happens next. */
export function FirstPrompts({
  expedition,
}: {
  expedition: { title: string } | null
}) {
  return (
    <>
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
    </>
  )
}

/** Waiting for the agent's first call, or the agent that connected. */
export function ConnectStatus({
  connected,
  className,
}: {
  connected: string | null
  className?: string
}) {
  return (
    <p
      role="status"
      data-testid="connect-status"
      className={
        className ?? "flex items-center gap-2 text-sm text-muted-foreground"
      }
    >
      {connected ? (
        <>
          <CheckIcon className="size-4 text-foreground" />
          <span className="text-foreground">Connected: {connected}</span>
        </>
      ) : (
        <>
          <Spinner />
          Waiting for your agent's first call. This page updates when it
          connects.
        </>
      )}
    </p>
  )
}

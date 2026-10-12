// The shell page (spec §9.1, §9.2): the only UI the app ships. It chooses the
// server (the hosted one, or a self-hosted address that is checked before it
// is saved), and it is what shows when the chosen server can't be reached.
import * as React from "react"
import { ServerOffIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Badge } from "@seply/ui/components/badge"
import { Wordmark } from "@seply/ui/components/brand"
import { Button } from "@seply/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import { Spinner } from "@seply/ui/components/spinner"

import type { ServerCheck } from "../../src/server-url.ts"
import type { ShellState } from "../../src/shell-api.ts"

type Refusal = Extract<ServerCheck, { ok: false }>["reason"]

const WHY: Record<Refusal, string> = {
  empty: "Enter the server's address.",
  invalid: "That isn't a web address.",
  insecure:
    "That address isn't encrypted. Use https, unless the server is on your own network.",
  unreachable:
    "Nothing answered at that address. Check it, and your connection.",
  "not-seply": "Something answered there, but it isn't a Seply Learn server.",
}

const host = (origin: string) => origin.replace(/^https:\/\//, "")

function Picker({ state }: { state: ShellState }) {
  const custom = state.server !== state.defaultServer
  const [address, setAddress] = React.useState(custom ? state.server : "")
  const [busy, setBusy] = React.useState<"address" | "hosted" | null>(null)
  const [refused, setRefused] = React.useState<Refusal | null>(null)

  const save = (which: "address" | "hosted", value: string) => {
    setBusy(which)
    setRefused(null)
    window.seplyShell
      .save(value)
      .then(
        // Saved: the main process closes this window.
        (check) => !check.ok && setRefused(check.reason),
        () => setRefused("unreachable")
      )
      .finally(() => setBusy(null))
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Choose a server</h1>
        <p className="text-muted-foreground">
          Seply Learn opens {host(state.defaultServer)}. To use a server that
          you or your team run, enter its address.
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Now using</span>
        <span className="font-mono" data-testid="current-server">
          {host(state.server)}
        </span>
        {state.server.startsWith("http://") && (
          <Badge variant="outline">not encrypted</Badge>
        )}
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save("address", address)
        }}
      >
        <Field data-invalid={refused ? true : undefined}>
          <FieldLabel htmlFor="server-address">Server address</FieldLabel>
          <Input
            id="server-address"
            className="font-mono"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://learn.example.com"
            value={address}
            aria-invalid={refused ? true : undefined}
            onChange={(e) => {
              setAddress(e.target.value)
              setRefused(null)
            }}
          />
          {refused ? (
            <FieldError>{WHY[refused]}</FieldError>
          ) : (
            <FieldDescription>
              The address you open it at in a browser.
            </FieldDescription>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy !== null || !address.trim()}>
            {busy === "address" && <Spinner />}
            Connect
          </Button>
          {custom && (
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => save("hosted", state.defaultServer)}
            >
              {busy === "hosted" && <Spinner />}
              Use {host(state.defaultServer)}
            </Button>
          )}
        </div>
      </form>
    </>
  )
}

function Unreachable({
  state,
  onChange,
}: {
  state: ShellState
  onChange: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  return (
    <>
      <Alert>
        <ServerOffIcon />
        <AlertTitle>Can't reach {host(state.server)}</AlertTitle>
        <AlertDescription>
          Check your connection, or that the server is running. Expeditions you
          opened before can still be read once the app has loaded here.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void window.seplyShell.retry().finally(() => setBusy(false))
          }}
        >
          {busy && <Spinner />}
          Try again
        </Button>
        <Button variant="outline" disabled={busy} onClick={onChange}>
          Change server
        </Button>
      </div>
    </>
  )
}

export function ShellPage() {
  const [state, setState] = React.useState<ShellState | null>(null)
  const [choosing, setChoosing] = React.useState(false)
  React.useEffect(() => {
    void window.seplyShell.state().then(setState)
  }, [])
  return (
    <main className="flex min-h-svh flex-col gap-6 bg-background p-8">
      <Wordmark />
      {!state ? (
        <Spinner className="text-muted-foreground" />
      ) : state.mode === "unreachable" && !choosing ? (
        <Unreachable state={state} onChange={() => setChoosing(true)} />
      ) : (
        <Picker state={state} />
      )}
    </main>
  )
}

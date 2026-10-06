// The consent screen for MCP clients (spec §6.1, WP-5.4). Better Auth sends
// the browser here, signed in, with the authorization request as a signed
// query. The reader sees which agent asks, picks what it may do (the scopes
// it asked for) and which Expeditions it may use, then allows or denies.
// The chosen Expeditions go to our server first; Better Auth then issues the
// code and says where to send the browser (back to the agent).
import * as React from "react"
import { BotIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Wordmark } from "@seply/ui/components/brand"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import { Checkbox } from "@seply/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@seply/ui/components/field"
import { Label } from "@seply/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@seply/ui/components/radio-group"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"

import {
  answerConsent,
  getAgents,
  getOAuthClient,
  listExpeditions,
  type AgentScope,
  type LibraryCard,
} from "@/lib/api.ts"
import { signedOAuthQuery } from "@/lib/oauth.ts"

type Loaded = {
  name: string
  host: string | null
  scopes: { id: AgentScope; label: string }[]
  expeditions: LibraryCard[]
}

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : null
  } catch {
    return null
  }
}

export function ConsentScreen() {
  const oauthQuery = signedOAuthQuery(window.location.search)
  const params = new URLSearchParams(window.location.search)
  const clientId = params.get("client_id") ?? ""
  const asked = (params.get("scope") ?? "").split(" ").filter(Boolean)

  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [scopes, setScopes] = React.useState<Set<string>>(new Set(asked))
  const [which, setWhich] = React.useState<"all" | "chosen">("all")
  const [chosen, setChosen] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState<"allow" | "deny" | null>(null)

  React.useEffect(() => {
    if (!oauthQuery) return
    let live = true
    Promise.all([
      getOAuthClient(clientId),
      getAgents(),
      listExpeditions(),
    ]).then(
      ([client, agents, expeditions]) => {
        if (!live) return
        setLoaded({
          name: client.client_name || hostOf(clientId) || "An agent",
          host: hostOf(client.client_uri) ?? hostOf(clientId),
          scopes: agents.scopes.filter((s) => asked.includes(s.id)),
          expeditions,
        })
      },
      (e: unknown) =>
        live &&
        setError(e instanceof Error ? e.message : "Couldn't load this request.")
    )
    return () => {
      live = false
    }
    // The query never changes while this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const answer = async (accept: boolean) => {
    if (!oauthQuery) return
    setBusy(accept ? "allow" : "deny")
    try {
      const url = await answerConsent({
        accept,
        clientId,
        // Scopes the agent asked for that aren't ours (offline_access) stay.
        scopes: asked.filter(
          (s) => scopes.has(s) || !loaded?.scopes.some((x) => x.id === s)
        ),
        expeditions: which === "all" ? null : [...chosen],
        oauthQuery,
      })
      window.location.assign(url)
    } catch (e) {
      setBusy(null)
      setError(e instanceof Error ? e.message : "Something went wrong.")
    }
  }

  const ourScopes = loaded?.scopes ?? []
  const valid =
    ourScopes.some((s) => scopes.has(s.id)) &&
    (which === "all" || chosen.size > 0)

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md" data-testid="consent">
        <CardHeader className="gap-3">
          <Wordmark />
          {!oauthQuery ? (
            <CardTitle>Nothing to approve</CardTitle>
          ) : loaded ? (
            <>
              <CardTitle className="flex items-center gap-2 text-xl">
                <BotIcon className="size-5 text-muted-foreground" />
                Connect {loaded.name}
              </CardTitle>
              <CardDescription>
                {loaded.name}
                {loaded.host ? ` (${loaded.host})` : ""} wants to work with your
                Expeditions as you. Anything it changes in an Expedition arrives
                as suggestions for you to review.
              </CardDescription>
            </>
          ) : (
            !error && <Skeleton className="h-12 w-full" />
          )}
        </CardHeader>
        <CardContent>
          {!oauthQuery ? (
            <p className="text-sm text-muted-foreground">
              This page opens when an agent asks to connect to Seply Learn.
            </p>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn't finish connecting</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : !loaded ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">It may</FieldLegend>
                {ourScopes.map((s) => (
                  <Field key={s.id} orientation="horizontal">
                    <Checkbox
                      id={`scope-${s.id}`}
                      checked={scopes.has(s.id)}
                      onCheckedChange={(on) => {
                        const next = new Set(scopes)
                        if (on === true) next.add(s.id)
                        else next.delete(s.id)
                        setScopes(next)
                      }}
                    />
                    <FieldLabel
                      htmlFor={`scope-${s.id}`}
                      className="font-normal"
                    >
                      {s.label}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">Which Expeditions</FieldLegend>
                <RadioGroup
                  aria-label="Which Expeditions"
                  value={which}
                  onValueChange={(v) => setWhich(v as "all" | "chosen")}
                >
                  <Label className="flex items-center gap-2 font-normal">
                    <RadioGroupItem value="all" />
                    All the Expeditions you can see
                  </Label>
                  <Label className="flex items-center gap-2 font-normal">
                    <RadioGroupItem value="chosen" />
                    Only the ones you choose
                  </Label>
                </RadioGroup>
                {which === "chosen" && (
                  <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                    {loaded.expeditions.length === 0 && (
                      <FieldDescription>
                        You have no Expeditions yet.
                      </FieldDescription>
                    )}
                    {loaded.expeditions.map((e) => (
                      <Field key={e.id} orientation="horizontal">
                        <Checkbox
                          id={`exp-${e.id}`}
                          checked={chosen.has(e.id)}
                          onCheckedChange={(on) => {
                            const next = new Set(chosen)
                            if (on === true) next.add(e.id)
                            else next.delete(e.id)
                            setChosen(next)
                          }}
                        />
                        <FieldLabel
                          htmlFor={`exp-${e.id}`}
                          className="font-normal"
                        >
                          {e.title || "Untitled"}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                )}
                <FieldDescription>
                  It can't create Expeditions unless you allow that above, and
                  it never sees anything you can't.
                </FieldDescription>
              </FieldSet>
            </FieldGroup>
          )}
        </CardContent>
        {oauthQuery && loaded && !error && (
          <CardFooter className="justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void answer(false)}
            >
              {busy === "deny" && <Spinner />}
              Deny
            </Button>
            <Button
              disabled={!valid || busy !== null}
              onClick={() => void answer(true)}
            >
              {busy === "allow" && <Spinner />}
              Allow
            </Button>
          </CardFooter>
        )}
      </Card>
    </main>
  )
}

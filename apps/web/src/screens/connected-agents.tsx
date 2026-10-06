// Settings → Connected agents (spec §3.10, §6.1; WP-5.4): how to connect an
// MCP client, the agents signed in with OAuth, and personal API tokens, each
// with its scopes and an optional restriction to chosen Expeditions. A new
// token's key is shown once.
import * as React from "react"
import { BotIcon, CopyIcon, KeyRoundIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
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
  FieldSeparator,
  FieldSet,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@seply/ui/components/input-group"
import { Label } from "@seply/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@seply/ui/components/radio-group"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"

import {
  createApiToken,
  deleteApiToken,
  getAgents,
  listExpeditions,
  revokeAgentGrant,
  type AgentScope,
  type AgentsOverview,
  type LibraryCard,
} from "@/lib/api.ts"

const failed = (e: unknown) =>
  toast.add({
    title: e instanceof Error ? e.message : "Something went wrong.",
    type: "error",
  })

const SCOPE_SHORT: Record<AgentScope, string> = {
  "expeditions:read": "Read",
  "expeditions:create": "Create",
  "proposals:write": "Suggest",
}

const mcpUrl = () => `${window.location.origin}/mcp`

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: "Copied.", type: "success" })
  } catch {
    // No clipboard (an insecure origin): the text is selectable.
  }
}

/** A read-only value with a Copy button. */
function CopyField({
  id,
  value,
  label,
}: {
  id: string
  value: string
  label: string
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        readOnly
        value={value}
        className="font-mono text-xs"
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={`Copy ${label}`}
          onClick={() => void copy(value)}
        >
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function Scopes({ scopes }: { scopes: AgentScope[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <Badge key={s} variant="secondary">
          {SCOPE_SHORT[s]}
        </Badge>
      ))}
    </span>
  )
}

function reach(ids: string[] | null, titles: Map<string, string>): string {
  if (!ids) return "All your Expeditions"
  if (!ids.length) return "No Expeditions"
  const named = ids.map(
    (id) => titles.get(id) ?? "an Expedition you no longer see"
  )
  return named.length <= 2 ? named.join(" and ") : `${named.length} Expeditions`
}

function ExpeditionPicker({
  expeditions,
  which,
  onWhich,
  chosen,
  onChosen,
}: {
  expeditions: LibraryCard[] | null
  which: "all" | "chosen"
  onWhich: (w: "all" | "chosen") => void
  chosen: Set<string>
  onChosen: (c: Set<string>) => void
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Expeditions</FieldLegend>
      <RadioGroup
        aria-label="Expeditions"
        value={which}
        onValueChange={(v) => onWhich(v as "all" | "chosen")}
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
      {which === "chosen" &&
        (expeditions ? (
          <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border p-3">
            {expeditions.length === 0 && (
              <FieldDescription>You have no Expeditions yet.</FieldDescription>
            )}
            {expeditions.map((e) => (
              <Field key={e.id} orientation="horizontal">
                <Checkbox
                  id={`token-exp-${e.id}`}
                  checked={chosen.has(e.id)}
                  onCheckedChange={(on) => {
                    const next = new Set(chosen)
                    if (on === true) next.add(e.id)
                    else next.delete(e.id)
                    onChosen(next)
                  }}
                />
                <FieldLabel
                  htmlFor={`token-exp-${e.id}`}
                  className="font-normal"
                >
                  {e.title || "Untitled"}
                </FieldLabel>
              </Field>
            ))}
          </div>
        ) : (
          <Skeleton className="h-24 w-full" />
        ))}
    </FieldSet>
  )
}

function NewToken({
  overview,
  expeditions,
  onCreated,
}: {
  overview: AgentsOverview
  expeditions: LibraryCard[] | null
  onCreated: (key: string) => Promise<void>
}) {
  const [name, setName] = React.useState("Claude Code")
  const [scopes, setScopes] = React.useState<Set<AgentScope>>(
    new Set(overview.scopes.map((s) => s.id))
  )
  const [which, setWhich] = React.useState<"all" | "chosen">("all")
  const [chosen, setChosen] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const valid =
    name.trim() !== "" &&
    scopes.size > 0 &&
    (which === "all" || chosen.size > 0)
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="new-api-token"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        createApiToken({
          name: name.trim(),
          scopes: [...scopes],
          expeditions: which === "all" ? null : [...chosen],
        })
          .then((made) => onCreated(made.key), failed)
          .finally(() => setBusy(false))
      }}
    >
      <Field>
        <FieldLabel htmlFor="token-name">Name</FieldLabel>
        <Input
          id="token-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <FieldDescription>
          Shown to collaborators next to what it suggests.
        </FieldDescription>
      </Field>
      <FieldSet>
        <FieldLegend variant="label">It may</FieldLegend>
        {overview.scopes.map((s) => (
          <Field key={s.id} orientation="horizontal">
            <Checkbox
              id={`token-scope-${s.id}`}
              checked={scopes.has(s.id)}
              onCheckedChange={(on) => {
                const next = new Set(scopes)
                if (on === true) next.add(s.id)
                else next.delete(s.id)
                setScopes(next)
              }}
            />
            <FieldLabel htmlFor={`token-scope-${s.id}`} className="font-normal">
              {s.label}
            </FieldLabel>
          </Field>
        ))}
      </FieldSet>
      <ExpeditionPicker
        expeditions={expeditions}
        which={which}
        onWhich={setWhich}
        chosen={chosen}
        onChosen={setChosen}
      />
      <div>
        <Button type="submit" disabled={!valid || busy}>
          {busy && <Spinner />}
          Create token
        </Button>
      </div>
    </form>
  )
}

export function ConnectedAgentsSection() {
  const [overview, setOverview] = React.useState<AgentsOverview | null>(null)
  const [expeditions, setExpeditions] = React.useState<LibraryCard[] | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [key, setKey] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(
    () =>
      getAgents().then(
        (o) => {
          setOverview(o)
          setError(null)
        },
        (e: unknown) =>
          setError(
            e instanceof Error
              ? e.message
              : "Couldn't load your connected agents."
          )
      ),
    []
  )
  React.useEffect(() => {
    void load()
    listExpeditions().then(setExpeditions, () => setExpeditions([]))
  }, [load])

  const titles = new Map(
    (expeditions ?? []).map((e) => [e.id, e.title || "Untitled"])
  )
  const remove = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
      await load()
    } catch (e) {
      failed(e)
    } finally {
      setBusy(null)
    }
  }

  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load your connected agents</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  if (!overview) return <Skeleton className="h-64 w-full" />

  const command = `claude mcp add --transport http seply-learn ${mcpUrl()}`
  return (
    <Card data-testid="connected-agents">
      <CardHeader>
        <CardTitle>Connected agents</CardTitle>
        <CardDescription>
          Let an AI agent such as Claude Code read your Expeditions, create new
          ones from a chat, and suggest changes, as you. What it suggests waits
          in Suggestions until you accept it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="mcp-url">Server address</FieldLabel>
            <CopyField id="mcp-url" value={mcpUrl()} label="server address" />
            <FieldDescription>
              In Claude Code, add it with the command below, then sign in when
              it asks. The seply-learn plugin adds it with the skill that
              teaches Claude how to work here.
            </FieldDescription>
            <CopyField id="mcp-command" value={command} label="command" />
          </Field>

          {overview.grants.length > 0 && (
            <>
              <FieldSeparator />
              <FieldSet>
                <FieldLegend variant="label">Signed-in agents</FieldLegend>
                {overview.grants.map((g) => (
                  <div
                    key={g.clientId}
                    data-testid="agent-grant"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <BotIcon className="size-4 text-muted-foreground" />
                    <span className="font-medium">{g.name}</span>
                    <Scopes scopes={g.scopes} />
                    <span className="text-sm text-muted-foreground">
                      {reach(g.expeditions, titles)}
                    </span>
                    <div className="flex-1" />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void remove(g.clientId, () =>
                          revokeAgentGrant(g.clientId)
                        )
                      }
                    >
                      {busy === g.clientId && <Spinner />}
                      Disconnect
                    </Button>
                  </div>
                ))}
              </FieldSet>
            </>
          )}

          <FieldSeparator />
          <FieldSet>
            <FieldLegend variant="label">API tokens</FieldLegend>
            <FieldDescription>
              For agents that can't sign in: send the token as{" "}
              <code className="font-mono">
                Authorization: Bearer &lt;token&gt;
              </code>
              .
            </FieldDescription>
            {overview.tokens.map((t) => (
              <div
                key={t.id}
                data-testid="api-token"
                className="flex flex-wrap items-center gap-2"
              >
                <Badge variant="outline" className="font-mono">
                  <KeyRoundIcon />
                  {t.start ?? "sl_"}…
                </Badge>
                <span className="font-medium">{t.name}</span>
                <Scopes scopes={t.scopes} />
                <span className="text-sm text-muted-foreground">
                  {reach(t.expeditions, titles)}
                  {t.lastUsedAt
                    ? ` · used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : " · never used"}
                </span>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void remove(t.id, () => deleteApiToken(t.id))}
                >
                  {busy === t.id && <Spinner />}
                  Delete
                </Button>
              </div>
            ))}
            {key && (
              <Alert data-testid="api-token-key">
                <KeyRoundIcon />
                <AlertTitle>Copy your token now</AlertTitle>
                <AlertDescription className="flex min-w-0 flex-col gap-2">
                  <span>
                    You won't see it again. Anyone with it can act as you,
                    within its scopes.
                  </span>
                  <CopyField id="new-token" value={key} label="token" />
                  <span>In Claude Code:</span>
                  <CopyField
                    id="new-token-command"
                    value={`${command} --header "Authorization: Bearer ${key}"`}
                    label="command"
                  />
                </AlertDescription>
              </Alert>
            )}
          </FieldSet>
          <NewToken
            overview={overview}
            expeditions={expeditions}
            onCreated={async (k) => {
              setKey(k)
              await load()
            }}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

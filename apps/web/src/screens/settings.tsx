// Settings (spec §3.10). WP-3.3 brings the AI section: in bring-your-own-key
// mode, a key per provider (shown by its last 4 characters, with Test and
// Delete), which key builds use, and the model per stage under Advanced; in
// either mode, the per-ask spending cap. A key goes to the server once, when
// saved, and never comes back. Theme stays in the account menu; Connected
// agents and Notifications come with their work packages.
import * as React from "react"
import { ArrowLeftIcon, ChevronDownIcon, KeyRoundIcon } from "lucide-react"
import { Link } from "wouter"

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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@seply/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@seply/ui/components/select"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"

import { AccountMenu } from "@/components/account-menu.tsx"
import {
  deleteAiKey,
  getAi,
  saveAiKey,
  testAiKey,
  updateAiSettings,
  type AiOverview,
  type AiStage,
  type ByokProvider,
  type KeyTest,
} from "@/lib/api.ts"

const STAGES: { id: AiStage; label: string; hint: string }[] = [
  { id: "skim", label: "Skim", hint: "Reads a sample of the Sources and proposes Views (fast model)" },
  { id: "curator", label: "Curator", hint: "Builds the Concepts and Views, and answers asks (strong model)" },
  { id: "writer", label: "Writers", hint: "Summaries, overviews and articles (mid-tier model)" },
]

const failed = (e: unknown) =>
  toast.add({ title: e instanceof Error ? e.message : "Something went wrong.", type: "error" })

function testMessage(t: KeyTest): string {
  if (t.ok) return "The key works."
  if (t.reason === "rejected") return "The provider refused this key."
  if (t.reason === "unreachable") return "Couldn't reach the provider. Try again."
  return `The provider answered with an error${t.status ? ` (${t.status})` : ""}.`
}

function KeyRow({
  provider,
  label,
  stored,
  onChange,
}: {
  provider: ByokProvider
  label: string
  stored: { last4: string } | undefined
  onChange: () => Promise<void>
}) {
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState<"save" | "test" | "delete" | null>(null)
  const id = `key-${provider}`

  const run = async (what: "save" | "test" | "delete", fn: () => Promise<void>) => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      failed(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Field data-testid={id}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {stored ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono" data-testid={`${id}-last4`}>
            <KeyRoundIcon />
            ••••{stored.last4}
          </Badge>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run("test", async () => {
                const t = await testAiKey(provider)
                toast.add({ title: `${label}: ${testMessage(t)}`, type: t.ok ? "success" : "error" })
              })
            }
          >
            {busy === "test" && <Spinner />}
            Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run("delete", async () => {
                await deleteAiKey(provider)
                await onChange()
              })
            }
          >
            {busy === "delete" && <Spinner />}
            Delete
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const key = draft.trim()
            if (!key) return
            void run("save", async () => {
              await saveAiKey(provider, key)
              setDraft("")
              await onChange()
            })
          }}
        >
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={`Paste your ${label} API key`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" disabled={busy !== null || !draft.trim()}>
            {busy === "save" && <Spinner />}
            Save
          </Button>
        </form>
      )}
    </Field>
  )
}

function AskCap({ ai, onSaved }: { ai: AiOverview; onSaved: (o: AiOverview) => void }) {
  const [value, setValue] = React.useState(ai.settings.askCapUsd.toFixed(2))
  const [busy, setBusy] = React.useState(false)
  const parsed = Number(value)
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed <= 50
  const changed = valid && Math.abs(parsed - ai.settings.askCapUsd) >= 0.005
  return (
    <Field>
      <FieldLabel htmlFor="ask-cap">Spending cap per ask</FieldLabel>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!changed) return
          setBusy(true)
          updateAiSettings({ askCapUsd: parsed })
            .then((o) => {
              onSaved(o)
              toast.add({ title: "Spending cap saved.", type: "success" })
            }, failed)
            .finally(() => setBusy(false))
        }}
      >
        <InputGroup className="max-w-40">
          <InputGroupAddon>
            <InputGroupText>$</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="ask-cap"
            inputMode="decimal"
            value={value}
            aria-invalid={!valid || undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        </InputGroup>
        <Button type="submit" variant="outline" disabled={!changed || busy}>
          {busy && <Spinner />}
          Save
        </Button>
      </form>
      <FieldDescription>
        An ask stops when it reaches this, and keeps what it already wrote. Default $
        {ai.defaultAskCapUsd.toFixed(2)}, at most $50.
      </FieldDescription>
    </Field>
  )
}

function Advanced({ ai, onSaved }: { ai: AiOverview; onSaved: (o: AiOverview) => void }) {
  const provider = ai.active?.provider as ByokProvider
  const defaults = ai.providers.find((p) => p.id === provider)?.defaults
  const current = ai.settings.models[provider] ?? {}
  const [draft, setDraft] = React.useState<Partial<Record<AiStage, string>>>(current)
  const [busy, setBusy] = React.useState(false)
  if (!defaults) return null
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const models = Object.fromEntries(
          Object.entries(draft)
            .map(([k, v]) => [k, v?.trim()])
            .filter(([, v]) => v)
        )
        setBusy(true)
        updateAiSettings({ models: { ...ai.settings.models, [provider]: models } })
          .then((o) => {
            onSaved(o)
            toast.add({ title: "Models saved.", type: "success" })
          }, failed)
          .finally(() => setBusy(false))
      }}
    >
      <FieldDescription>
        The model each stage uses on {ai.active?.label}. Leave a field empty for the default.
      </FieldDescription>
      {STAGES.map((s) => (
        <Field key={s.id}>
          <FieldLabel htmlFor={`model-${s.id}`}>{s.label}</FieldLabel>
          <Input
            id={`model-${s.id}`}
            className="font-mono"
            spellCheck={false}
            placeholder={defaults[s.id]}
            value={draft[s.id] ?? ""}
            onChange={(e) => setDraft({ ...draft, [s.id]: e.target.value })}
          />
          <FieldDescription>{s.hint}</FieldDescription>
        </Field>
      ))}
      <div>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy && <Spinner />}
          Save models
        </Button>
      </div>
    </form>
  )
}

function AiSection() {
  const [ai, setAi] = React.useState<AiOverview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [advanced, setAdvanced] = React.useState(false)

  const load = React.useCallback(
    () =>
      getAi().then(
        (o) => {
          setAi(o)
          setError(null)
        },
        (e: unknown) =>
          setError(e instanceof Error ? e.message : "Couldn't load the AI settings.")
      ),
    []
  )
  React.useEffect(() => {
    let live = true
    getAi().then(
      (o) => live && setAi(o),
      (e: unknown) =>
        live && setError(e instanceof Error ? e.message : "Couldn't load the AI settings.")
    )
    return () => {
      live = false
    }
  }, [])

  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load the AI settings</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  if (!ai) return <Skeleton className="h-64 w-full" />

  const stored = new Map(ai.keys.map((k) => [k.provider, k]))
  const withKeys = ai.providers.filter((p) => stored.has(p.id))

  return (
    <Card data-testid="ai-settings">
      <CardHeader>
        <CardTitle>AI</CardTitle>
        <CardDescription>
          {ai.mode === "byok"
            ? "This instance uses your own API keys. They're encrypted on the server and never shown again; only their last 4 characters are."
            : ai.ready
              ? `This instance's key pays for AI here (${ai.active!.label}). Viewing and editing never need a key.`
              : "This instance has no AI key set up yet. Viewing and editing still work."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {ai.mode === "byok" && (
            <>
              {ai.providers.map((p) => (
                <KeyRow
                  key={p.id}
                  provider={p.id}
                  label={p.label}
                  stored={stored.get(p.id)}
                  onChange={load}
                />
              ))}
              {withKeys.length > 1 && (
                <Field>
                  <FieldLabel htmlFor="ai-provider">Builds use</FieldLabel>
                  <Select
                    items={withKeys.map((p) => ({ value: p.id, label: p.label }))}
                    value={ai.active?.provider ?? null}
                    onValueChange={(v) => {
                      if (v) updateAiSettings({ provider: v as ByokProvider }).then(setAi, failed)
                    }}
                  >
                    <SelectTrigger id="ai-provider" className="w-full max-w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {withKeys.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {!ai.ready && (
                <FieldDescription>Add a key to build Expeditions and ask the AI.</FieldDescription>
              )}
              <FieldSeparator />
            </>
          )}
          <AskCap key={ai.settings.askCapUsd} ai={ai} onSaved={setAi} />
          {ai.mode === "byok" && ai.ready && (
            <>
              <FieldSeparator />
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  Advanced
                  <ChevronDownIcon className={advanced ? "rotate-180" : undefined} />
                </Button>
              </div>
              {advanced && (
                <Advanced key={ai.active!.provider} ai={ai} onSaved={setAi} />
              )}
            </>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

export function SettingsScreen() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
        <Link href="/" aria-label="Library">
          <Wordmark />
        </Link>
        <div className="flex-1" />
        <AccountMenu />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to the Library"
            render={<Link href="/" />}
          >
            <ArrowLeftIcon />
          </Button>
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>
        <AiSection />
      </main>
    </div>
  )
}

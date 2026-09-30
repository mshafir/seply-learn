// Create: Sources (spec §3.3, canvas 02a). Start from anything, mixed and
// several at once: paste an AI chat, upload files, or write a prompt, with
// optional goal chips. Sources stack up in a list; the cost estimate shows
// before continuing; Next runs the skim on Choose Views.
import * as React from "react"
import {
  ArrowRightIcon,
  FileTextIcon,
  MessageSquareTextIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import { Link } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@seply/ui/components/field"
import { FileDropZone } from "@seply/ui/components/file-drop-zone"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@seply/ui/components/tabs"
import { Textarea } from "@seply/ui/components/textarea"
import { toast } from "@seply/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@seply/ui/components/toggle-group"

import {
  addTextSource,
  ApiError,
  estimateBuild,
  removeSource,
  uploadSource,
  type BuildEstimate,
  type Goal,
} from "@/lib/api.ts"

import type { Flow } from "./create-screen.tsx"
import {
  estimateLabel,
  formatTokens,
  formatUsd,
  GOAL_CHIPS,
  SOURCE_ACCEPT,
  sourceChars,
  sourceKindLabel,
  sourceMeta,
} from "./flow.ts"

type Estimate =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; estimate: BuildEstimate }
  | { status: "unavailable"; reason: "no-key" | "not-configured" | "error" }

function useEstimate(chars: number): Estimate {
  const [state, setState] = React.useState<Estimate>({ status: "idle" })
  React.useEffect(() => {
    if (!chars) return
    let live = true
    const timer = setTimeout(() => {
      setState({ status: "loading" })
      estimateBuild(chars).then(
        (estimate) => live && setState({ status: "ready", estimate }),
        (e: unknown) => {
          if (!live) return
          const reason =
            e instanceof ApiError && (e.body.error === "no-key" || e.body.error === "not-configured")
              ? e.body.error
              : "error"
          setState({ status: "unavailable", reason })
        }
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [chars])
  return chars ? state : { status: "idle" }
}

function sourceError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return "It's larger than 25 MB."
    if (e.body.message) return e.body.message
  }
  return (e as Error).message
}

export function SourcesStep({
  flow,
  onGoals,
  onNext,
}: {
  flow: Flow
  onGoals: (goals: Goal[]) => void
  onNext: () => void
}) {
  const { draft, expeditionId, refresh, cache } = flow
  const [tab, setTab] = React.useState<"chat" | "files" | "prompt">("chat")
  const [chat, setChat] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [busy, setBusy] = React.useState<"chat" | "files" | "prompt" | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const chars = sourceChars(draft.sources)
  const estimate = useEstimate(chars)

  const addText = async (type: "paste" | "prompt", text: string) => {
    const which = type === "paste" ? "chat" : "prompt"
    setBusy(which)
    try {
      await addTextSource(expeditionId, type, text)
      await refresh()
      if (type === "paste") setChat("")
      else setPrompt("")
    } catch (e) {
      toast.add({
        title: type === "paste" ? "Couldn't add that chat" : "Couldn't add that prompt",
        description: sourceError(e),
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const addFiles = async (files: File[]) => {
    setBusy("files")
    for (const file of files) {
      try {
        await uploadSource(expeditionId, file)
      } catch (e) {
        toast.add({
          title: `Couldn't read ${file.name}`,
          description: sourceError(e),
          type: "error",
        })
      }
    }
    await refresh()
    setBusy(null)
  }

  const remove = async (sourceId: string) => {
    setRemoving(sourceId)
    try {
      await removeSource(expeditionId, sourceId)
      await refresh()
    } catch (e) {
      toast.add({ title: "Couldn't remove that Source", description: sourceError(e), type: "error" })
    } finally {
      setRemoving(null)
    }
  }

  const n = draft.sources.length
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-reading text-3xl font-medium">What should this Expedition be about?</h1>
        <p className="text-muted-foreground">
          Start from anything: an AI chat, some files, or just a question. Add as many
          Sources as you like; each Concept remembers where it came from.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="chat">
            <MessageSquareTextIcon />
            An AI chat
          </TabsTrigger>
          <TabsTrigger value="files">
            <FileTextIcon />
            Files
          </TabsTrigger>
          <TabsTrigger value="prompt">
            <SparklesIcon />
            Just a prompt
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="pt-2">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (chat.trim()) void addText("paste", chat)
            }}
          >
            <Field>
              <FieldLabel htmlFor="paste-chat">Just paste in an AI chat</FieldLabel>
              <Textarea
                id="paste-chat"
                rows={8}
                value={chat}
                onChange={(e) => setChat(e.target.value)}
                placeholder="Copy the whole conversation from ChatGPT, Claude, Gemini or any assistant, and paste it here."
                className="max-h-80"
              />
              <FieldDescription>
                Share links can't be read without your assistant's login, so paste the
                conversation instead. Your own questions count most.
              </FieldDescription>
            </Field>
            <Button type="submit" className="self-start" disabled={!chat.trim() || busy === "chat"}>
              {busy === "chat" && <Spinner />}
              Add this chat
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="files" className="pt-2">
          <FileDropZone
            onFiles={(files) => void addFiles(files)}
            accept={SOURCE_ACCEPT}
            disabled={busy === "files"}
            title={busy === "files" ? "Reading…" : "Drop files here"}
            hint="Chat exports from ChatGPT, Claude or Gemini, PDF, Word, Markdown, text or saved web pages. Up to 25 MB each."
          />
        </TabsContent>
        <TabsContent value="prompt" className="pt-2">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (prompt.trim()) void addText("prompt", prompt)
            }}
          >
            <Field>
              <FieldLabel htmlFor="prompt">What do you want to understand?</FieldLabel>
              <Textarea
                id="prompt"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="How do mixture-of-experts models work, and why are they cheaper to serve?"
              />
              <FieldDescription>
                With no other Source, the Expedition is drafted from background knowledge,
                and every Concept says so.
              </FieldDescription>
            </Field>
            <Button type="submit" className="self-start" disabled={!prompt.trim() || busy === "prompt"}>
              {busy === "prompt" && <Spinner />}
              Add this prompt
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <Field>
        <FieldLabel id="goals-label">I want to</FieldLabel>
        <ToggleGroup
          aria-labelledby="goals-label"
          multiple
          variant="outline"
          value={cache.goals}
          onValueChange={(v) => onGoals(v as Goal[])}
        >
          {GOAL_CHIPS.map((g) => (
            <ToggleGroupItem key={g.id} value={g.id}>
              {g.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>Optional: it helps pick the Views.</FieldDescription>
      </Field>

      <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
        <h2 id="sources-heading" className="text-sm font-medium text-muted-foreground">
          Sources in this Expedition · {n}
        </h2>
        {n === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nothing yet. Add a chat, a file or a prompt above.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border bg-card" data-testid="source-list">
            {draft.sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Badge variant="secondary" className="w-16">
                  {sourceKindLabel(s)}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="text-sm text-muted-foreground">{sourceMeta(s)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${s.title}`}
                  disabled={removing === s.id}
                  onClick={() => void remove(s.id)}
                >
                  {removing === s.id ? <Spinner /> : <XIcon />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EstimateLine estimate={estimate} />

      <div className="flex flex-col-reverse items-stretch gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Next, you'll pick the Views to build. Nothing is built until you say so.
        </p>
        <Button
          size="lg"
          disabled={
            n === 0 ||
            !!busy ||
            (estimate.status === "ready" && estimate.estimate.overCap)
          }
          onClick={onNext}
        >
          Next: choose Views
          <ArrowRightIcon />
        </Button>
      </div>
    </main>
  )
}

function EstimateLine({ estimate }: { estimate: Estimate }) {
  if (estimate.status === "idle") return null
  if (estimate.status === "loading")
    return <Skeleton className="h-5 w-64" aria-label="Estimating the cost" />
  if (estimate.status === "unavailable")
    return (
      <Alert>
        <AlertTitle>
          {estimate.reason === "no-key"
            ? "Add an AI key to build"
            : estimate.reason === "not-configured"
              ? "AI isn't set up on this server"
              : "Couldn't estimate the cost"}
        </AlertTitle>
        <AlertDescription>
          {estimate.reason === "no-key" ? (
            <>
              This server uses your own key. Add one in{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>
              ; your Sources are saved meanwhile.
            </>
          ) : estimate.reason === "not-configured" ? (
            "Ask whoever runs it to add an AI key. Your Sources are saved meanwhile."
          ) : (
            "You can still continue."
          )}
        </AlertDescription>
      </Alert>
    )
  const e = estimate.estimate
  return (
    <div className="flex flex-col gap-2">
      <p data-testid="estimate" className="text-sm">
        <span className="font-medium">Estimated cost to build: {estimateLabel(e)}.</span>{" "}
        <span className="text-muted-foreground">
          The build stops at {formatUsd(e.capUsd)} unless you continue it.
        </span>
      </p>
      {e.overCap && (
        <Alert variant="destructive">
          <AlertTitle>That's more than one build can read</AlertTitle>
          <AlertDescription>
            Your Sources come to {formatTokens(e.sourceTokens)}. Remove a Source or two to
            bring it under the limit.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

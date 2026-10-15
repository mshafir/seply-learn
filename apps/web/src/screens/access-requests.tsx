// Admin › Access requests (spec §3.12; WP-7.3): with hosted access approval
// on, admins (ADMIN_EMAILS) see the requests to use this server's AI, oldest
// first, with name, email, note and date, and Approve or Decline each; a tab
// lists the approved accounts. Reached from Settings, for admins only.
import * as React from "react"
import { ArrowLeftIcon, CheckIcon, InboxIcon, XIcon } from "lucide-react"
import { Link } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Wordmark } from "@seply/ui/components/brand"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@seply/ui/components/empty"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@seply/ui/components/tabs"
import { toast } from "@seply/ui/components/toast"

import { AccountMenu } from "@/components/account-menu.tsx"
import {
  decideAccessRequest,
  listAccessRequests,
  type AccessRequestsOverview,
  type PendingAccessRequest,
} from "@/lib/api.ts"
import { useUser } from "@/lib/session.ts"

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const day = (iso: string) => dateFormat.format(new Date(iso))

type Load =
  | { status: "loading" }
  | { status: "ready"; overview: AccessRequestsOverview }
  | { status: "failed"; reason: string }

function PendingCard({
  request,
  onDecide,
}: {
  request: PendingAccessRequest
  onDecide: (decision: "approve" | "decline") => Promise<void>
}) {
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null)
  const decide = async (decision: "approve" | "decline") => {
    setBusy(decision)
    await onDecide(decision)
    setBusy(null)
  }
  const { user } = request
  return (
    <Card size="sm" data-testid="access-request">
      <CardHeader>
        <CardTitle>{user.name || user.email}</CardTitle>
        <CardDescription>
          {user.email} · asked on {day(request.createdAt)}
        </CardDescription>
        {request.note && (
          <p className="pt-1 whitespace-pre-wrap">{request.note}</p>
        )}
      </CardHeader>
      <CardFooter className="gap-2">
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() => void decide("approve")}
          aria-label={`Approve ${user.name || user.email}`}
        >
          {busy === "approve" ? <Spinner /> : <CheckIcon />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => void decide("decline")}
          aria-label={`Decline ${user.name || user.email}`}
        >
          {busy === "decline" ? <Spinner /> : <XIcon />}
          Decline
        </Button>
      </CardFooter>
    </Card>
  )
}

function AccessRequests() {
  const [load, setLoad] = React.useState<Load>({ status: "loading" })
  const refresh = React.useCallback(async () => {
    try {
      setLoad({ status: "ready", overview: await listAccessRequests() })
    } catch (e) {
      setLoad({ status: "failed", reason: (e as Error).message })
    }
  }, [])
  React.useEffect(() => {
    let live = true
    listAccessRequests().then(
      (overview) => live && setLoad({ status: "ready", overview }),
      (e: Error) => live && setLoad({ status: "failed", reason: e.message })
    )
    return () => {
      live = false
    }
  }, [])

  if (load.status === "loading")
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    )
  if (load.status === "failed")
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load the access requests</AlertTitle>
        <AlertDescription>{load.reason}</AlertDescription>
      </Alert>
    )

  const { pending, approved } = load.overview
  const decide =
    (request: PendingAccessRequest) =>
    async (decision: "approve" | "decline") => {
      const who = request.user.name || request.user.email
      try {
        await decideAccessRequest(request.id, decision)
        toast.add(
          decision === "approve"
            ? {
                title: `Approved ${who}`,
                description: "They can use this server's AI now.",
                type: "success",
              }
            : { title: `Declined ${who}'s request` }
        )
      } catch (e) {
        toast.add({
          title: "That didn't work",
          description: (e as Error).message,
          type: "error",
        })
      }
      await refresh()
    }

  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
        <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="pt-3">
        {pending.length ? (
          <ul aria-label="Pending requests" className="flex flex-col gap-3">
            {pending.map((r) => (
              <li key={r.id}>
                <PendingCard request={r} onDecide={decide(r)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>No requests waiting</EmptyTitle>
              <EmptyDescription>New requests show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>
      <TabsContent value="approved" className="pt-3">
        {approved.length ? (
          <ul
            aria-label="Approved accounts"
            data-testid="approved-accounts"
            className="flex flex-col divide-y rounded-xl border bg-card"
          >
            {approved.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="font-medium">{a.name || a.email}</span>{" "}
                  <span className="text-muted-foreground">{a.email}</span>
                </span>
                <span className="text-muted-foreground">
                  Approved on {day(a.approvedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No approved accounts yet.</p>
        )}
      </TabsContent>
    </Tabs>
  )
}

export function AccessRequestsScreen() {
  const user = useUser()
  const admin = !!user.access?.approvalRequired && !!user.access.admin
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
            aria-label="Back to Settings"
            render={<Link href="/settings" />}
          >
            <ArrowLeftIcon />
          </Button>
          <h1 className="text-2xl font-semibold">Access requests</h1>
        </div>
        {admin ? (
          <AccessRequests />
        ) : (
          <Alert>
            <AlertTitle>Only admins can see access requests</AlertTitle>
            <AlertDescription>
              <Link href="/">Back to your Library</Link>
            </AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  )
}

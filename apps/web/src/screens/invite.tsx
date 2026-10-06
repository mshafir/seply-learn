// The invite link (spec §3.9, WP-5.1): /invite/:token. It says who invited
// you to which Expedition, and as what. Signed in, Accept adds you and opens
// it; signed out (not signed up yet, too), "Sign in to accept" comes back
// here after sign-in. A link works once: someone else's used link says so.
import * as React from "react"
import { Link, useLocation } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Wordmark } from "@seply/ui/components/brand"
import { Button, buttonVariants } from "@seply/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"

import {
  acceptInvite,
  ApiError,
  getInvite,
  type InviteInfo,
} from "@/lib/api.ts"
import { useSession } from "@/lib/session.ts"

type Load =
  | { status: "loading" }
  | { status: "ready"; invite: InviteInfo }
  | { status: "failed"; notFound: boolean; reason: string }

export function InviteScreen({ token }: { token: string }) {
  const { session } = useSession()
  const [, navigate] = useLocation()
  const [load, setLoad] = React.useState<Load>({ status: "loading" })
  const [accepting, setAccepting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let live = true
    getInvite(token).then(
      (invite) => live && setLoad({ status: "ready", invite }),
      (err: unknown) =>
        live &&
        setLoad({
          status: "failed",
          notFound: err instanceof ApiError && err.status === 404,
          reason: err instanceof Error ? err.message : String(err),
        })
    )
    return () => {
      live = false
    }
  }, [token])

  const signedIn = session.status === "signed-in"
  const open = (id: string) => navigate(`/e/${id}`, { replace: true })
  const accept = async () => {
    setAccepting(true)
    setError(null)
    try {
      const { expeditionId } = await acceptInvite(token)
      open(expeditionId)
    } catch (err) {
      setAccepting(false)
      setError(
        err instanceof ApiError && err.status === 410
          ? "This invite was already used. Ask for a new one."
          : err instanceof Error
            ? err.message
            : String(err)
      )
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md" data-testid="invite-card">
        <CardHeader className="items-center gap-3 text-center">
          <Wordmark className="justify-center" />
          {load.status === "loading" ? (
            <>
              <Skeleton className="mx-auto h-7 w-48" />
              <Skeleton className="mx-auto h-4 w-64" />
            </>
          ) : load.status === "failed" ? (
            <>
              <CardTitle className="font-reading text-2xl font-medium">
                {load.notFound ? "Invite not found" : "Can't open the invite"}
              </CardTitle>
              <CardDescription>
                {load.notFound
                  ? "The link is wrong, or the invite was cancelled. Ask for a new one."
                  : load.reason}
              </CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="font-reading text-2xl font-medium">
                {load.invite.expedition.title || "Untitled Expedition"}
              </CardTitle>
              <CardDescription>
                {load.invite.invitedBy} invited you as{" "}
                {load.invite.role === "editor" ? "an editor" : "a viewer"}.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Couldn't accept</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {load.status === "ready" &&
            (load.invite.status === "yours" ? (
              <Button onClick={() => open(load.invite.expedition.id)}>
                Open the Expedition
              </Button>
            ) : load.invite.status === "accepted" ? (
              <Alert>
                <AlertDescription>
                  This invite was already used. Ask {load.invite.invitedBy} for
                  a new one.
                </AlertDescription>
              </Alert>
            ) : signedIn ? (
              <Button onClick={accept} disabled={accepting}>
                {accepting && <Spinner />}
                Accept and open
              </Button>
            ) : session.status === "loading" ? null : (
              <Link
                href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
                className={buttonVariants()}
              >
                Sign in to accept
              </Link>
            ))}
          {(load.status === "failed" || signedIn) && (
            <Link href="/" className={buttonVariants({ variant: "ghost" })}>
              Back to the Library
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

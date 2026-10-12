// Signing the desktop app in through the browser (spec §10.3, WP-8.2).
//
// /desktop/sign-in?challenge=…  opens in the reader's browser, from the app.
//   Signed out, it goes through /sign-in first. Signed in, it asks before it
//   hands the sign-in to the app as a seply:// link with a one-time token.
// /desktop/complete#token=…&verifier=…  opens in the app's window. It trades
//   the token and the app's verifier for a session, then opens the Library.
import * as React from "react"
import { Redirect, useSearchParams } from "wouter"

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

import { finishDesktopHandoff, startDesktopHandoff } from "@/lib/api.ts"
import { authLink, isChallenge } from "@/lib/desktop.ts"
import { useSession } from "@/lib/session.ts"

function Frame({
  title,
  description,
  children,
}: {
  title: string
  description: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm" data-testid="desktop-sign-in">
        <CardHeader className="items-center gap-3 text-center">
          <Wordmark className="justify-center" />
          <CardTitle className="font-reading text-2xl font-medium">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </main>
  )
}

const Waiting = () => (
  <main className="flex min-h-svh items-center justify-center">
    <Spinner className="size-6 text-muted-foreground" />
  </main>
)

/** In the browser: hand this sign-in to the desktop app. */
export function DesktopSignInScreen() {
  const { session } = useSession()
  const [params] = useSearchParams()
  const challenge = params.get("challenge")
  const [state, setState] = React.useState<
    { step: "ask" } | { step: "busy" } | { step: "sent"; link: string }
  >({ step: "ask" })
  const [error, setError] = React.useState<string | null>(null)

  if (!isChallenge(challenge))
    return (
      <Frame
        title="Sign in from the app"
        description="This page opens from the Seply Learn desktop app. Start again from the app's sign-in screen."
      />
    )
  if (session.status === "loading") return <Waiting />
  if (session.status === "error")
    return (
      <Frame
        title="Can't reach the server"
        description={session.error.message}
      />
    )
  if (session.status === "signed-out") {
    const back = `/desktop/sign-in?challenge=${challenge}`
    return <Redirect to={`/sign-in?next=${encodeURIComponent(back)}`} replace />
  }

  const open = () => {
    setState({ step: "busy" })
    setError(null)
    startDesktopHandoff(challenge).then(
      ({ token }) => {
        const link = authLink(token)
        setState({ step: "sent", link })
        window.location.assign(link)
      },
      () => {
        setState({ step: "ask" })
        setError("Couldn't sign the app in. Try again.")
      }
    )
  }

  if (state.step === "sent")
    return (
      <Frame
        title="Back to the app"
        description="Seply Learn should open signed in. You can close this tab."
      >
        <p className="text-center text-sm text-muted-foreground">
          Nothing happened? Start again from the app's sign-in screen.
        </p>
      </Frame>
    )

  return (
    <Frame
      title="Open Seply Learn?"
      description={
        <>
          The desktop app will be signed in as{" "}
          <span className="font-medium text-foreground">
            {session.user.email}
          </span>
          .
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Button
          className="w-full"
          onClick={open}
          disabled={state.step === "busy"}
        >
          {state.step === "busy" && <Spinner />}
          Open the app
        </Button>
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Only continue if you started this from the app.
        </p>
      </div>
    </Frame>
  )
}

/** In the app's window: finish the sign-in the browser handed over. */
export function DesktopCompleteScreen() {
  // In the fragment, so they never reach the server's logs.
  const [handoff] = React.useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const token = hash.get("token")
    const verifier = hash.get("verifier")
    return token && verifier ? { token, verifier } : null
  })
  const [failed, setFailed] = React.useState(!handoff)
  // The token works once, so it is sent once, however often this renders.
  const sent = React.useRef(false)

  React.useEffect(() => {
    if (!handoff || sent.current) return
    sent.current = true
    window.history.replaceState(null, "", window.location.pathname)
    finishDesktopHandoff(handoff.token, handoff.verifier).then(
      // A full load, so the whole app starts signed in.
      () => window.location.replace("/"),
      () => setFailed(true)
    )
  }, [handoff])

  if (!failed) return <Waiting />
  return (
    <Frame
      title="Couldn't sign in"
      description="This sign-in link has expired or was already used."
    >
      <Button className="w-full" onClick={() => window.location.assign("/")}>
        Try again
      </Button>
    </Frame>
  )
}

// Sign in (spec §3.1): Google, through Better Auth. The CI-only test
// credentials have no UI; tests sign up through the API and share the cookie.
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
import { toast } from "@seply/ui/components/toast"

import { signInWithGoogle } from "@/lib/api.ts"
import { authorizeUrl, signedOAuthQuery } from "@/lib/oauth.ts"
import { useSession } from "@/lib/session.ts"

export function SignInScreen() {
  const { session } = useSession()
  const [starting, setStarting] = React.useState(false)
  // Where to go back to (e.g. the Expedition an anonymous reader was reading).
  const [params] = useSearchParams()
  const raw = params.get("next") ?? "/"
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/"
  // An MCP client's sign-in (WP-5.4): Better Auth sent the authorization
  // request here as a signed query. Signing in continues to /consent; a
  // reader who is signed in already goes straight back to it.
  const oauthQuery = signedOAuthQuery(window.location.search)
  const signedIn = session.status === "signed-in"

  React.useEffect(() => {
    if (signedIn && oauthQuery)
      window.location.replace(authorizeUrl(oauthQuery))
  }, [signedIn, oauthQuery])

  if (signedIn)
    return oauthQuery ? (
      <main className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </main>
    ) : (
      <Redirect to={next} replace />
    )

  const start = () => {
    setStarting(true)
    signInWithGoogle(next, oauthQuery ?? undefined).catch(() => {
      setStarting(false)
      toast.add({
        title: "Couldn't start sign-in",
        description: "Google sign-in isn't available right now.",
        type: "error",
      })
    })
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center gap-3 text-center">
          <Wordmark className="justify-center" />
          <CardTitle className="font-reading text-2xl font-medium">
            Sign in
          </CardTitle>
          <CardDescription>
            {oauthQuery
              ? "Sign in to connect an agent to your Expeditions."
              : "Build Expeditions from your AI chats, and read them your way."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={start} disabled={starting}>
            {starting && <Spinner />}
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

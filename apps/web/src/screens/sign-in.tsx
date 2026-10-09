// Sign in (spec §3.1, §2.6): Google, through Better Auth, and on instances
// that turn it on (self-hosted: the Node entry's default, WP-6.1) email and
// password, with sign-up when it is open. `GET /api/sign-in-options` says
// which. The CI-only test credentials have no UI; tests sign up through the
// API and share the cookie.
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import { Spinner } from "@seply/ui/components/spinner"
import { toast } from "@seply/ui/components/toast"

import {
  ApiError,
  getSignInOptions,
  signInWithEmail,
  signInWithGoogle,
  type SignInOptions,
} from "@/lib/api.ts"
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
  const [options, setOptions] = React.useState<SignInOptions | null>(null)

  React.useEffect(() => {
    let live = true
    getSignInOptions().then((o) => live && setOptions(o))
    return () => {
      live = false
    }
  }, [])

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
          {!options ? (
            <div className="flex justify-center py-2">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : (
            <FieldGroup>
              {options.emailPassword && (
                <EmailForm
                  signUpOpen={options.signUp}
                  oauthQuery={oauthQuery ?? undefined}
                  next={next}
                />
              )}
              {options.emailPassword && options.google && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  or
                </FieldSeparator>
              )}
              {options.google && (
                <Button
                  className="w-full"
                  variant={options.emailPassword ? "outline" : "default"}
                  onClick={start}
                  disabled={starting}
                >
                  {starting && <Spinner />}
                  Continue with Google
                </Button>
              )}
            </FieldGroup>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

/** Email and password: sign in, or (when open) make an account. */
function EmailForm({
  signUpOpen,
  oauthQuery,
  next,
}: {
  signUpOpen: boolean
  oauthQuery?: string
  next: string
}) {
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const signUp = mode === "sign-up"

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    signInWithEmail({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      name: signUp ? String(form.get("name") ?? "").trim() : undefined,
      oauthQuery,
    }).then(
      () => {
        // A full load, so the whole app starts signed in. An MCP client's
        // sign-in stays here, and the screen continues to /consent.
        if (oauthQuery) window.location.reload()
        else window.location.assign(next)
      },
      (err: unknown) => {
        setBusy(false)
        setError(
          err instanceof ApiError && err.status !== 0
            ? signUp
              ? err.message || "Couldn't make the account."
              : "That email and password don't match an account."
            : "Can't reach the server."
        )
      }
    )
  }

  return (
    <form
      onSubmit={submit}
      aria-label={signUp ? "Create an account" : "Sign in with email"}
    >
      <FieldGroup>
        {signUp && (
          <Field>
            <FieldLabel htmlFor="sign-in-name">Name</FieldLabel>
            <Input id="sign-in-name" name="name" autoComplete="name" required />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
          <Input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete={signUp ? "new-password" : "current-password"}
            minLength={signUp ? 8 : undefined}
            required
          />
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Spinner />}
          {signUp ? "Create account" : "Sign in"}
        </Button>
        {signUpOpen && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              setMode(signUp ? "sign-in" : "sign-up")
              setError(null)
            }}
          >
            {signUp ? "I have an account" : "Create an account"}
          </Button>
        )}
      </FieldGroup>
    </form>
  )
}

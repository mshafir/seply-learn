// Sign in (spec §3.1, §2.6): Google, through Better Auth, and on instances
// that turn it on (self-hosted: the Node entry's default, WP-6.1) email and
// password, with sign-up when it is open. `GET /api/sign-in-options` says
// which. The CI-only test credentials have no UI; tests sign up through the
// API and share the cookie.
//
// Beside the card, a brand panel says what Seply Learn is. One card signs
// in and makes accounts. A new account goes on to the welcome step
// (/welcome: connect your agent) unless `next` points somewhere specific
// (an invite, an Expedition, an MCP client's consent): Google sends it there
// through Better Auth's new-user callback, email sign-up directly.
import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Link, Redirect, useSearchParams } from "wouter"

import { Wordmark } from "@seply/ui/components/brand"
import { Button, buttonVariants } from "@seply/ui/components/button"
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
import { desktopBridge } from "@/lib/desktop.ts"
import { sameOriginPath } from "@/lib/next-path.ts"
import { authorizeUrl, signedOAuthQuery } from "@/lib/oauth.ts"
import { useSession } from "@/lib/session.ts"

export function SignInScreen() {
  const { session } = useSession()
  const [starting, setStarting] = React.useState(false)
  // Where to go back to (e.g. the Expedition an anonymous reader was reading).
  const [params] = useSearchParams()
  const raw = params.get("next") ?? "/"
  const next = sameOriginPath(raw)
  // An MCP client's sign-in (WP-5.4): Better Auth sent the authorization
  // request here as a signed query. Signing in continues to /consent; a
  // reader who is signed in already goes straight back to it.
  const oauthQuery = signedOAuthQuery(window.location.search)
  const signedIn = session.status === "signed-in"
  // Where a brand-new account goes: the welcome step, unless it came here
  // on its way somewhere specific.
  const newUserPath = !oauthQuery && next === "/" ? WELCOME_PATH : undefined
  const [options, setOptions] = React.useState<SignInOptions | null>(null)
  // On desktop: the sign-in has gone out to the system browser.
  const [inBrowser, setInBrowser] = React.useState(false)

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

  // In the desktop app Google can't run in the window (it refuses embedded
  // browsers), so the app opens the system browser and the sign-in comes back
  // as a link (spec §10.3).
  const viaBrowser = desktopBridge()?.signInWithBrowser
  const start = () => {
    if (viaBrowser) {
      viaBrowser().then(
        () => setInBrowser(true),
        () =>
          toast.add({
            title: "Couldn't open your browser",
            type: "error",
          })
      )
      return
    }
    setStarting(true)
    signInWithGoogle(next, oauthQuery ?? undefined, newUserPath).catch(() => {
      setStarting(false)
      toast.add({
        title: "Couldn't start sign-in",
        description: "Google sign-in isn't available right now.",
        type: "error",
      })
    })
  }

  return (
    <div className="flex min-h-svh flex-col bg-background md:flex-row">
      <BrandPanel />
      <main className="flex flex-1 flex-col items-center gap-5 px-4 py-6 md:justify-center md:px-8 md:py-12">
        <Card className="w-full max-w-sm max-md:bg-transparent max-md:py-0 max-md:ring-0 md:[--card-spacing:--spacing(7)]">
          <CardHeader className="gap-1.5 max-md:px-0">
            <CardTitle className="text-lg font-semibold md:text-xl">
              Sign in or create an account
            </CardTitle>
            <CardDescription className="max-md:hidden">
              {oauthQuery
                ? "Sign in to connect an agent to your Expeditions."
                : "One account works for both. It takes a few seconds."}
            </CardDescription>
          </CardHeader>
          <CardContent className="max-md:px-0">
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
                    newUserPath={newUserPath}
                  />
                )}
                {options.emailPassword && options.google && (
                  <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card max-md:*:data-[slot=field-separator-content]:bg-background">
                    or
                  </FieldSeparator>
                )}
                {options.google && (
                  <Button
                    className="w-full"
                    size="lg"
                    variant={options.emailPassword ? "outline" : "default"}
                    onClick={start}
                    disabled={starting}
                  >
                    {starting && <Spinner />}
                    Continue with Google
                  </Button>
                )}
                {inBrowser && (
                  <p
                    role="status"
                    className="text-center text-sm text-muted-foreground"
                  >
                    Finish signing in in your browser. This window signs in when
                    you come back.
                  </p>
                )}
                {!oauthQuery && (
                  <p className="text-xs text-muted-foreground">
                    <span className="max-md:hidden">New here? </span>
                    Next you connect the AI agent you already use, or skip it
                    and read first.
                  </p>
                )}
              </FieldGroup>
            )}
          </CardContent>
        </Card>
        {!oauthQuery && (
          <Link href="/explore" className={buttonVariants({ variant: "link" })}>
            <span>
              Explore public Expeditions
              <span className="max-md:hidden"> without signing in</span>
            </span>
          </Link>
        )}
      </main>
    </div>
  )
}

/** Where a brand-new account lands first. */
const WELCOME_PATH = "/welcome"

const POINTS = [
  "Free to sign up. Read and edit without any AI.",
  "Build with the AI agent you already use, or your own API key.",
  "Share an Expedition, or make it public for anyone to read.",
]

/** What Seply Learn is, on the brand's sprout green. */
function BrandPanel() {
  return (
    <section
      aria-label="About Seply Learn"
      data-testid="sign-in-brand"
      className="flex flex-col gap-5 bg-sprout px-4 pt-8 pb-7 text-foreground md:flex-1 md:justify-between md:gap-12 md:px-16 md:py-12"
    >
      <Wordmark className="text-2xl md:text-[1.625rem]" />
      <div className="flex max-w-lg flex-col gap-5">
        <h1 className="font-reading text-[2rem] leading-tight font-medium tracking-tight md:text-5xl md:leading-[1.125]">
          Turn questions into something you can read and come back to.
        </h1>
        <p className="text-calyx md:text-base">
          <span className="max-md:hidden">
            Seply Learn turns your chats, files and questions into Expeditions:
            Concepts you can read, linked together and shown in Views.
          </span>
          <span className="md:hidden">
            Free to sign up. Build with the AI agent you already use, or your
            own API key.
          </span>
        </p>
      </div>
      <ul className="flex max-w-lg flex-col gap-3 max-md:hidden">
        {POINTS.map((p) => (
          <li key={p} className="flex items-start gap-2.5">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-calyx" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Email and password: sign in, or (when open) make an account. */
function EmailForm({
  signUpOpen,
  oauthQuery,
  next,
  newUserPath,
}: {
  signUpOpen: boolean
  oauthQuery?: string
  next: string
  /** Where a new account goes instead of `next` (the welcome step). */
  newUserPath?: string
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
        else window.location.assign((signUp && newUserPath) || next)
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

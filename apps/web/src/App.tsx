// Routes (spec §3.1). wouter: a few kB, and routes are all the app needs.
//   /sign-in            Google sign-in
//   /welcome            connect your agent: the Library sends an account
//                       there once, the first time it opens (spec §3.1)
//   /invite/:token      an invite link: accept it (WP-5.1)
//   /consent            an MCP client asks to connect: scopes and Expeditions (WP-5.4)
//   /                   the Library
//   /explore            public Expeditions, for anyone (signed out too)
//   /e/:id(/:viewId)    the Expedition screen, on a View (signed out too:
//                       public and unlisted Expeditions need no login)
//   /e/:id/embed        the live embed is its own page (embed.html, served
//                       by the server for Public Expeditions only); the app
//                       shell (an older cached service worker) shows nothing
//   /new/:id(/views)    the create flow: Sources, then Choose Views (WP-3.4)
//   /settings           Settings: AI keys, models and the per-ask cap (WP-3.3)
//   /settings/access-requests  Admin › Access requests (hosted access approval, WP-7.3)
//   /connect            Connect an agent, step by step (WP-5.5); ?e=<id>: for
//                       that Expedition
//   /desktop/sign-in    in the browser: hand a sign-in to the desktop app (WP-8.2)
//   /desktop/complete   in the app's window: finish that sign-in
//   /showcase           the design system (WP-0.3)
import { Redirect, Route, Switch } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@seply/ui/components/alert"
import { Spinner } from "@seply/ui/components/spinner"

import { AccessRequestsScreen } from "@/screens/access-requests.tsx"
import { ConnectScreen } from "@/connect/connect-screen.tsx"
import { ConsentScreen } from "@/screens/consent.tsx"
import {
  DesktopCompleteScreen,
  DesktopSignInScreen,
} from "@/screens/desktop-sign-in.tsx"
import { CreateScreen } from "@/create/create-screen.tsx"
import { ExpeditionScreen } from "@/expedition/expedition-screen.tsx"
import { ExploreScreen } from "@/screens/explore.tsx"
import { useSession } from "@/lib/session.ts"
import { InviteScreen } from "@/screens/invite.tsx"
import { LibraryScreen } from "@/screens/library.tsx"
import { SettingsScreen } from "@/screens/settings.tsx"
import { SignInScreen } from "@/screens/sign-in.tsx"
import { WelcomeScreen } from "@/screens/welcome.tsx"
import { Showcase } from "@/showcase/Showcase.tsx"

const Loading = () => (
  <div className="flex min-h-svh items-center justify-center">
    <Spinner className="size-6 text-muted-foreground" />
  </div>
)

/** Renders its children once the session is known, signed in or not. */
function WaitForSession({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  if (session.status === "loading") return <Loading />
  return children
}

/** Renders its children only when signed in; otherwise sends to /sign-in. */
function RequireUser({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  if (session.status === "loading") return <Loading />
  if (session.status === "error")
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Can't reach the server</AlertTitle>
          <AlertDescription>{session.error.message}</AlertDescription>
        </Alert>
      </div>
    )
  if (session.status === "signed-out") return <Redirect to="/sign-in" replace />
  return children
}

/**
 * The Library, or the welcome step first for an account that hasn't seen it
 * (spec §3.1). Only a plain visit to `/` goes there: a link to somewhere
 * specific opens that, and the welcome step waits for the next visit here.
 */
function LibraryOrWelcome() {
  const { session } = useSession()
  if (session.status === "signed-in" && session.user.welcomed === false)
    return <Redirect to="/welcome" replace />
  return <LibraryScreen />
}

export function App() {
  return (
    <Switch>
      <Route path="/showcase" component={Showcase} />
      <Route path="/sign-in" component={SignInScreen} />
      <Route path="/desktop/sign-in" component={DesktopSignInScreen} />
      <Route path="/desktop/complete" component={DesktopCompleteScreen} />
      <Route path="/invite/:token">
        {(params) => (
          <WaitForSession>
            <InviteScreen token={params.token} />
          </WaitForSession>
        )}
      </Route>
      <Route path="/explore">
        <WaitForSession>
          <ExploreScreen />
        </WaitForSession>
      </Route>
      <Route path="/e/:id/embed">
        <div className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
          This Expedition isn't available.
        </div>
      </Route>
      <Route path="/e/:id/:viewId?">
        {(params) => (
          <WaitForSession>
            {/* A new Expedition (a Fork just made) starts a fresh screen. */}
            <ExpeditionScreen
              key={params.id}
              expeditionId={params.id}
              viewId={params.viewId}
            />
          </WaitForSession>
        )}
      </Route>
      <Route path="/new/:id/:step?">
        {(params) => (
          <RequireUser>
            <CreateScreen
              key={params.id}
              expeditionId={params.id}
              step={params.step === "views" ? "views" : "sources"}
            />
          </RequireUser>
        )}
      </Route>
      <Route path="/consent">
        <RequireUser>
          <ConsentScreen />
        </RequireUser>
      </Route>
      <Route path="/settings/access-requests">
        <RequireUser>
          <AccessRequestsScreen />
        </RequireUser>
      </Route>
      <Route path="/welcome">
        <RequireUser>
          <WelcomeScreen />
        </RequireUser>
      </Route>
      <Route path="/connect">
        <RequireUser>
          <ConnectScreen />
        </RequireUser>
      </Route>
      <Route path="/settings">
        <RequireUser>
          <SettingsScreen />
        </RequireUser>
      </Route>
      <Route path="/">
        <RequireUser>
          <LibraryOrWelcome />
        </RequireUser>
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  )
}

// Routes (spec §3.1). wouter: a few kB, and routes are all the app needs.
//   /sign-in            Google sign-in
//   /                   the Library
//   /e/:id(/:viewId)    the Expedition screen, on a View (signed out too:
//                       public and unlisted Expeditions need no login)
//   /showcase           the design system (WP-0.3)
import { Redirect, Route, Switch } from "wouter"

import { Alert, AlertDescription, AlertTitle } from "@umbel/ui/components/alert"
import { Spinner } from "@umbel/ui/components/spinner"

import { ExpeditionScreen } from "@/expedition/expedition-screen.tsx"
import { useSession } from "@/lib/session.ts"
import { LibraryScreen } from "@/screens/library.tsx"
import { SignInScreen } from "@/screens/sign-in.tsx"
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

export function App() {
  return (
    <Switch>
      <Route path="/showcase" component={Showcase} />
      <Route path="/sign-in" component={SignInScreen} />
      <Route path="/e/:id/:viewId?">
        {(params) => (
          <WaitForSession>
            <ExpeditionScreen expeditionId={params.id} viewId={params.viewId} />
          </WaitForSession>
        )}
      </Route>
      <Route path="/">
        <RequireUser>
          <LibraryScreen />
        </RequireUser>
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  )
}

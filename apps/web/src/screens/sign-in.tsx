// Sign in (spec §3.1): Google, through Better Auth. The CI-only test
// credentials have no UI; tests sign up through the API and share the cookie.
import * as React from "react"
import { Redirect, useSearchParams } from "wouter"

import { Wordmark } from "@umbel/ui/components/brand"
import { Button } from "@umbel/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@umbel/ui/components/card"
import { Spinner } from "@umbel/ui/components/spinner"
import { toast } from "@umbel/ui/components/toast"

import { signInWithGoogle } from "@/lib/api.ts"
import { useSession } from "@/lib/session.ts"

export function SignInScreen() {
  const { session } = useSession()
  const [starting, setStarting] = React.useState(false)
  // Where to go back to (e.g. the Expedition an anonymous reader was reading).
  const [params] = useSearchParams()
  const raw = params.get("next") ?? "/"
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/"

  if (session.status === "signed-in") return <Redirect to={next} replace />

  const start = () => {
    setStarting(true)
    signInWithGoogle(next).catch(() => {
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
            Build Expeditions from your AI chats, and read them your way.
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

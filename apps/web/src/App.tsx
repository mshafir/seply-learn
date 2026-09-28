import { Button } from "@umbel/ui/components/button"
import { Wordmark } from "@umbel/ui/components/brand"
import { ModeToggle } from "@umbel/ui/components/mode-toggle"

import { Showcase } from "@/showcase/Showcase.tsx"

// Routing arrives with WP-1.5; until then the path picks the page.
export function App() {
  if (window.location.pathname.startsWith("/showcase")) return <Showcase />

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Wordmark />
        <ModeToggle />
      </header>
      <main className="flex flex-1 flex-col items-start gap-4 p-6">
        <h1 className="font-reading text-3xl font-medium">
          Nothing to read yet.
        </h1>
        <p className="text-muted-foreground">
          Expeditions arrive in later work packages. The design system is on
          the showcase page.
        </p>
        <Button nativeButton={false} render={<a href="/showcase" />}>Open the showcase</Button>
      </main>
    </div>
  )
}

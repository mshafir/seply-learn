// The way into the setup page (spec §6.4) from anywhere. Inside an
// Expedition it carries that Expedition, so the first prompt is about it.
import { BotIcon } from "lucide-react"
import { Link, useRoute } from "wouter"

import { Button } from "@seply/ui/components/button"

export function ConnectLink({
  as = "button",
  variant = "outline",
  size,
  children,
}: {
  /** A button, or a link inside a sentence. */
  as?: "button" | "text"
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  children: React.ReactNode
}) {
  const [, params] = useRoute("/e/:id/:viewId?")
  const href = params?.id
    ? `/connect?e=${encodeURIComponent(params.id)}`
    : "/connect"
  if (as === "text")
    return (
      <Link
        href={href}
        data-testid="connect-link"
        className="underline underline-offset-4 hover:text-foreground"
      >
        {children}
      </Link>
    )
  return (
    <Button
      variant={variant}
      size={size}
      data-testid="connect-link"
      render={<Link href={href} />}
    >
      <BotIcon />
      {children}
    </Button>
  )
}

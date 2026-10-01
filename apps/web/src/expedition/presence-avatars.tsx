// The header's presence avatars (spec §3.6): everyone else here now, one
// avatar per person in their colour (presence.ts), with a tooltip naming
// them and the View they're on; an agent via MCP shows as a participant with
// a bot icon. Hidden when nobody else is here. The list comes from
// use-presence.ts `usePresenceAvatars`.
import { BotIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@seply/ui/components/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@seply/ui/components/tooltip"
import { kindColor } from "@seply/ui/lib/kinds"

import { hueFor, type PresenceAvatar } from "@/expedition/presence.ts"
import { initials } from "@/screens/library-sections.ts"

/** How many avatars show before "+N". */
const SHOWN = 4

export function PresenceAvatars({
  avatars,
  viewName,
}: {
  avatars: PresenceAvatar[]
  /** A View's name, for "on the Timeline". */
  viewName: (viewId: string) => string | undefined
}) {
  if (!avatars.length) return null
  const shown = avatars.slice(0, SHOWN)
  const more = avatars.length - shown.length
  return (
    <AvatarGroup data-testid="presence" aria-label="Here now" role="group">
      {shown.map((a) => {
        const where = a.views.map(viewName).filter(Boolean).join(", ")
        const label = where ? `${a.name}, on ${where}` : a.name
        return (
          <Tooltip key={a.agent ? `agent:${a.userId}` : a.userId}>
            <TooltipTrigger
              render={
                <Avatar
                  size="sm"
                  aria-label={label}
                  data-testid="presence-avatar"
                  data-user={a.userId}
                />
              }
            >
              <AvatarFallback
                className="text-xs font-semibold text-background"
                style={{ backgroundColor: kindColor(hueFor(a.userId)) }}
              >
                {a.agent ? <BotIcon className="size-3.5" /> : initials(a.name)}
              </AvatarFallback>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      })}
      {more > 0 && (
        <AvatarGroupCount className="size-6 text-xs">+{more}</AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}

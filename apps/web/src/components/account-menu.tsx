// The account menu (spec §3.6, §3.10): who is signed in, the theme toggle
// (System / Light / Dark) and sign out. DropdownMenu + Avatar, with the
// radio group from the shadcn ModeToggle recipe.
import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useLocation } from "wouter"

import { Avatar, AvatarFallback } from "@seply/ui/components/avatar"
import { Button } from "@seply/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import { useTheme, type Theme } from "@seply/ui/components/theme-provider"
import { toast } from "@seply/ui/components/toast"

import { useSession } from "@/lib/session.ts"

function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words.at(-1)![0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

export function AccountMenu() {
  const { session, signOut } = useSession()
  const { theme, setTheme } = useTheme()
  const [, navigate] = useLocation()
  const user = session.status === "signed-in" ? session.user : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account"
          />
        }
      >
        <Avatar>
          <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
            {user ? initials(user.name, user.email) : "?"}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {user && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {user.name}
              </span>
              <span className="text-xs">{user.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                signOut().then(
                  () => navigate("/sign-in"),
                  () => toast.add({ title: "Couldn't sign out. Try again.", type: "error" })
                )
              }
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

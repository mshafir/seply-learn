import type { ReactNode } from "react"

import { Badge } from "@seply/ui/components/badge"
import { Wordmark, SeplyGlyph } from "@seply/ui/components/brand"
import { Button } from "@seply/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import { ModeToggle } from "@seply/ui/components/mode-toggle"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@seply/ui/components/popover"
import { Progress } from "@seply/ui/components/progress"
import { Separator } from "@seply/ui/components/separator"
import { useTheme } from "@seply/ui/components/theme-provider"
import { toast } from "@seply/ui/components/toast"
import { KIND_HUES, kindColor } from "@seply/ui/lib/kinds"
import { cn } from "@seply/ui/lib/utils"

// A Storybook-less showcase (WP-0.3): every token, Kind hue, type style and
// component, rendered side by side in the light and dark palettes.

const SURFACE_TOKENS = [
  ["ground", "--background"],
  ["surface", "--card"],
  ["fill", "--muted"],
  ["hover", "--accent"],
  ["border", "--border"],
  ["input", "--input"],
] as const

const INK_TOKENS = [
  ["ink", "--foreground"],
  ["muted ink", "--muted-foreground"],
  ["accent", "--primary"],
  ["suggested", "--suggested"],
  ["suggested-text", "--suggested-text"],
  ["success", "--success"],
  ["destructive", "--destructive"],
  ["ring", "--ring"],
] as const

const CHART_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
] as const

export function Showcase() {
  const { theme, resolvedTheme } = useTheme()

  return (
    <div className="min-h-svh">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <a href="/" aria-label="Home">
            <Wordmark />
          </a>
          <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            Design system
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            Theme: <span className="font-mono">{theme}</span> (showing{" "}
            <span className="font-mono">{resolvedTheme}</span>)
          </span>
          <ModeToggle />
        </div>
      </header>
      <div className="grid lg:grid-cols-2">
        <ThemePanel mode="light" />
        <ThemePanel mode="dark" />
      </div>
    </div>
  )
}

function ThemePanel({ mode }: { mode: "light" | "dark" }) {
  return (
    <section
      data-testid={`panel-${mode}`}
      className={cn(
        mode,
        "flex min-w-0 flex-col gap-10 bg-background p-6 text-foreground"
      )}
    >
      <h2 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        {mode === "light" ? "Light" : "Warm charcoal (dark)"}
      </h2>
      <Tokens />
      <KindHues />
      <TypeStyles />
      <Components />
      <Prose />
      <Brand />
    </section>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 font-mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function Swatch({ label, token }: { label: string; token: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-8 shrink-0 rounded-md border"
        style={{ background: `var(${token})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {token}
        </span>
      </span>
    </div>
  )
}

function Tokens() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>Grounds and lines</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SURFACE_TOKENS.map(([label, token]) => (
            <Swatch key={token} label={label} token={token} />
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Ink and signals</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {INK_TOKENS.map(([label, token]) => (
            <Swatch key={token} label={label} token={token} />
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Text on ground and surface</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {["bg-background", "bg-card"].map((bg) => (
            <div key={bg} className={cn(bg, "rounded-lg border p-3 text-sm")}>
              <p className="text-foreground">Ink: the body text.</p>
              <p className="text-muted-foreground">Muted ink: secondary.</p>
              <p className="text-primary">Accent: links and actions.</p>
              <p className="text-suggested-text">Suggested: from the source.</p>
              <p className="text-success">Success: ready.</p>
              <p className="text-destructive">Destructive: remove.</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Charts (mapped to Kind hues)</SectionTitle>
        <div className="flex gap-2">
          {CHART_TOKENS.map((token) => (
            <span
              key={token}
              title={token}
              className="h-8 flex-1 rounded-md"
              style={{ background: `var(${token})` }}
            />
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Suggested (Proposals)</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border-2 border-dashed border-suggested bg-card px-3 py-2 text-sm">
            A proposed Concept
          </span>
          <svg width="120" height="16" aria-hidden="true">
            <line
              x1="0"
              y1="8"
              x2="120"
              y2="8"
              stroke="var(--suggested)"
              strokeWidth="2"
              strokeDasharray="6 5"
            />
          </svg>
          <span className="text-sm text-suggested-text">2 suggestions</span>
        </div>
      </div>
    </div>
  )
}

function KindHues() {
  return (
    <div>
      <SectionTitle>Kind and Relationship Type hues</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {KIND_HUES.map((hue) => (
          <div
            key={hue}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
          >
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ background: kindColor(hue) }}
            />
            <span
              className="font-mono text-xs font-medium tracking-wider uppercase"
              style={{ color: kindColor(hue) }}
            >
              {hue}
            </span>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 360 40" className="mt-3 w-full" aria-hidden="true">
        {KIND_HUES.map((hue, i) => (
          <g key={hue}>
            <line
              x1={i * 30 + 15}
              y1={32}
              x2={((i + 1) % 12) * 30 + 15}
              y2={8}
              stroke={kindColor(hue)}
              strokeWidth={2}
            />
            <circle cx={i * 30 + 15} cy={32} r={6} fill={kindColor(hue)} />
          </g>
        ))}
      </svg>
    </div>
  )
}

function TypeStyles() {
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Type</SectionTitle>
      <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        IBM Plex Mono · labels · Concept · 1848
      </p>
      <p className="font-reading text-4xl leading-tight font-medium">
        Newsreader for reading
      </p>
      <p className="font-reading text-2xl">
        Overviews, articles and View questions.
      </p>
      <p className="text-lg font-semibold">IBM Plex Sans semibold, the interface</p>
      <p className="text-sm">
        IBM Plex Sans regular at 14px, with <em>italic</em> and{" "}
        <strong className="font-medium">medium</strong>.
      </p>
      <p className="text-xs text-muted-foreground">Small muted caption, 12px.</p>
      <p className="font-mono text-sm">const kind = "violet" // Plex Mono</p>
    </div>
  )
}

function Components() {
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle>Components</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="success">Ready</Badge>
        <Badge variant="progress">Building</Badge>
        <Badge variant="queued">Queued</Badge>
      </div>
      <div className="flex max-w-sm flex-wrap items-center gap-4">
        <Progress value={40} aria-label="Progress" className="flex-1" />
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>
            Popover
          </PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Building</PopoverTitle>
              <PopoverDescription>Built 1 of 3</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            toast.add({
              title: "Anatomy is ready",
              description: "The View finished building.",
              type: "success",
            })
          }
        >
          Success toast
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.add({
              title: "Claude proposed 2 Concepts",
              description: "Review them in the side panel.",
              type: "info",
              actionProps: { children: "Review" },
            })
          }
        >
          Toast with action
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.add({
              title: "Building the Timeline…",
              type: "loading",
            })
          }
        >
          Loading toast
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Menu
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Expedition</DropdownMenuLabel>
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Share</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>How a compiler works</CardTitle>
          <CardDescription>24 Concepts · 3 Views</CardDescription>
          <CardAction>
            <Badge variant="outline">Draft</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm">
          A Card on the surface colour, with a Separator below.
          <Separator className="my-3" />
          <span className="text-muted-foreground">Edited 2 minutes ago</span>
        </CardContent>
        <CardFooter className="gap-2">
          <Button size="sm">Open</Button>
          <Button size="sm" variant="ghost">
            Later
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

function Prose() {
  return (
    <div>
      <SectionTitle>Prose (Typeset in Newsreader)</SectionTitle>
      <article className="typeset rounded-lg border bg-card p-5">
        <h2>What an umbel is</h2>
        <p>
          An <strong>umbel</strong> is a flower cluster whose short stalks all
          spread from one point, like the ribs of an umbrella. Carrot, dill and
          fennel grow them. See the <a href="#">Inflorescence</a> Concept.
        </p>
        <blockquote>
          The stalks are equal in length, so the flowers form a flat or
          rounded top.
        </blockquote>
        <ul>
          <li>Simple umbels end in single flowers.</li>
          <li>
            Compound umbels end in smaller umbels, the <em>umbellets</em>.
          </li>
        </ul>
        <p>
          Inline <code>code</code> and a <mark>highlighted</mark> phrase.
        </p>
        <table>
          <thead>
            <tr>
              <th>Plant</th>
              <th>Umbel</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Dill</td>
              <td>Compound</td>
            </tr>
            <tr>
              <td>Ivy</td>
              <td>Simple</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  )
}

function Brand() {
  return (
    <div>
      <SectionTitle>Brand</SectionTitle>
      <div className="flex flex-wrap items-center gap-6">
        <Wordmark className="text-3xl" />
        <SeplyGlyph className="size-12" />
        <SeplyGlyph className="size-4" />
      </div>
    </div>
  )
}

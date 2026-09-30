// The Views rail (spec §3.6): 272 px on the left, each entry the View's name
// and question. shadcn Sidebar, placed under the header; a Sheet on phones.
//
// While an Expedition builds (spec §3.5), each entry also shows its build
// status: queued, building (with the step and a progress bar), ready or
// failed (with the reason); "Not built" when the build stopped before it.
import { Badge } from "@seply/ui/components/badge"
import { Progress } from "@seply/ui/components/progress"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@seply/ui/components/sidebar"
import type { ViewRow } from "@seply/sync"

import type { ViewBuild } from "@/expedition/build-state.ts"
import { viewTypeMeta } from "@/expedition/labels.ts"

export function ViewsRail({
  views,
  selectedViewId,
  onSelectView,
  buildOf,
}: {
  views: ViewRow[]
  selectedViewId: string | null
  onSelectView: (viewId: string) => void
  /** Each View's build status (default: ready). */
  buildOf?: (view: ViewRow) => ViewBuild
}) {
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Sidebar
      aria-label="Views"
      data-testid="views-rail"
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono tracking-wider uppercase">
            Views
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {views.map((view) => {
              const meta = viewTypeMeta(view.viewType)
              const build: ViewBuild = buildOf?.(view) ?? { status: "ready" }
              const name = view.label || meta.name
              return (
                <SidebarMenuItem
                  key={view.id}
                  data-testid="rail-view"
                  data-status={build.status}
                >
                  <SidebarMenuButton
                    size="lg"
                    isActive={view.id === selectedViewId}
                    aria-current={
                      view.id === selectedViewId ? "page" : undefined
                    }
                    className="h-auto items-start py-2"
                    onClick={() => {
                      onSelectView(view.id)
                      if (isMobile) setOpenMobile(false)
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{name}</span>
                        <BuildBadge build={build} />
                      </div>
                      <RailDetail view={view} build={build} />
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

function BuildBadge({ build }: { build: ViewBuild }) {
  switch (build.status) {
    case "ready":
      return null
    case "queued":
      return (
        <Badge variant="queued" data-testid="build-status">
          Queued
        </Badge>
      )
    case "building":
      return (
        <Badge variant="progress" data-testid="build-status">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-suggested motion-reduce:animate-none"
          />
          Building
        </Badge>
      )
    case "failed":
      return (
        <Badge variant="destructive" data-testid="build-status">
          Failed
        </Badge>
      )
    case "stopped":
      return (
        <Badge variant="queued" data-testid="build-status">
          Not built
        </Badge>
      )
  }
}

function RailDetail({ view, build }: { view: ViewRow; build: ViewBuild }) {
  const line = "line-clamp-2 text-xs leading-snug"
  switch (build.status) {
    case "ready":
      return view.question ? (
        <span className={`${line} text-muted-foreground`}>{view.question}</span>
      ) : null
    case "queued":
      return (
        <span className={`${line} text-muted-foreground`}>{build.step}</span>
      )
    case "building":
      return (
        <>
          <span className={`${line} text-suggested-text`}>{build.step}</span>
          <Progress
            value={Math.round(build.progress * 100)}
            aria-label={`Building ${view.label || viewTypeMeta(view.viewType).name}`}
            className="**:data-[slot=progress-indicator]:bg-suggested"
          />
        </>
      )
    case "failed":
    case "stopped":
      return (
        <span
          data-testid="build-reason"
          className={`${line} ${build.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {build.reason}
        </span>
      )
  }
}

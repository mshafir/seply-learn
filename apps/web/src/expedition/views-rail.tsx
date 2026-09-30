// The Views rail (spec §3.6): 272 px on the left, each entry the View's name
// and question. shadcn Sidebar, placed under the header; a Sheet on phones.
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

import { viewTypeMeta } from "@/expedition/labels.ts"

export function ViewsRail({
  views,
  selectedViewId,
  onSelectView,
}: {
  views: ViewRow[]
  selectedViewId: string | null
  onSelectView: (viewId: string) => void
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
              return (
                <SidebarMenuItem key={view.id}>
                  <SidebarMenuButton
                    size="lg"
                    isActive={view.id === selectedViewId}
                    aria-current={view.id === selectedViewId ? "page" : undefined}
                    className="h-auto items-start py-2"
                    onClick={() => {
                      onSelectView(view.id)
                      if (isMobile) setOpenMobile(false)
                    }}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold">
                        {view.label || meta.name}
                      </span>
                      {view.question && (
                        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {view.question}
                        </span>
                      )}
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

// The frame around the Views: an app window, the burned-in captions and the
// cursors. Built from @seply/ui (tokens, Wordmark, Tabs, Avatar); the window
// is a stand-in for the app's shell, drawn small enough to read in a video.
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Wordmark } from "@seply/ui/components/brand";
import { Tabs, TabsList, TabsTrigger } from "@seply/ui/components/tabs";
import { inOut, type XY } from "./anim.ts";
import { CAPTIONS, FPS } from "./timing.ts";

/** The composition's CSS size; the renderer scales it 1.5× to 1920 × 1080. */
export const FRAME = { width: 1280, height: 720 };
/** Where the app window sits, above the captions. */
export const WINDOW = { left: 40, top: 28, width: 1200, height: 590 };
export const HEADER = 48;
export const BODY = { width: WINDOW.width, height: WINDOW.height - HEADER };

export function Backdrop({ children }: { children?: ReactNode }) {
  return <AbsoluteFill className="bg-background font-sans text-foreground">{children}</AbsoluteFill>;
}

export function AppWindow({
  title,
  tabs,
  active,
  right,
  style,
  children,
}: {
  title: ReactNode;
  tabs: string[];
  active: string;
  right?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-xl border border-border bg-background"
      style={{ ...WINDOW, ...style }}
    >
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-4" style={{ height: HEADER }}>
        <Wordmark className="text-base" />
        <span className="h-5 w-px bg-border" />
        <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <Tabs value={active}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} className="px-3">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {right}
      </header>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

/** The storyboard's captions, burned in under the window. */
export function Captions() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const c = CAPTIONS.find((c) => t >= c.start && t < c.end);
  if (!c) return null;
  const a = inOut(frame, c.start, c.end, 0.25);
  return (
    <div className="absolute inset-x-0 flex justify-center px-16" style={{ top: WINDOW.top + WINDOW.height + 14, opacity: a }}>
      <p className="max-w-[1000px] text-center text-[22px] leading-snug font-medium text-balance text-foreground">{c.text}</p>
    </div>
  );
}

/** A pointer, with a name label for other people. */
export function Cursor({ at, name, color, pressed }: { at: XY; name?: string; color?: string; pressed?: boolean }) {
  const fill = color ?? "var(--foreground)";
  return (
    <div className="absolute" style={{ left: at.x, top: at.y, transform: `scale(${pressed ? 0.88 : 1})`, transformOrigin: "0 0" }}>
      <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden>
        <path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.5 20.6 L10 13.4 L17 13.4 Z" fill={fill} stroke="var(--background)" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      {name && (
        <span className="absolute top-5 left-4 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap text-background" style={{ background: fill }}>
          {name}
        </span>
      )}
    </div>
  );
}

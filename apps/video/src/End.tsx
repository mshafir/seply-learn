// Scene 7: the end card. The glyph and wordmark are @seply/ui's own.
import { useCurrentFrame } from "remotion";
import { Wordmark } from "@seply/ui/components/brand";
import { tween } from "./anim.ts";

export const HEADLINE = "Turn questions into something you can read and come back to.";

export function End({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const a = tween(frame, at, 0.5);
  const b = tween(frame, at + 0.35, 0.5);
  const c = tween(frame, at + 0.7, 0.5);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8">
      <div style={{ opacity: a, transform: `translateY(${(1 - a) * 10}px)` }}>
        <Wordmark className="text-[64px]" />
      </div>
      <p className="max-w-[860px] text-center font-reading text-[40px] leading-tight" style={{ opacity: b, transform: `translateY(${(1 - b) * 10}px)` }}>
        {HEADLINE}
      </p>
      <p className="font-mono text-xl text-muted-foreground" style={{ opacity: c }}>
        seply.app
      </p>
    </div>
  );
}

// Scenes 1 and 2: a question typed into a box, then optional Sources beside it.
import { useCurrentFrame } from "remotion";
import { ArrowRightIcon, BotIcon, LinkIcon, MessageSquareIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@seply/ui/components/badge";
import { Button } from "@seply/ui/components/button";
import { mix, tween } from "./anim.ts";
import { FRAME } from "./chrome.tsx";
import { FPS } from "./timing.ts";

export const QUESTION = "Which e-bike gets me up the hills on my commute?";

const T = { boxIn: 0.3, typeFrom: 0.9, typeTo: 3.9, routes: 4.3, build: 5.6, side: 7.0, chat: 7.4, link: 8.2, out: 12.6 };

export function Intro() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const boxIn = tween(frame, T.boxIn, 0.45);
  const typed = Math.round(QUESTION.length * Math.min(1, Math.max(0, (t - T.typeFrom) / (T.typeTo - T.typeFrom))));
  const caretOn = typed < QUESTION.length || Math.floor(t * 2) % 2 === 0;
  const side = tween(frame, T.side, 0.5);
  const out = tween(frame, T.out, 0.4);
  const pressed = t >= T.build && t < T.build + 0.15;

  // The question sits centred, then moves left to make room for the Sources.
  const boxW = 640;
  const left = mix((FRAME.width - boxW) / 2, 90, side);
  return (
    <div className="absolute inset-0" style={{ opacity: 1 - out, transform: `translateY(${-out * 16}px)` }}>
      <div className="absolute" style={{ left, top: mix(220, 210, side), width: boxW, opacity: boxIn, transform: `translateY(${(1 - boxIn) * 12}px)` }}>
        <p className="mb-3 font-mono text-sm text-muted-foreground">New Expedition</p>
        <div className="rounded-xl border border-input bg-card p-5">
          <p className="min-h-[76px] font-reading text-[30px] leading-tight">
            {QUESTION.slice(0, typed)}
            <span className="ml-0.5 inline-block h-[30px] w-[2px] translate-y-[5px] bg-foreground" style={{ opacity: caretOn ? 1 : 0 }} />
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Routes frame={frame} />
            <Button className={`ml-auto ${pressed ? "bg-primary/80" : ""}`}>
              Build
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      </div>
      <SourceCard frame={frame} at={T.chat} top={170} icon={<MessageSquareIcon />} title="Chat · e-bikes for a hilly commute">
        <p>
          <span className="text-muted-foreground">You:</span> My commute has a 12% ramp at the end.
        </p>
        <p>
          <span className="text-muted-foreground">Assistant:</span> On a 12% ramp, look at torque before anything else.
        </p>
      </SourceCard>
      <SourceCard frame={frame} at={T.link} top={340} icon={<LinkIcon />} title="example.com/e-bike-torque">
        <p>Torque explained: why newton-metres matter more than watts on a hill.</p>
      </SourceCard>
    </div>
  );
}

function Routes({ frame }: { frame: number }) {
  const a = tween(frame, T.routes, 0.4);
  return (
    <div className="flex gap-2" style={{ opacity: a }}>
      <Badge variant="secondary">
        <SparklesIcon />
        In Seply Learn
      </Badge>
      <Badge variant="outline">
        <BotIcon />
        From your agent, over MCP
      </Badge>
    </div>
  );
}

function SourceCard({ frame, at, top, icon, title, children }: { frame: number; at: number; top: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const k = tween(frame, at, 0.45);
  if (k <= 0) return null;
  return (
    <div
      className="absolute w-[440px] rounded-xl border border-border bg-card p-4 text-sm"
      style={{ left: 760, top, opacity: k, transform: `translateX(${(1 - k) * 60}px)` }}
    >
      <div className="mb-2 flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        <span className="flex-1 truncate">{title}</span>
        <Badge variant="secondary">Optional</Badge>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

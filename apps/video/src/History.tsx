// The History panel in scene 6: Changes, newest first, and a new one arriving
// from someone else. Built from @seply/ui tokens; the app's panel lists the same.
import { HistoryIcon } from "lucide-react";
import { tween } from "./anim.ts";

const CHANGES = [
  { who: "You", what: "Accepted 1 suggestion", when: "1 min ago" },
  { who: "Seply Learn", what: "Built from 2 Sources", when: "4 min ago" },
];

export function History({ frame, width, newAt }: { frame: number; width: number; newAt: number }) {
  const k = tween(frame, newAt, 0.45);
  return (
    <div className="flex h-full flex-col gap-3 p-4" style={{ width }}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <HistoryIcon className="size-4 text-muted-foreground" />
        History
      </p>
      <div style={{ height: k * 66, opacity: k, overflow: "hidden" }}>
        <Change who="Jonas" what="Added a note to Birch Metro 8" when="just now" fresh />
      </div>
      {CHANGES.map((c) => (
        <Change key={c.what} {...c} />
      ))}
    </div>
  );
}

function Change({ who, what, when, fresh }: { who: string; what: string; when: string; fresh?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 text-sm ${fresh ? "border-primary" : "border-border"}`}>
      <p className="font-medium">{what}</p>
      <p className="text-xs text-muted-foreground">
        {who} · {when}
      </p>
    </div>
  );
}

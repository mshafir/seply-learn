// Scenes 3 to 6, in one app window: Concepts appear, the same Expedition is
// read through several Views, an agent's suggestion is accepted, and two
// people work in it at once. Every View is drawn by @seply/views.
import { useMemo, type CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { MessageSquareIcon, BotIcon, CheckIcon } from "lucide-react";
import { ComparisonTable, nodeSize, type Positions, type View } from "@seply/views";
import { Avatar, AvatarFallback, AvatarGroup } from "@seply/ui/components/avatar";
import { Badge } from "@seply/ui/components/badge";
import { Button } from "@seply/ui/components/button";
import { mix, path, tween, type XY } from "./anim.ts";
import { AppWindow, BODY, Cursor } from "./chrome.tsx";
import { ebike, ebikeWithSuggestion, SUGGESTED_ID, suggestedKey, trip } from "./data.ts";
import { FlowStage, fitViewport, toScreen, type Viewport } from "./FlowStage.tsx";
import { learnView, useLayouts, type Layouts } from "./layouts.ts";
import { History } from "./History.tsx";
import { SettledView } from "./Settled.tsx";
import { FPS } from "./timing.ts";

// When things happen, in seconds on the video's clock (the storyboard's).
const T = {
  windowIn: 13.0,
  cardsFrom: 14.0,
  cardStep: 0.32,
  sourceTag: 20.0,
  toTable: 25.0,
  toTimeline: 29.5,
  toMap: 33.5,
  backToPath: 38.0,
  suggest: 38.8,
  suggestLabel: 39.6,
  suggestCard: 40.4,
  click: 43.2,
  accepted: 43.4,
  together: 48.0,
  edit: 51.6,
  newChange: 52.2,
  windowOut: 54.6,
};
export const APP_TIMES = T;

const compare = ebike.view("compare") as Extract<View, { viewType: "comparison-table" }>;
const timeline = trip.view("timeline");
const map = trip.view("map");
const bikes = ["cedar-urban", "alder-c5", "birch-metro-8"].map(ebike.concept);
const HISTORY_W = 280;
/** Where the Comparison Table draws its three rows (y, in the window's body). */
const ROWS = [81, 110, 139];
/** The table is wider than the window at the app's size; drawn a little smaller. */
const TABLE_ZOOM = 0.8;

export function AppScenes() {
  const frame = useCurrentFrame();
  const layouts = useLayouts();
  const t = frame / FPS;
  const windowIn = tween(frame, T.windowIn, 0.45);
  const windowOut = tween(frame, T.windowOut, 0.4);

  const onTrip = t >= T.toTimeline && t < T.backToPath;
  const title = onTrip ? trip.expedition.title : ebike.expedition.title;
  const tabs = onTrip ? [map.label, timeline.label] : [learnView.label, compare.label];
  const active =
    t < T.toTable + 0.1 ? learnView.label : t < T.toTimeline ? compare.label : t < T.toMap ? timeline.label : t < T.backToPath ? map.label : learnView.label;
  // The title crossfades when the Expedition changes.
  const titleAlpha = Math.min(1, Math.abs(t - T.toTimeline) / 0.2, Math.abs(t - T.backToPath) / 0.2);

  return (
    <AppWindow
      title={<span style={{ opacity: titleAlpha }}>{title}</span>}
      tabs={tabs}
      active={active}
      right={<People frame={frame} />}
      style={{ opacity: windowIn * (1 - windowOut), transform: `scale(${mix(0.985, 1, windowIn)})` }}
    >
      {layouts && <Body frame={frame} layouts={layouts} />}
    </AppWindow>
  );
}

function Body({ frame, layouts }: { frame: number; layouts: Layouts }) {
  const t = frame / FPS;
  return (
    <>
      {t < T.toTable + 0.8 && <PathScene frame={frame} layouts={layouts} />}
      {t >= T.toTable && t < T.toTimeline + 0.5 && <TableScene frame={frame} />}
      {t >= T.toTimeline && t < T.toMap + 0.5 && (
        <Layer alpha={tween(frame, T.toTimeline + 0.2, 0.4) * (1 - tween(frame, T.toMap, 0.35))} rise={1 - tween(frame, T.toTimeline + 0.2, 0.4)}>
          <SettledView expedition={trip.expedition} view={timeline} />
        </Layer>
      )}
      {t >= T.toMap && t < T.backToPath + 0.4 && (
        <Layer alpha={tween(frame, T.toMap + 0.2, 0.4) * (1 - tween(frame, T.backToPath, 0.35))} rise={1 - tween(frame, T.toMap + 0.2, 0.4)}>
          <SettledView expedition={trip.expedition} view={map} />
        </Layer>
      )}
      {t >= T.backToPath && <SuggestScene frame={frame} layouts={layouts} />}
    </>
  );
}

function Layer({ alpha, rise = 0, children, style }: { alpha: number; rise?: number; children: React.ReactNode; style?: CSSProperties }) {
  if (alpha <= 0) return null;
  return (
    <div className="absolute inset-0" style={{ opacity: alpha, transform: `translateY(${rise * 12}px)`, ...style }}>
      {children}
    </div>
  );
}

/** Scene 3, and the start of 4: the Learning path builds up, then its bikes glide into the table. */
function PathScene({ frame, layouts }: { frame: number; layouts: Layouts }) {
  const { map, overlay, positions } = layouts.base;
  const scope = map.scope;
  const vp = useMemo(() => fitViewport(scope, positions, BODY.width, BODY.height, 56), [scope, positions]);
  // Cards appear in reading order: left to right, then top to bottom.
  const order = useMemo(
    () =>
      scope.concepts
        .filter((c) => positions.has(c.id))
        .sort((a, b) => positions.get(a.id)!.x - positions.get(b.id)!.x || positions.get(a.id)!.y - positions.get(b.id)!.y)
        .map((c) => c.id),
    [scope, positions],
  );
  const appearAt = (id: string) => T.cardsFrom + order.indexOf(id) * T.cardStep;
  const out = tween(frame, T.toTable, 0.3);
  const glide = tween(frame, T.toTable, 0.45);
  const bikesOut = tween(frame, T.toTable + 0.5, 0.25);

  // The bikes glide to where the table draws its rows.
  const rowAt = (i: number): XY => ({ x: 12, y: ROWS[i] });
  const now: Positions = new Map(
    [...positions].map(([id, p]) => {
      const i = bikes.indexOf(id);
      if (i < 0 || glide === 0) return [id, p];
      const c = scope.concepts.find((c) => c.id === id)!;
      const w = nodeSize(scope.weights.get(id) ?? 0, c.title).width;
      const target = toFlow(vp, { x: rowAt(i).x + (w * vp.zoom) / 2, y: rowAt(i).y });
      return [id, { x: mix(p.x, target.x, glide), y: mix(p.y, target.y, glide) }];
    }),
  );
  const shown = (id: string) => {
    const a = tween(frame, appearAt(id), 0.4);
    return bikes.includes(id) ? a * (1 - bikesOut) : a * (1 - out);
  };
  const drawn = (from: string, to: string) => tween(frame, Math.max(appearAt(from), appearAt(to)) + 0.2, 0.45) * (1 - out);

  const torque = ebike.concept("torque");
  const tagAt = toScreen(vp, positions.get(torque)!);
  const tagAlpha = tween(frame, T.sourceTag, 0.4) * (1 - out);
  const card = nodeSize(scope.weights.get(torque) ?? 0, "Torque (Nm)");

  return (
    <FlowStage
      expedition={ebike.expedition}
      view={learnView}
      scope={scope}
      overlay={overlay}
      positions={now}
      viewport={vp}
      width={BODY.width}
      height={BODY.height}
      shown={shown}
      drawn={drawn}
    >
      {tagAlpha > 0 && (
        <div
          className="absolute"
          style={{
            left: tagAt.x - (card.width * vp.zoom) / 2,
            top: tagAt.y + (card.height * vp.zoom) / 2 + 6 + (1 - tagAlpha) * 6,
            opacity: tagAlpha,
          }}
        >
          <Badge variant="outline" className="bg-card">
            <MessageSquareIcon />
            From: Chat · e-bikes for a hilly commute
          </Badge>
        </div>
      )}
    </FlowStage>
  );
}

const toFlow = (vp: Viewport, p: XY): XY => ({ x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom });

/** Scene 4: the Comparison Table, rows in one by one. */
function TableScene({ frame }: { frame: number }) {
  const alpha = tween(frame, T.toTable + 0.35, 0.35) * (1 - tween(frame, T.toTimeline, 0.35));
  if (alpha <= 0) return null;
  const rows = [0, 1, 2]
    .map((i) => `.video-table tbody tr:nth-child(${i + 1}) { opacity: ${tween(frame, T.toTable + 0.45 + i * 0.12, 0.35)}; }`)
    .join("\n");
  return (
    <Layer alpha={alpha} style={{ padding: "8px 8px 0" }}>
      <style>{rows}</style>
      <div className="video-table h-full" style={{ zoom: TABLE_ZOOM }}>
        <ComparisonTable expedition={ebike.expedition} view={compare} onSelect={() => {}} />
      </div>
    </Layer>
  );
}

/** Scenes 5 and 6: the Learning path again, an agent's suggestion accepted, then two people at once. */
function SuggestScene({ frame, layouts }: { frame: number; layouts: Layouts }) {
  const t = frame / FPS;
  const { base, suggested } = layouts;
  const scope = suggested.map.scope;
  const reflow = tween(frame, T.suggest, 0.45);
  const panel = tween(frame, T.together + 0.2, 0.45);
  const width = BODY.width - panel * HISTORY_W;

  const vpBase = useMemo(() => fitViewport(base.map.scope, base.positions, BODY.width, BODY.height, 56), [base]);
  const vpSuggested = useMemo(() => fitViewport(scope, suggested.positions, BODY.width, BODY.height, 56), [scope, suggested]);
  const vpShared = useMemo(() => fitViewport(scope, suggested.positions, BODY.width - HISTORY_W, BODY.height, 40), [scope, suggested]);
  const lerpVp = (a: Viewport, b: Viewport, k: number): Viewport => ({ x: mix(a.x, b.x, k), y: mix(a.y, b.y, k), zoom: mix(a.zoom, b.zoom, k) });
  const vp = lerpVp(lerpVp(vpBase, vpSuggested, reflow), vpShared, panel);

  const positions: Positions = new Map(
    [...suggested.positions].map(([id, p]) => {
      const from = base.positions.get(id) ?? p;
      return [id, { x: mix(from.x, p.x, reflow), y: mix(from.y, p.y, reflow) }];
    }),
  );
  const alpha = tween(frame, T.backToPath + 0.2, 0.35);
  const isAccepted = t >= T.accepted;
  const shown = (id: string) => (id === SUGGESTED_ID ? tween(frame, T.suggest + 0.2, 0.4) : alpha);
  const drawn = (from: string, to: string) =>
    from === SUGGESTED_ID || to === SUGGESTED_ID ? tween(frame, T.suggest + 0.5, 0.45) : alpha;

  const s = toScreen(vp, positions.get(SUGGESTED_ID)!);
  const size = nodeSize(scope.weights.get(SUGGESTED_ID) ?? 0, "Torque sensor");
  const half = { w: (size.width * vp.zoom) / 2, h: (size.height * vp.zoom) / 2 };
  const label = tween(frame, T.suggestLabel, 0.35) * (1 - tween(frame, T.accepted + 0.1, 0.35));
  const card = tween(frame, T.suggestCard, 0.4) * (1 - tween(frame, T.accepted + 0.1, 0.35));
  const cardAt = { x: s.x + half.w + 24, y: s.y - 70 };
  const accept = { x: cardAt.x + 36, y: cardAt.y + 100 };
  const cursor = path(frame, [
    [41.0, BODY.width - 60, BODY.height - 20],
    [42.8, accept.x, accept.y],
  ]);
  const cursorAlpha = tween(frame, 41.0, 0.3) * (1 - tween(frame, 44.6, 0.4));
  const pressed = t >= T.click && t < T.accepted + 0.1;

  return (
    <div className="absolute inset-0 flex">
      <div className="relative" style={{ width }}>
        <FlowStage
          expedition={ebikeWithSuggestion}
          view={learnView}
          scope={scope}
          overlay={suggested.overlay}
          positions={positions}
          viewport={vp}
          width={width}
          height={BODY.height}
          shown={shown}
          drawn={drawn}
          selected={t >= T.edit ? ebike.concept("birch-metro-8") : undefined}
          suggested={isAccepted ? undefined : { concepts: new Set([SUGGESTED_ID]), relationships: new Set([suggestedKey]) }}
        >
          {label > 0 && (
            <div className="absolute" style={{ left: s.x - half.w, top: s.y - half.h - 30 - (1 - label) * 6, opacity: label }}>
              <Badge variant="outline" className="border-suggested bg-card text-suggested-text">
                <BotIcon />
                Suggested by the agent
              </Badge>
            </div>
          )}
          {card > 0 && (
            <div
              className="absolute w-[260px] rounded-lg border border-border bg-card p-3 text-sm"
              style={{ left: cardAt.x, top: cardAt.y + (1 - card) * 8, opacity: card }}
            >
              <p className="font-medium">Add “Torque sensor”?</p>
              <p className="mt-1 text-muted-foreground">It explains why some motors start smoothly on a steep ramp.</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className={pressed ? "bg-primary/80" : undefined}>
                  <CheckIcon />
                  Accept
                </Button>
                <Button size="sm" variant="outline">
                  Dismiss
                </Button>
              </div>
            </div>
          )}
          {cursorAlpha > 0 && (
            <div style={{ opacity: cursorAlpha }}>
              <Cursor at={cursor} pressed={pressed} />
            </div>
          )}
          <Collaborators frame={frame} vp={vp} positions={positions} />
        </FlowStage>
      </div>
      {panel > 0 && (
        <div className="shrink-0 overflow-hidden border-l border-border bg-card" style={{ width: panel * HISTORY_W }}>
          <History frame={frame} width={HISTORY_W} newAt={T.newChange} />
        </div>
      )}
    </div>
  );
}

/** Scene 6: two named cursors moving over the View. */
function Collaborators({ frame, vp, positions }: { frame: number; vp: Viewport; positions: Positions }) {
  const t = frame / FPS;
  if (t < T.together + 0.4) return null;
  const at = (fileId: string, dx = 0, dy = 0) => {
    const p = toScreen(vp, positions.get(ebike.concept(fileId))!);
    return [p.x + dx, p.y + dy] as const;
  };
  const maya = path(frame, [
    [48.6, ...at("watt-hours", -40, 60)],
    [50.2, ...at("range-on-hills", 10, 8)],
    [51.8, ...at("hills", -20, 10)],
    [53.4, ...at("low-maintenance", 20, 6)],
  ]);
  const jonas = path(frame, [
    [48.8, ...at("cedar-urban", 60, 70)],
    [50.6, ...at("alder-c5", 20, 10)],
    [51.4, ...at("birch-metro-8", 10, 4)],
    [53.6, ...at("birch-metro-8", 40, 20)],
  ]);
  const a = tween(frame, T.together + 0.5, 0.35) * (1 - tween(frame, T.windowOut - 0.2, 0.3));
  return (
    <div style={{ opacity: a }}>
      <Cursor at={maya} name="Maya" color="var(--kind-violet)" />
      <Cursor at={jonas} name="Jonas" color="var(--kind-teal)" pressed={t >= T.edit && t < T.edit + 0.2} />
    </div>
  );
}

/** Who else is here: avatars in the header from scene 6. */
function People({ frame }: { frame: number }) {
  const a = tween(frame, T.together + 0.3, 0.35);
  if (a <= 0) return null;
  return (
    <AvatarGroup style={{ opacity: a }}>
      <Avatar size="sm">
        <AvatarFallback className="bg-kind-violet text-background">M</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback className="bg-kind-teal text-background">J</AvatarFallback>
      </Avatar>
    </AvatarGroup>
  );
}

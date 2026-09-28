import { useEffect, useMemo, useState } from "react";
import { Info, Search } from "lucide-react";
import clsx from "clsx";
import type { Graph } from "./lib/types";
import { scopeFor, sign, trace } from "./lib/view";
import { Canvas } from "./components/Canvas";
import { ComparisonTable } from "./components/ComparisonTable";
import { Outline } from "./components/Outline";
import { Timeline } from "./components/Timeline";
import { GeoMap } from "./components/GeoMap";
import { DetailPanel } from "./components/DetailPanel";
import { ViewTypeDrawer } from "./components/ViewTypeDrawer";
import { Anatomy } from "./components/Anatomy";
import { LearningPath } from "./components/LearningPath";
import { AttributeGrid } from "./components/AttributeGrid";
import { Rates } from "./components/Rates";
import { KindIcon } from "./components/icons";
import { viewTypes } from "./views/viewTypes";

const modules = import.meta.glob<Graph>("./graphs/*.json", { eager: true, import: "default" });
const graphs = Object.values(modules).sort((a, b) => a.title.localeCompare(b.title));

// State lives in the hash (#graph/view/concept) so a reload keeps your place.
function readHash() {
  const [g, p, c] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { g, p, c };
}

export default function App() {
  const initial = readHash();
  const [graphId, setGraphId] = useState(graphs.find((g) => g.id === initial.g)?.id ?? graphs[0].id);
  const graph = graphs.find((g) => g.id === graphId)!;
  const [viewId, setViewId] = useState(
    graph.views.find((v) => v.id === initial.p)?.id ?? graph.views[0].id,
  );
  const view = graph.views.find((v) => v.id === viewId) ?? graph.views[0];
  const doc = viewTypes.get(view.viewType);
  const [docOpen, setDocOpen] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(initial.c || undefined);
  const [query, setQuery] = useState("");

  useEffect(() => {
    history.replaceState(null, "", `#${[graph.id, view.id, selected ?? ""].join("/")}`);
  }, [graph.id, view.id, selected]);

  const onCanvas = ["evidence", "cause-and-effect", "lineage", "learning-path"].includes(view.viewType);
  const scope = useMemo(() => scopeFor(graph, view), [graph, view]);
  const traced = useMemo(
    () =>
      view.viewType === "cause-and-effect" && selected && scope.concepts.some((c) => c.id === selected)
        ? trace(view.settings, scope.relationships, selected)
        : undefined,
    [view, scope, selected],
  );

  // Free-text + #tag search over title, summary, body and tags.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const terms = q.split(/\s+/);
    return new Set(
      graph.concepts
        .filter((c) =>
          terms.every((t) =>
            t.startsWith("#")
              ? (c.tags ?? []).some((tag) => tag.toLowerCase().startsWith(t.slice(1)))
              : [c.title, c.summary, c.body, ...(c.tags ?? [])].join(" ").toLowerCase().includes(t),
          ),
        )
        .map((c) => c.id),
    );
  }, [graph, query]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of graph.concepts) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [graph]);

  const shownKinds = new Set(scope.concepts.map((c) => c.kind));
  const shownTypes = new Set(scope.relationships.map((r) => r.type));

  const switchGraph = (id: string) => {
    const g = graphs.find((g) => g.id === id)!;
    setGraphId(id);
    setViewId(g.views[0].id);
    setSelected(undefined);
    setQuery("");
  };

  const common = { graph, selected, onSelect: setSelected, matches };

  return (
    <div className="flex h-screen flex-col bg-stone-50 text-stone-900">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-4 py-2">
        <div className="text-sm font-semibold tracking-tight text-stone-500">Mindmaps</div>
        <nav className="flex gap-1">
          {graphs.map((g) => (
            <button
              key={g.id}
              onClick={() => switchGraph(g.id)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                g.id === graph.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100",
              )}
            >
              {g.title}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex w-80 items-center gap-2 rounded-md border border-stone-200 px-2.5 py-1.5">
          <Search className="size-4 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search text or #tag"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
      </header>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-stone-200 bg-white px-4 py-1.5">
        <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-stone-400">View</span>
        {graph.views.map((v) => (
          <button
            key={v.id}
            onClick={() => setViewId(v.id)}
            title={v.description}
            className={clsx(
              "whitespace-nowrap rounded-full px-3 py-1 text-sm",
              v.id === view.id ? "bg-amber-100 font-semibold text-amber-900" : "text-stone-600 hover:bg-stone-100",
            )}
          >
            {v.label}
            <span className={clsx("ml-1.5 text-xs font-normal", v.id === view.id ? "text-amber-700" : "text-stone-400")}>
              {viewTypes.get(v.viewType)?.name ?? v.viewType}
            </span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-stone-200 bg-white p-4 text-sm">
          <div>
            <p className="text-stone-600">{graph.summary}</p>
            {graph.source.dates && <p className="mt-1 text-xs text-stone-400">Source: {graph.source.kind} · {graph.source.dates}</p>}
          </div>
          {view.description && (
            <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
              <div className="text-xs font-semibold uppercase tracking-wide">{view.label}</div>
              <p className="mt-1">{view.description}</p>
            </div>
          )}
          {onCanvas && <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Kinds</h3>
            <ul className="space-y-1">
              {graph.kinds.filter((k) => shownKinds.has(k.id)).map((k) => (
                <li key={k.id} className="flex items-center gap-2" style={{ color: k.color }}>
                  <KindIcon name={k.icon ?? k.id} className="size-4" />
                  <span className="text-stone-700">{k.label}</span>
                  <span className="ml-auto text-xs text-stone-400">{scope.concepts.filter((c) => c.kind === k.id).length}</span>
                </li>
              ))}
            </ul>
          </div>}
          {onCanvas && shownTypes.size > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Relationships</h3>
              <ul className="space-y-1">
                {graph.relationshipTypes.filter((t) => shownTypes.has(t.id)).map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={view.viewType === "cause-and-effect" ? (sign(view.settings, t.id) > 0 ? "#dc2626" : "#16a34a") : t.color} strokeWidth="2" strokeDasharray={t.dashed ? "4 3" : undefined} /></svg>
                    <span className="text-stone-700">{t.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Tags</h3>
            <div className="flex flex-wrap gap-1">
              {tags.map(([t, n]) => (
                <button key={t} onClick={() => setQuery(`#${t}`)} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 hover:bg-stone-200">
                  #{t} <span className="text-stone-400">{n}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col">
          {doc && (
            <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm">
              <span className="rounded bg-stone-200/70 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-stone-600">{doc.name}</span>
              <span className="italic text-stone-600">{doc.answers}</span>
              <button
                onClick={() => setDocOpen(true)}
                title="How this View Type works"
                className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-200 hover:text-stone-900"
              >
                <Info className="size-4" /> View Type
              </button>
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {view.viewType === "comparison-table" ? (
              <ComparisonTable key={view.id} {...common} settings={view.settings} />
            ) : view.viewType === "outline" ? (
              <Outline key={view.id} {...common} settings={view.settings} />
            ) : view.viewType === "timeline" ? (
              <Timeline key={view.id} {...common} settings={view.settings} />
            ) : view.viewType === "map" ? (
              <GeoMap key={view.id} {...common} settings={view.settings} />
            ) : view.viewType === "anatomy" ? (
              <Anatomy key={view.id} {...common} settings={view.settings} />
            ) : view.viewType === "learning-path" ? (
              <LearningPath key={view.id} {...common} view={view} settings={view.settings} />
            ) : view.viewType === "quadrant" ? (
              <AttributeGrid
                key={view.id}
                {...common}
                variant={view.settings.progression ? "ladder" : "quadrant"}
                x={view.settings.x}
                y={view.settings.y}
                tags={view.settings.tags}
                evidence={view.settings.evidence}
              />
            ) : view.viewType === "rates" ? (
              <Rates key={view.id} {...common} settings={view.settings} />
            ) : (
              <Canvas {...common} view={view} scope={scope} />
            )}
          </div>
          {docOpen && doc && <ViewTypeDrawer doc={doc} onClose={() => setDocOpen(false)} />}
        </main>

        {selected && <DetailPanel graph={graph} id={selected} onSelect={setSelected} trace={traced} />}
      </div>
    </div>
  );
}

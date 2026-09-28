import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpen, X } from "lucide-react";
import type { Graph } from "../lib/types";
import { formatDate, neighbours, type NetEffect, type Trace } from "../lib/view";
import { KindIcon } from "./icons";

type Entry = { id: string; article: boolean };

// The side panel: a Concept's overview (one deep paragraph), its full article
// on demand, and its Relationships. Everything opened from here (links in the
// text, related Concepts, the article) stays in the panel, with a back stack.
export function DetailPanel({
  graph,
  id,
  onSelect,
  trace,
}: {
  graph: Graph;
  id: string;
  onSelect: (id?: string) => void;
  trace?: Trace; // Cause & Effect trace mode
}) {
  const [stack, setStack] = useState<Entry[]>([{ id, article: false }]);
  const top = stack[stack.length - 1];
  const scroller = useRef<HTMLDivElement>(null);

  // A selection made elsewhere (canvas, table, search) joins the back stack.
  useEffect(() => {
    setStack((s) => (s[s.length - 1].id === id ? s : [...s, { id, article: false }]));
  }, [id]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [top.id, top.article]);

  const go = (next: Entry) => {
    setStack((s) => [...s, next]);
    if (next.id !== top.id) onSelect(next.id);
  };
  const open = (cid?: string) => cid && go({ id: cid, article: false });
  const back = () => {
    const prev = stack[stack.length - 2];
    if (!prev) return;
    setStack((s) => s.slice(0, -1));
    if (prev.id !== top.id) onSelect(prev.id);
  };

  const c = graph.concepts.find((c) => c.id === top.id);
  if (!c) return null;
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));
  const kind = graph.kinds.find((k) => k.id === c.kind);
  const relTypes = new Map(graph.relationshipTypes.map((t) => [t.id, t]));
  const attrs = new Map((graph.attributes ?? []).map((a) => [a.id, a]));
  const { out, inc } = neighbours(graph, c.id);
  const prev = stack[stack.length - 2];
  const prevLabel = prev ? (prev.id === c.id ? "Overview" : byId.get(prev.id)?.title) : undefined;

  // Links written as [text](#c/<id>) navigate inside the panel.
  const md = (text: string) => (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href?.startsWith("#c/") ? (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                open(href.slice(3));
              }}
              className="cursor-pointer font-medium text-indigo-700 decoration-indigo-300 hover:decoration-indigo-700"
            >
              {children}
            </a>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
      }}
    >
      {text}
    </Markdown>
  );

  const RelList = ({ title, rels, dir }: { title: string; rels: typeof out; dir: "out" | "in" }) =>
    rels.length ? (
      <div className="mt-5">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">{title}</h3>
        <ul className="space-y-1 text-sm">
          {rels.map((r, i) => {
            const other = byId.get(dir === "out" ? r.to : r.from);
            const t = relTypes.get(r.type);
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-xs font-medium" style={{ color: t?.color }}>
                  {dir === "out" ? t?.label : `← ${t?.label}`}
                </span>
                <button
                  className="text-left font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-900"
                  onClick={() => open(other?.id)}
                >
                  {other?.title}
                </button>
                {r.note && <span className="text-stone-500">— {r.note}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;

  const overview = c.overview ?? c.body;

  return (
    <aside className="flex h-full w-[480px] shrink-0 flex-col border-l border-stone-200 bg-white">
      {prev && (
        <button
          onClick={back}
          className="flex items-center gap-1.5 border-b border-stone-100 px-4 py-1.5 text-left text-xs text-stone-500 hover:bg-stone-50 hover:text-stone-900"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span className="truncate">Back to {prevLabel}</span>
        </button>
      )}
      <div className="flex items-start gap-3 border-b border-stone-200 p-4">
        <div className="mt-1 rounded-md p-1.5" style={{ background: `${kind?.color}22`, color: kind?.color }}>
          <KindIcon name={kind?.icon ?? c.kind} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: kind?.color }}>
            {kind?.label}
            {c.date && <span className="ml-2 text-stone-400">{formatDate(c)}</span>}
            {top.article && <span className="ml-2 rounded bg-stone-100 px-1.5 py-px text-stone-500">Article</span>}
          </div>
          <h2 className="text-lg font-semibold leading-snug">{c.title}</h2>
          {c.tags?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <span key={t} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">#{t}</span>
              ))}
            </div>
          ) : null}
        </div>
        <button onClick={() => onSelect(undefined)} className="rounded p-1 text-stone-400 hover:bg-stone-100">
          <X className="size-4" />
        </button>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto p-4">
        {top.article && c.article ? (
          <>
            {c.summary && <p className="mb-4 text-base font-medium text-stone-700">{c.summary}</p>}
            <div className="prose prose-sm prose-stone max-w-none prose-h2:mt-6 prose-h2:text-base">{md(c.article)}</div>
            <button onClick={back} className="mt-6 flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900">
              <ArrowLeft className="size-4" /> Back to {prevLabel}
            </button>
          </>
        ) : (
          <>
            {c.summary && <p className="mb-3 font-medium text-stone-700">{c.summary}</p>}
            {c.attributes && (
              <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-stone-50 p-3 text-sm">
                {Object.entries(c.attributes).map(([k, v]) => {
                  const def = attrs.get(k);
                  return (
                    <div key={k} className="contents">
                      <dt className="text-stone-500">{def?.label ?? k}</dt>
                      <dd className="font-medium">
                        {def?.type === "money" && typeof v === "number"
                          ? `$${v.toLocaleString()}`
                          : typeof v === "boolean"
                            ? v ? "yes" : "no"
                            : `${v}${def?.unit ? ` ${def.unit}` : ""}`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
            {overview && <div className="prose prose-sm prose-stone max-w-none">{md(overview)}</div>}
            {c.article && (
              <button
                onClick={() => go({ id: c.id, article: true })}
                className="mt-4 flex w-full items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-left hover:border-stone-400 hover:bg-white"
              >
                <BookOpen className="size-5 shrink-0 text-indigo-600" />
                <span>
                  <span className="block text-sm font-semibold">Read the full article</span>
                  <span className="block text-xs text-stone-500">
                    ~{Math.max(1, Math.round(c.article.split(/\s+/).length / 220))} min · how it works, trade-offs, history, and what the chat said
                  </span>
                </span>
              </button>
            )}
            {trace && (trace.downstream.size > 0 || trace.upstream.size > 0) && (
              <div className="mt-5 rounded-lg bg-stone-50 p-3">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Traced through the influences</h3>
                <Effects title={`What ${c.title} does`} effects={trace.downstream} byId={byId} onOpen={open} down />
                <Effects title={`What drives ${c.title}`} effects={trace.upstream} byId={byId} onOpen={open} />
              </div>
            )}
            <RelList title="Links to" rels={out} dir="out" />
            <RelList title="Linked from" rels={inc} dir="in" />
          </>
        )}
      </div>
    </aside>
  );
}

const effectColor = { raises: "text-red-600", lowers: "text-emerald-700", mixed: "text-amber-700" };

// Net sign along every path: "statins → LDL cholesterol: lowers, via 2 paths".
function Effects({ title, effects, byId, onOpen, down }: {
  title: string;
  effects: Map<string, NetEffect>;
  byId: Map<string, { id: string; title: string }>;
  onOpen: (id?: string) => void;
  down?: boolean;
}) {
  if (!effects.size) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-xs font-medium text-stone-500">{title}</div>
      <ul className="space-y-0.5 text-sm">
        {[...effects].map(([id, e]) => (
          <li key={id} className="flex flex-wrap items-baseline gap-x-1.5">
            {down && <span className={`text-xs font-semibold ${effectColor[e.sign]}`}>{e.sign}</span>}
            <button className="text-left font-medium underline decoration-stone-300 underline-offset-2 hover:decoration-stone-900" onClick={() => onOpen(id)}>
              {byId.get(id)?.title}
            </button>
            {!down && <span className={`text-xs font-semibold ${effectColor[e.sign]}`}>{e.sign === "mixed" ? "mixed" : `${e.sign} it`}</span>}
            {e.paths > 1 && <span className="text-xs text-stone-400">via {e.paths} paths</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

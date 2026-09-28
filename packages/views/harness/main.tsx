// Dev harness: renders the compute sample's canvas Views from the fixture,
// with their layout metrics. `pnpm --filter @umbel/views dev`.
// URL: #<viewId>[/<conceptId>]; `?instant` skips the layout tween (screenshots).
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../src/canvas/canvas.css";
import "./harness.css";
import { ViewCanvas, formatLayoutMetrics, isCanvasView, layoutMetrics, type CanvasView, type LayoutMetrics } from "../src/index.ts";
import { compute, computeRiskView } from "../fixtures/index.ts";

const views: CanvasView[] = [...compute.views, computeRiskView].filter(isCanvasView);
const instant = new URLSearchParams(location.search).has("instant");

function readHash() {
  const [v, c] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { v: views.find((x) => x.id === v)?.id ?? views[0].id, c: c || undefined };
}

function Harness() {
  const [state, setState] = useState(readHash);
  const [settled, setSettled] = useState(false);
  const view = views.find((v) => v.id === state.v)!;
  const [metrics, setMetrics] = useState<LayoutMetrics>();

  useEffect(() => {
    const onHash = () => setState(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    history.replaceState(null, "", `${location.search}#${[state.v, state.c ?? ""].join("/")}`);
  }, [state]);
  useEffect(() => {
    let live = true;
    layoutMetrics(compute, view).then((m) => live && setMetrics(m));
    return () => {
      live = false;
    };
  }, [view]);

  const pick = (v: string) => {
    setSettled(false);
    setState({ v, c: undefined });
  };
  const select = useMemo(() => (c?: string) => setState((s) => ({ ...s, c })), []);

  return (
    <div className="harness">
      <header className="harness__bar">
        <strong>{compute.title}</strong>
        <nav>
          {views.map((v) => (
            <button key={v.id} aria-pressed={v.id === view.id} onClick={() => pick(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
      </header>
      <p className="harness__meta">
        {view.description}
        <br />
        <code data-testid="metrics">{metrics ? formatLayoutMetrics(metrics) : "measuring…"}</code>
      </p>
      <main className="harness__canvas" data-settled={settled || undefined}>
        <ViewCanvas
          key={view.viewType === "learning-path" ? "lp" : "canvas"}
          expedition={compute}
          view={view}
          selected={state.c}
          onSelect={select}
          transitionMs={instant ? 0 : undefined}
          onSettled={() => setSettled(true)}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

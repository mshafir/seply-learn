import { useMemo } from "react";
import type { CanvasView, Expedition } from "../model.ts";
import type { ReaderInteraction } from "../ExpeditionView.tsx";
import { scopeFor } from "../scope.ts";
import { Canvas, type PositionMemory } from "./Canvas.tsx";
import { LearningPathCanvas } from "./LearningPathCanvas.tsx";

export type ViewCanvasProps = {
  expedition: Expedition;
  view: CanvasView;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
  transitionMs?: number;
  onSettled?: () => void;
  memory?: PositionMemory;
} & ReaderInteraction;

/** Any canvas View (Evidence, Cause & Effect, Lineage, Learning path), scoped from its settings. */
export function ViewCanvas(props: ViewCanvasProps) {
  const { expedition, view } = props;
  const scope = useMemo(() => scopeFor(expedition, view), [expedition, view]);
  if (view.viewType === "learning-path") return <LearningPathCanvas {...props} view={view} />;
  return <Canvas {...props} scope={scope} />;
}

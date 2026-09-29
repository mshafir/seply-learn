// Test helper: every Learning path state a reader reaches by one click (plus
// "Show all steps"), laid out as the canvas does, with the Concept cards
// drawn over each other in each. Dimmed Concepts (not on the focused path)
// count too.
import { layout } from "../src/layouts.ts";
import { overlappingConcepts } from "../src/metrics.ts";
import { focusTree, learningPathOverlay } from "../src/overlay.ts";
import { learningMap, topicRoots } from "../src/scope.ts";
import type { Expedition, LearningPathSettings } from "../src/model.ts";

export async function learningPathOverlaps(e: Expedition) {
  const view = e.views.find((v) => v.viewType === "learning-path")!;
  const s = view.settings as LearningPathSettings;
  const map = learningMap(e, s);
  const topics = topicRoots(e);
  const title = new Map(e.concepts.map((c) => [c.id, c.title]));
  const states: { selected?: string; focus?: string; showAll?: boolean }[] = [
    {},
    { showAll: true },
    ...map.scope.concepts.map((c) => ({ selected: c.id, focus: map.targets.has(c.id) ? c.id : undefined })),
  ];
  const found: string[] = [];
  for (const st of states) {
    const tree = focusTree(e, s, st.focus, new Set());
    const ov = learningPathOverlay(map, tree, { ...st, known: new Set(), showAll: !!st.showAll });
    const { positions } = await layout(map.scope, view, { hidden: ov.hidden, bridges: ov.bridges, topics });
    const shown = map.scope.concepts.map((c) => c.id).filter((id) => !ov.hidden.has(id));
    for (const [a, b] of overlappingConcepts(map.scope, positions, shown))
      found.push(`${st.selected ? title.get(st.selected) : "-"}: ${title.get(a)} × ${title.get(b)}`);
  }
  return { states: states.length, found };
}

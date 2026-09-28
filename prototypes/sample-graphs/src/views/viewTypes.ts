// View Type definitions are the markdown docs in docs/view-types/, bundled
// at build time: the prototype shows the same instructions curators read.
import type { ViewTypeId } from "../lib/types";

const docs = import.meta.glob<string>("../../../../docs/view-types/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export type ViewTypeDoc = { id: string; name: string; answers: string; status: string; body: string };

function parse(raw: string): ViewTypeDoc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1");
  }
  return { id: meta.id, name: meta.name, answers: meta.answers, status: meta.status, body: (m?.[2] ?? raw).trim() };
}

export const viewTypes = new Map(
  Object.values(docs)
    .map(parse)
    .filter((d) => d.id)
    .map((d) => [d.id as ViewTypeId, d]),
);

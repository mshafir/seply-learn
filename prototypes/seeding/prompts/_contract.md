# Output contract (shared by every stage)

These prompts are drafts of `packages/ai/prompts/`. In the product each stage runs with AI SDK 7 `Output.object` against Zod schemas; here a Claude subagent follows the same prompt and writes JSON by hand. Vocabulary is [`CONTEXT.md`](../../../CONTEXT.md): Expedition, Source, Concept, Concept Kind, Attribute, Relationship, Relationship Type, View, View Type, Tag.

## Provenance

Every Concept and Relationship carries `prov`: a list of `{ "source": "<source id>", "segment": "<segment id>", "quote": "<≤ 20 words, optional>" }`. Segment ids come from `segments.json` (`t14` = chat turn 14, `s3` = document section 3). An empty list means **background knowledge** (you added it from your own knowledge, not from a Source). Never invent segment ids. "Background" counts in stats refer to Concepts only.

## Built-in Concept Kinds

`idea` (default), `topic` (a grouping hub: "Compute economics", "Treatments"), `question` (a question the reader is trying to answer or decide: "Which printer should we buy?"; the answer goes in its summary), `goal` (something the reader wants to achieve), `person`, `place`, `thing`, `claim`, `evidence`, `criterion`, `decision`, `action`, `event`, `source` (a paper, book, dataset or site cited), `measurement`, `risk`. Add a custom Kind only when none fits; give it `{id, label, color}` where `color` is a palette name: blue, teal, green, amber, orange, red, pink, violet, indigo, slate, brown, olive.

## Built-in Relationship Types (read `from <label> to`)

| id | label | inverse |
|---|---|---|
| `part-of` | is part of | has part |
| `prerequisite` | is needed to understand | needs |
| `example` | is an example of | has example |
| `led-to` | led to | came from |
| `uses` | uses | is used by |
| `modifies` | changes | is changed by |
| `raises` | raises | is raised by |
| `lowers` | lowers | is lowered by |
| `causes` | causes | is caused by |
| `supports` | supports | is supported by |
| `challenges` | challenges | is challenged by |
| `corrects` | corrects | is corrected by |
| `alternative-to` | is an alternative to | is an alternative to |
| `meets` / `partly-meets` / `fails` | meets / partly meets / fails (option → criterion) | … |
| `located-in` | is in | contains |
| `reported-by` | is reported by | reports |

Add a custom type only when none fits: `{id, label, inverseLabel, color}`.

## Concept

```json
{
  "id": "c-kebab-title",
  "title": "Mixture of experts",
  "aliases": ["MoE"],
  "kind": "idea",
  "tags": ["architecture"],
  "summary": "One line: what it is.",
  "date": "2017", "dateEnd": "ongoing", "dateApprox": false, "lane": "models",
  "geo": [lat, lon],
  "attributes": { "attrId": "value" },
  "weight": "core",
  "prov": [{ "source": "compute-chat", "segment": "t22" }]
}
```

Only `id`, `title`, `kind`, `summary`, `prov` are required. `date` precision is its string ("1987", "2026-11", "2026-11-03"). `weight` is set only for Concepts you are confident are central (`core`) or peripheral (`aux`). Weight describes the **subject**, the same for every reader. Never pin something `aux` because this reader probably knows it already: that is their Reading status ("I knew this"), which is personal and not yours to set.

## Relationship

`{ "from": "c-a", "type": "prerequisite", "to": "c-b", "note": "optional, short", "prov": [...] }`. Unique per (from, type, to). A Relationship may point at any Concept id already in the running index; the Concept needn't be repeated.

## Attribute definition

`{ "id": "params", "label": "Parameters", "type": "text|number|money|bool|enum", "unit": "B", "values": ["low","mid","high"] }`. Types are fixed once created. A range ("$60–80") is stored as the text "60–80" (the viewer format has no range type yet). An unknown value is left out, never guessed; the View shows "?".

## View

`{ "id": "v-…", "viewType": "learning-path", "label": "…", "question": "…", "why": "…", "settings": { … } }`. Settings follow the View Type's definition in [`docs/view-types/`](../../../docs/view-types/README.md) and `prototypes/sample-graphs/src/lib/types.ts`.

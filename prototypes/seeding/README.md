# Seeding prototype

Prototype for [Seeding workflow from chats and docs](../../docs/wayfinder/mindmaps-v1/tickets/02-seeding-workflow.md): the build pipeline's prompts, run by Claude subagents instead of AI SDK code, checked against the hand-seeded sample graphs.

- `sources/`: test Sources. **Local only; never publish.** (The statins chat stays out entirely.)
- `prompts/`: stage prompts, drafts of `packages/ai/prompts/`. Start with [`_contract.md`](prompts/_contract.md).
- `runs/<source>/`: one folder per run, holding every stage's output.

## Stages (as in [Sources and the build pipeline](../../docs/wayfinder/mindmaps-v1/tickets/15-sources-and-build-pipeline.md))

| # | Stage | Here | Output |
|---|---|---|---|
| 1 | Segment | `segment.py sources/<name>.md` | `runs/<name>/segments.json` |
| 2a | Skim → propose Views | subagent + [`skim.md`](prompts/skim.md) | `skim.json` |
| 2b | Extract per chunk | subagents + [`extract.md`](prompts/extract.md), ~40k-character chunks | `chunks/<n>.json` |
| 2c | Merge | subagent + [`merge.md`](prompts/merge.md) | `merged.json` |
| 3 | Build each chosen View | subagents + [`build-view.md`](prompts/build-view.md) | `views/<id>.json` |
| 4 | Write | subagents + [`write.md`](prompts/write.md) | `written/<batch>.json` |
| – | Evaluate | `eval.py runs/<name>/merged.json <baseline.json>` | recall report |
| – | Assemble for the viewer | `assemble.py runs/<name>` | `../sample-graphs/src/graphs/gen-<name>.json` |

In this prototype the chunks run one after another, so each can see the running Concept index. In the product they run in parallel, and the merge does all the de-duplication.

Done when core recall ≥ 80% against the baseline, and the user has reviewed one generated Expedition in the viewer. At most two tuning passes.

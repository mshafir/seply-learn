# Sample graphs (static prototype)

Static viewer with four graphs baked in, hand-seeded from Claude chats. It renders the View Types
documented in [docs/view-types/](../../docs/view-types/README.md):
- **Proven:** Comparison Table, Outline, Evidence and Cause & Effect (React Flow), Timeline (vis-timeline), Map (MapLibre, with OpenFreeMap tiles loaded online).
- **Experimental:** Anatomy, Learning path, Lineage, Maturity ladder, Quadrant, Misconceptions, Rates & estimates.

```sh
mise exec -- pnpm install
mise exec -- pnpm build        # → dist/index.html (single file, opens from disk)
python3 seeds/compute.py       # regenerate a graph's JSON from its seed script (run from seeds/)
```

Findings: [docs/wayfinder/mindmaps-v1/prototypes/sample-graphs.md](../../docs/wayfinder/mindmaps-v1/prototypes/sample-graphs.md).
The statins graph contains personal health numbers — keep it local.

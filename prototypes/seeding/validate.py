#!/usr/bin/env python3
"""Check an assembled Expedition for the problems reviews have caught so far.

Usage: validate.py ../sample-graphs/src/graphs/<name>.json

These are the guardrails a curator agent's tools would enforce in the product.
It prints problems (must fix) and warnings (look at them).
"""
import json
import subprocess
import sys
from pathlib import Path
from collections import Counter, defaultdict

g = json.load(open(sys.argv[1]))
C = {c["id"]: c for c in g["concepts"]}
R = g["relationships"]
attrs = {a["id"]: a for a in g.get("attributes", [])}
problems, warnings = [], []

for r in R:
    if r["from"] not in C or r["to"] not in C:
        problems.append(f"dangling Relationship {r['from']} -{r['type']}-> {r['to']}")
deg = Counter()
parents = defaultdict(list)
for r in R:
    deg[r["from"]] += 1
    deg[r["to"]] += 1
    if r["type"] == "part-of":
        parents[r["from"]].append(r["to"])
for c in C.values():
    if deg[c["id"]] == 0:
        warnings.append(f"orphan: {c['title']}")
    if len(parents[c["id"]]) > 1:
        warnings.append(f"{c['title']} has {len(parents[c['id']])} part-of parents")


def matches(c, f):
    if not f:
        return True
    if f.get("kinds") and c["kind"] not in f["kinds"]:
        return False
    if f.get("tags") and not set(f["tags"]) <= set(c.get("tags", [])):
        return False
    if f.get("hasAttribute") and f["hasAttribute"] not in c.get("attributes", {}):
        return False
    return True


for v in g["views"]:
    s, name = v["settings"], f"View '{v['label']}'"
    if v["viewType"] == "comparison-table":
        rows = [c for c in C.values() if matches(c, s["rows"])]
        ids = {c["id"] for c in rows}
        if len(rows) < 3:
            problems.append(f"{name}: only {len(rows)} rows")
        for col in s["columns"]:
            if "attribute" in col:
                n = sum(1 for c in rows if col["attribute"] in c.get("attributes", {}))
                label = attrs.get(col["attribute"], {}).get("label", col["attribute"])
            elif "concept" in col:
                n = len({r["from"] for r in R if r["to"] == col["concept"] and r["from"] in ids})
                crit = C.get(col["concept"])
                label = crit["title"] if crit else col["concept"]
                if crit and crit["kind"] == "criterion" and s.get("priority") and s["priority"] not in crit.get("attributes", {}):
                    problems.append(f"{name}: criterion column '{label}' has no priority")
            else:
                continue
            if rows and n / len(rows) < 0.7:
                warnings.append(f"{name}: column '{label}' filled {n}/{len(rows)}")
        if s.get("standing"):
            chosen = [c["title"] for c in rows if c.get("attributes", {}).get(s["standing"]) == "chosen"]
            if chosen:
                warnings.append(f"{name}: chosen = {chosen} (check each is the reader's decision)")
    if v["viewType"] == "cause-and-effect":
        outs = s.get("outcomes", [])
        for o in outs:
            if o not in C:
                problems.append(f"{name}: outcome {o} missing")
        levers = {c["id"] for c in C.values() if matches(c, s.get("levers"))}
        types = set(s.get("positive", [])) | set(s.get("negative", []))
        ll = [(C[r["from"]]["title"], C[r["to"]]["title"]) for r in R if r["type"] in types and r["from"] in levers and r["to"] in levers]
        if ll:
            problems.append(f"{name}: lever→lever links {ll[:5]}")
        into = sum(1 for r in R if r["to"] in outs and r["type"] in types)
        warnings.append(f"{name}: outcome {[C[o]['title'] for o in outs if o in C]}, {len(levers)} levers, {into} arrows into the outcome")

print(f"{len(C)} Concepts, {len(R)} Relationships, {len(g['views'])} Views")
print(f"{len(problems)} problems")
for p in problems:
    print("  PROBLEM", p)
print(f"{len(warnings)} warnings")
for w in warnings[:40]:
    print("  warn", w)

# Layout: run the viewer's own layout code and report how each graph View reads.
viewer = Path(__file__).resolve().parent.parent / "sample-graphs"
try:
    subprocess.run(["npx", "vite", "build", "--ssr", "scripts/layout-metrics.ts", "--outDir", ".metrics"],
                   cwd=viewer, capture_output=True, check=True)
    out = subprocess.run(["node", ".metrics/layout-metrics.js", str(Path(sys.argv[1]).resolve())],
                         cwd=viewer, capture_output=True, text=True, check=True).stdout
    print("layout:")
    for line in out.strip().splitlines():
        print("  " + ("PROBLEM " if line.endswith("cluttered") else "") + line)
    print("  (cluttered = crossings over 20% of edges, or over 10% of edges drawn through other nodes; fix it by")
    print("   reshaping structure: fewer cross-topic prerequisites, one parent each, levers aimed at one stage)")
except Exception as e:  # noqa: BLE001
    print("layout: could not run layout metrics:", e)

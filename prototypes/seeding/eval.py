#!/usr/bin/env python3
"""Compare a generated Expedition with its hand-seeded baseline.

Usage: eval.py runs/<name>/merged.json [../sample-graphs/src/graphs/<baseline>.json]

Reports: recall of the baseline's core Concepts (pinned core, plus the 40
best-connected), overall recall, likely duplicates, orphans, Relationships per
Concept, and how much is background knowledge. Target: core recall >= 80%.
"""
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

STOP = {"the", "a", "an", "of", "and", "for", "in", "on", "to", "is", "vs", "with"}


def norm(s):
    s = re.sub(r"\(.*?\)", " ", s.lower())
    return " ".join(w for w in re.findall(r"[a-z0-9]+", s) if w not in STOP)


def names(c):
    return {norm(c["title"])} | {norm(a) for a in c.get("aliases", [])}


def similar(a, b):
    if a & b:
        return True
    for x in a:
        for y in b:
            if not x or not y:
                continue
            if SequenceMatcher(None, x, y).ratio() >= 0.82:
                return True
            wx, wy = set(x.split()), set(y.split())
            if min(len(wx), len(wy)) >= 2 and len(wx & wy) / min(len(wx), len(wy)) >= 0.8:
                return True
    return False


def stats(g):
    cs, rs = g["concepts"], g["relationships"]
    ids = {c["id"] for c in cs}
    deg = Counter()
    for r in rs:
        deg[r["from"]] += 1
        deg[r["to"]] += 1
    orphans = [c["title"] for c in cs if deg[c["id"]] == 0]
    bg = sum(1 for c in cs if "prov" in c and not c["prov"])
    dangling = sum(1 for r in rs if r["from"] not in ids or r["to"] not in ids)
    return deg, orphans, bg, dangling


def main():
    gen = json.loads(Path(sys.argv[1]).read_text())
    gc = gen["concepts"]
    gdeg, orphans, bg, dangling = stats(gen)
    print(f"generated: {len(gc)} Concepts, {len(gen['relationships'])} Relationships "
          f"({len(gen['relationships']) / max(len(gc), 1):.2f} per Concept), "
          f"{sum(1 for c in gc if c.get('weight') == 'core')} core, {bg} background, "
          f"{len(orphans)} orphans, {dangling} dangling Relationships")
    kinds = Counter(c["kind"] for c in gc)
    print("kinds:", ", ".join(f"{k} {n}" for k, n in kinds.most_common()))
    print("relationship types:", ", ".join(f"{k} {n}" for k, n in Counter(r["type"] for r in gen["relationships"]).most_common()))

    dups = []
    for i, a in enumerate(gc):
        for b in gc[i + 1:]:
            if similar(names(a), names(b)):
                dups.append((a["title"], b["title"]))
    print(f"likely duplicates: {len(dups)}")
    for a, b in dups[:15]:
        print(f"  {a!r} ~ {b!r}")

    if len(sys.argv) < 3:
        return
    base = json.loads(Path(sys.argv[2]).read_text())
    bdeg, _, _, _ = stats(base)
    bc = base["concepts"]
    top = {c["id"] for c in sorted(bc, key=lambda c: -bdeg[c["id"]])[:40]}
    core = [c for c in bc if c.get("weight") == "core" or c["id"] in top]
    gnames = [names(c) for c in gc]

    def found(c):
        n = names(c)
        return any(similar(n, g) for g in gnames)

    missed = [c["title"] for c in core if not found(c)]
    all_found = sum(1 for c in bc if found(c))
    rc = 1 - len(missed) / len(core)
    print(f"\nbaseline: {len(bc)} Concepts, {len(base['relationships'])} Relationships")
    print(f"core recall: {rc:.0%} ({len(core) - len(missed)}/{len(core)})  {'PASS' if rc >= 0.8 else 'below target (80%)'}")
    print(f"overall recall: {all_found / len(bc):.0%} ({all_found}/{len(bc)})")
    if missed:
        print("missed core:", "; ".join(missed))


if __name__ == "__main__":
    main()

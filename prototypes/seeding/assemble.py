#!/usr/bin/env python3
"""Assemble a run into the sample-graph format so the prototype viewer shows it.

Usage: assemble.py runs/<name> [output-name]   (reads skim.json, merged.json, views/*.json, written/*.json)
Writes ../sample-graphs/src/graphs/gen-<name>.json. Runs whose Source is private
(e.g. statins) must not be assembled into anything that gets published.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
PALETTE = {"blue": "#2563eb", "teal": "#0f766e", "green": "#059669", "amber": "#d97706", "orange": "#ea580c",
           "red": "#dc2626", "pink": "#db2777", "violet": "#7c3aed", "indigo": "#4f46e5", "slate": "#475569",
           "brown": "#92400e", "olive": "#65a30d"}
KINDS = {"idea": ("Idea", "blue"), "topic": ("Topic", "slate"), "question": ("Question", "violet"), "goal": ("Goal", "green"), "topic": ("Topic", "slate"), "question": ("Question", "violet"), "goal": ("Goal", "green"), "person": ("Person", "pink"), "place": ("Place", "green"), "thing": ("Thing", "orange"),
         "claim": ("Claim", "indigo"), "evidence": ("Evidence", "teal"), "criterion": ("Criterion", "slate"),
         "decision": ("Decision", "violet"), "action": ("Action", "olive"), "event": ("Event", "amber"),
         "source": ("Source", "brown"), "measurement": ("Measurement", "teal"), "risk": ("Risk", "red")}
TYPES = {"part-of": ("is part of", "violet", True), "prerequisite": ("is needed to understand", "blue", False),
         "example": ("is an example of", "teal", True), "led-to": ("led to", "amber", False), "uses": ("uses", "slate", False),
         "modifies": ("changes", "orange", False), "raises": ("raises", "red", False), "lowers": ("lowers", "green", False),
         "causes": ("causes", "red", False), "supports": ("supports", "green", False), "challenges": ("challenges", "red", True),
         "corrects": ("corrects", "amber", True), "alternative-to": ("is an alternative to", "slate", True),
         "meets": ("meets", "green", False), "partly-meets": ("partly meets", "amber", True), "fails": ("fails", "red", True),
         "located-in": ("is in", "green", True), "reported-by": ("is reported by", "brown", True)}


def load(p):
    return json.loads(p.read_text()) if p.exists() else None


def main():
    run = Path(sys.argv[1])
    skim, merged = load(run / "skim.json"), load(run / "merged.json")
    concepts = {c["id"]: c for c in merged["concepts"]}
    rels = {(r["from"], r["type"], r["to"]): r for r in merged["relationships"]}
    attrs = {a["id"]: a for a in merged.get("attributes", [])}
    views = []
    for vp in sorted((run / "views").glob("*.json")):
        v = load(vp)
        if "failed" in v:
            print(f"{vp.stem}: failed: {v['failed']}")
            continue
        for c in v.get("added", {}).get("concepts", []):
            concepts[c["id"]] = c
        for r in v.get("removedRelationships", []):
            rels.pop((r["from"], r["type"], r["to"]), None)
        for r in v.get("removedRelationships", []):
            rels.pop((r["from"], r["type"], r["to"]), None)
        for r in v.get("added", {}).get("relationships", []):
            rels[(r["from"], r["type"], r["to"])] = r
        for a in v.get("added", {}).get("attributes", []):
            attrs[a["id"]] = a
        for u in v.get("updated", []):
            c = concepts.get(u["concept"])
            if c:
                s = dict(u["set"])
                if "attributes" in s:
                    c["attributes"] = {**c.get("attributes", {}), **s.pop("attributes")}
                c.update(s)
        view = v["view"]
        views.append({"id": view["id"], "label": view["label"], "description": view.get("question", ""),
                      "viewType": view["viewType"], "settings": view["settings"]})
    for wp in sorted((run / "written").glob("*.json")):
        for w in load(wp):
            c = concepts.get(w["id"])
            if c:
                c["summary"] = w.get("summary", c.get("summary"))
                c["overview"] = w.get("overview")
                if w.get("article"):
                    c["article"] = "\n\n".join(f"## {s['heading']}\n\n{s['md']}" for s in w["article"])
    used_kinds = {c["kind"] for c in concepts.values()}
    kinds = [{"id": k, "label": KINDS[k][0], "color": PALETTE[KINDS[k][1]], "icon": k} for k in KINDS if k in used_kinds]
    for ck in merged.get("customKinds", []):
        kinds.append({"id": ck["id"], "label": ck["label"], "color": PALETTE.get(ck.get("color"), "#475569")})
    used_types = {r["type"] for r in rels.values()}
    rtypes = [{"id": t, "label": TYPES[t][0], "color": PALETTE[TYPES[t][1]], "dashed": TYPES[t][2]} for t in TYPES if t in used_types]
    for ct in merged.get("customRelationshipTypes", []):
        rtypes.append({"id": ct["id"], "label": ct["label"], "color": PALETTE.get(ct.get("color"), "#475569"), "dashed": False})
    link = lambda md: re.sub(r"\]\((c-[a-z0-9-]+)\)", r"](#c/\1)", md) if isinstance(md, str) else md
    for c in concepts.values():
        for f in ("overview", "article"):
            c[f] = link(c.get(f))
    strip = lambda c: {k: v for k, v in c.items() if k not in ("prov", "aliases", "overviewProv")}
    tag = "agent" if len(sys.argv) > 2 and "agent" in sys.argv[2] else "generated"
    out = {"id": sys.argv[2] if len(sys.argv) > 2 else f"gen-{run.name}", "title": f"{skim['title']} ({tag})", "summary": skim["summary"],
           "source": {"kind": "claude-chat" if (run / "segments.json").exists() and load(run / "segments.json")["kind"] == "chat" else "doc"},
           "kinds": kinds, "relationshipTypes": rtypes, "attributes": list(attrs.values()),
           "concepts": [strip(c) for c in concepts.values()],
           "relationships": [{k: v for k, v in r.items() if k != "prov"} for r in rels.values()
                             if r["from"] in concepts and r["to"] in concepts],
           "views": views}
    name = sys.argv[2] if len(sys.argv) > 2 else f"gen-{run.name}"
    dest = HERE.parent / "sample-graphs" / "src" / "graphs" / f"{name}.json"
    dest.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"wrote {dest}: {len(out['concepts'])} Concepts, {len(out['relationships'])} Relationships, {len(views)} Views")


if __name__ == "__main__":
    main()

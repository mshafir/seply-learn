"""Helpers for hand-seeding sample graphs into the baked JSON format.

A seed script builds concepts/relationships/views with these helpers and
calls write(); the viewer imports src/graphs/*.json at build time.
A View is a View Type (docs/view-types/) applied to this Graph, with settings.
"""
import json, pathlib, re, textwrap

# One shared palette so Concept Kinds read the same across every graph.
KINDS = {
    "idea":        {"label": "Idea",        "color": "#2563eb", "icon": "idea"},
    "person":      {"label": "Person / org", "color": "#9333ea", "icon": "person"},
    "place":       {"label": "Place",       "color": "#0d9488", "icon": "place"},
    "thing":       {"label": "Thing",       "color": "#ea580c", "icon": "thing"},
    "claim":       {"label": "Claim",       "color": "#ca8a04", "icon": "claim"},
    "source":      {"label": "Evidence",    "color": "#4f46e5", "icon": "evidence"},
    "question":    {"label": "Open question", "color": "#db2777", "icon": "question"},
    "decision":    {"label": "Decision",    "color": "#dc2626", "icon": "decision"},
    "criterion":   {"label": "Criterion",   "color": "#16a34a", "icon": "criterion"},
    "action":      {"label": "Action",      "color": "#0891b2", "icon": "action"},
    "event":       {"label": "Event",       "color": "#64748b", "icon": "event"},
    "measurement": {"label": "Measurement", "color": "#059669", "icon": "measurement"},
    "risk":        {"label": "Risk",        "color": "#b91c1c", "icon": "risk"},
    "goal":        {"label": "Goal",        "color": "#7c3aed", "icon": "goal"},
    "outcome":     {"label": "Outcome",     "color": "#15803d", "icon": "outcome"},
}


class G:
    def __init__(self, id, title, summary, source):
        self.d = dict(id=id, title=title, summary=summary, source=source,
                      kinds=[], relationshipTypes=[], attributes=[],
                      concepts=[], relationships=[], views=[])
        self.ids = set()

    def rel_type(self, id, label, color, dashed=False):
        self.d["relationshipTypes"].append(dict(id=id, label=label, color=color, dashed=dashed))

    def attr(self, id, label, type="text", unit=None, values=None):
        a = dict(id=id, label=label, type=type)
        if unit: a["unit"] = unit
        if values: a["values"] = values
        self.d["attributes"].append(a)

    def concept(self, id):
        return next(c for c in self.d["concepts"] if c["id"] == id)

    def patch(self, id, **fields):
        """Set Concept fields after the fact (dates, lanes, sibling order)."""
        c = self.concept(id)
        for k, v in fields.items():
            if v is None: c.pop(k, None)
            else: c[k] = v

    def set_attr(self, id, key, value):
        self.concept(id).setdefault("attributes", {})[key] = value

    def rels(self, type=None, frm=None, to=None):
        return [r for r in self.d["relationships"]
                if (type is None or r["type"] == type) and (frm is None or r["from"] == frm) and (to is None or r["to"] == to)]

    def outline_order(self, *ids):
        """Explicit sibling order for the Outline: position within each list."""
        for i, id in enumerate(ids):
            self.patch(id, seq=i)

    def c(self, id, title, kind, tags=(), summary=None, body=None, **kw):
        assert id not in self.ids, id
        self.ids.add(id)
        o = dict(id=id, title=title, kind=kind, tags=list(tags))
        if summary: o["summary"] = summary
        if body: o["body"] = textwrap.dedent(body).strip()
        o.update({k: v for k, v in kw.items() if v is not None})
        self.d["concepts"].append(o)

    def r(self, frm, to, type, note=None):
        o = dict(**{"from": frm}, to=to, type=type)
        if note: o["note"] = note
        self.d["relationships"].append(o)

    def view(self, id, label, view_type, description=None, **settings):
        o = dict(id=id, label=label, viewType=view_type)
        if description: o["description"] = description
        o["settings"] = {k: v for k, v in settings.items() if v is not None}
        self.d["views"].append(o)

    def write(self):
        types = {t["id"] for t in self.d["relationshipTypes"]}
        for r in self.d["relationships"]:
            assert r["from"] in self.ids, ("missing from", r)
            assert r["to"] in self.ids, ("missing to", r)
            assert r["type"] in types, ("bad type", r)
        for c in self.d["concepts"]:
            for k in ("date", "dateEnd"):
                v = c.get(k)
                assert v is None or v == "ongoing" or re.fullmatch(r"\d{4}(-\d\d(-\d\d)?)?", v), (c["id"], k, v)
        used = sorted({c["kind"] for c in self.d["concepts"]}, key=list(KINDS).index)
        self.d["kinds"] = [dict(id=k, **KINDS[k]) for k in used]
        out = pathlib.Path(__file__).parent.parent / "src" / "graphs" / f"{self.d['id']}.json"
        out.write_text(json.dumps(self.d, indent=1, ensure_ascii=False))
        print(f"wrote {out.name}: {len(self.d['concepts'])} concepts, {len(self.d['relationships'])} relationships, {len(self.d['views'])} views")

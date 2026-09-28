#!/usr/bin/env python3
"""Turn work-packages.md into GitHub Issues (one per work package).

Usage: make_issues.py            # dry run: print what would be created
       make_issues.py --create   # create labels, milestones and issues with `gh`

Idempotent by title: a work package whose "WP-x.y:" title already exists as an
issue is skipped. Dependencies are written into the body as a checklist, and
resolved to issue links when the dependency's issue already exists.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

create = "--create" in sys.argv
text = (Path(__file__).parent / "work-packages.md").read_text()
wps = []
for block in re.split(r"^### ", text, flags=re.M)[1:]:
    head, _, body = block.partition("\n")
    m = re.match(r"(WP-[\w.]+): (.+)", head.strip())
    if not m:
        continue
    field = lambda k: (re.search(rf"^- {k}: (.+)$", body, re.M) or [None, ""])[1].strip()
    wps.append({"id": m[1], "title": f"{m[1]}: {m[2]}", "lane": field("lane"), "milestone": field("milestone"),
                "depends": [d.strip() for d in field("depends").split(",") if d.strip()], "spec": field("spec"),
                "body": body.strip()})

def gh(*args):
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout

existing = {}
if create:
    for i in json.loads(gh("issue", "list", "--state", "all", "--limit", "500", "--json", "number,title")):
        existing[i["title"].split(":")[0]] = i["number"]
    for lane in sorted({w["lane"] for w in wps}):
        subprocess.run(["gh", "label", "create", f"lane:{lane}", "--force"], capture_output=True)
    for ms in sorted({w["milestone"] for w in wps}):
        subprocess.run(["gh", "api", "repos/{owner}/{repo}/milestones", "-f", f"title={ms}"], capture_output=True)

for w in wps:
    deps = "\n".join(f"- [ ] {('#' + str(existing[d])) if d in existing else d}" for d in w["depends"])
    body = f"Spec: docs/spec/v1/{w['spec']}\n\n**Depends on**\n{deps or '- none'}\n\n{w['body']}\n\n_Generated from docs/plan/v1/work-packages.md; edit the plan, not this issue._"
    if not create:
        print(f"[{w['milestone']} · lane {w['lane']}] {w['title']}  (depends: {', '.join(w['depends']) or '-'})")
        continue
    if w["id"] in existing:
        print("skip (exists):", w["title"])
        continue
    url = gh("issue", "create", "--title", w["title"], "--body", body, "--label", f"lane:{w['lane']}", "--milestone", w["milestone"]).strip()
    existing[w["id"]] = int(url.rsplit("/", 1)[1])
    print("created:", url)
print(f"{len(wps)} work packages")

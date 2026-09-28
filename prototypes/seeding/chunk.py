#!/usr/bin/env python3
"""Group segments into ~40k-character chunks as readable text files.

Usage: chunk.py runs/<name>  ->  runs/<name>/chunks/<n>.txt
"""
import json
import sys
from pathlib import Path

MAX = 40000
run = Path(sys.argv[1])
doc = json.loads((run / "segments.json").read_text())
out = run / "chunks"
out.mkdir(exist_ok=True)
chunks, cur, size = [], [], 0
for s in doc["segments"]:
    if cur and size + len(s["text"]) > MAX:
        chunks.append(cur)
        cur, size = [], 0
    cur.append(s)
    size += len(s["text"])
if cur:
    chunks.append(cur)
for i, c in enumerate(chunks, 1):
    label = lambda s: f"[{doc['source']} {s['id']}" + (f" {s['speaker']}]" if "speaker" in s else f" — {s['heading']}]")
    (out / f"{i}.txt").write_text("\n\n".join(f"{label(s)}\n{s['text']}" for s in c))
print(f"{doc['source']}: {len(chunks)} chunks -> {out}")

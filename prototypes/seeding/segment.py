#!/usr/bin/env python3
"""Stage 1: split a Source into addressable segments (no LLM).

Chats (exports with "## User" / "## Claude" headings) become turns: t1, t2, ...
Documents become sections at each heading: s1, s2, ... (long sections are
split into parts s3a, s3b, ... so no segment runs past ~6k characters).

Usage: segment.py sources/<name>.md  ->  runs/<name>/segments.json
"""
import json
import re
import sys
from pathlib import Path

MAX = 6000
SPEAKERS = {"user": "user", "human": "user", "claude": "assistant", "assistant": "assistant", "chatgpt": "assistant", "gemini": "assistant"}


def split_long(seg):
    if len(seg["text"]) <= MAX:
        return [seg]
    paras, parts, cur = seg["text"].split("\n\n"), [], ""
    for p in paras:
        if cur and len(cur) + len(p) > MAX:
            parts.append(cur)
            cur = ""
        cur += p + "\n\n"
    if cur.strip():
        parts.append(cur)
    return [{**seg, "id": f"{seg['id']}{chr(97 + i)}", "text": t.strip()} for i, t in enumerate(parts)]


def segment(text):
    heads = list(re.finditer(r"^## (\w+)\s*$", text, re.M))
    is_chat = len(heads) >= 2 and all(h.group(1).lower() in SPEAKERS for h in heads)
    segs = []
    if is_chat:
        for i, h in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            body = text[h.end():end].strip().strip("-").strip()
            segs += split_long({"id": f"t{i + 1}", "speaker": SPEAKERS[h.group(1).lower()], "text": body})
        return "chat", segs
    parts = re.split(r"^(#{1,4} .+)$", text, flags=re.M)
    heading, n = "(start)", 0
    for chunk in parts:
        if re.match(r"^#{1,4} ", chunk):
            heading = chunk.lstrip("#").strip()
            continue
        if chunk.strip():
            n += 1
            segs += split_long({"id": f"s{n}", "heading": heading, "text": chunk.strip()})
    return "document", segs


def main():
    src = Path(sys.argv[1])
    kind, segs = segment(src.read_text())
    out = Path(__file__).parent / "runs" / src.stem
    out.mkdir(parents=True, exist_ok=True)
    doc = {"source": src.stem, "kind": kind, "chars": sum(len(s["text"]) for s in segs), "segments": segs}
    (out / "segments.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f"{src.stem}: {kind}, {len(segs)} segments, {doc['chars']:,} chars -> {out / 'segments.json'}")


if __name__ == "__main__":
    main()

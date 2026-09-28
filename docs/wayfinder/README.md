# Wayfinder: local-markdown tracker

This repo tracks wayfinding maps as markdown files instead of issues.

## Layout

```
docs/wayfinder/<map-slug>/
  map.md                 # the map (label: wayfinder:map)
  tickets/NN-<slug>.md   # child tickets; the NN prefix is the ticket id
  research/<slug>.md     # findings written by research tickets
```

## Ticket frontmatter

```yaml
---
id: 03
title: <the ticket's name, used everywhere a human reads>
labels: [wayfinder:research]   # research | prototype | grilling | task
status: open                   # open | closed | out-of-scope
assignee:                      # set when claimed; an empty assignee means unclaimed
blocked_by: [01, 02]           # ticket ids; unblocked when all of them are closed
---
```

## Wayfinding operations

- **Frontier:** tickets with `status: open`, an empty `assignee`, and every id in `blocked_by` closed.
- **Claim:** set `assignee` before starting any work.
- **Resolve:** append a `## Resolution` section to the ticket, set `status: closed`, and add a line to the map's *Decisions so far*.
- **Out of scope:** set `status: out-of-scope` and add a line to the map's *Out of scope*.
- **Assets:** link them from the ticket; don't paste them in.
- **Blocking:** markdown has no native blocking, so the `blocked_by` frontmatter field stands in for it.

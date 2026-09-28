---
id: 18
title: Assemble the v1 spec
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: [02, 08, 09, 10, 11, 15, 16, 17, 20, 21, 22, 23, 24, 25]
---

## Question

Compose every decision on this map into one build-ready v1 spec: domain model, architecture and deployment, the screens and flows, in-app AI and the build pipeline, MCP, sharing and history, design system, and a phase-2 sketch. Anything found still undecided goes back on the map as a ticket rather than being decided in the write-up.

## Resolution (2026-09-28)

The spec is at [`docs/spec/v1/`](../../../spec/v1/README.md): an index plus 8 sections:
1. domain model
2. architecture and deployment
3. screens and flows
4. Views and View Types
5. AI
6. MCP
7. design system
8. phase 2

Every section links the tickets that hold the detail. Assumptions made while assembling are listed in the spec's README, six of them, for review before building.

- **Gaps found while assembling:** one. How invitees learn of an invite when v1 had no email. It went back on the map as [Invites and email](26-invites-and-email.md) and was decided with the user: transactional email for invites (optional SMTP when self-hosted), plus an invite link and in-app inbox.
- **Corrected against the design canvas:** Snapshots became Changes, share links became live, no link Sources, no Electron in v1.

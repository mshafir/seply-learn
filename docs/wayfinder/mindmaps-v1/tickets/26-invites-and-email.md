---
id: 26
title: Invites and email
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
---

## Question

The share dialog invites by email, but v1 had no email ("no email in v1" for build notifications). How does an invitee find out? Surfaced while assembling the v1 spec.

## Resolution (2026-09-28)

Decided with the user:
- **Invites send a transactional email in v1.** It comes from a `Mailer` interface in `packages/server`.
  - **Hosted:** a transactional provider. Resend is the assumed default; the build can pick Cloudflare's email service if it fits better.
  - **Self-host:** **optional SMTP** via env vars.
- **Always, alongside email:**
  - a copyable **invite link** ("Send them this link");
  - an in-app **inbox**: when the invitee signs in with that email, the Expedition appears under "Shared with you" with a **New** badge.

  Without a mailer configured, the link and inbox are the only path.
- **Scope of email in v1: invites only.** Build-finished notifications stay in-app + web push. Email for them is phase 2.

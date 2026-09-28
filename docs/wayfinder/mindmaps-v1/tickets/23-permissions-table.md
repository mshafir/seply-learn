---
id: 23
title: Permissions table
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
---

## Question

What exactly can an owner do versus an editor versus a viewer? Examples:
- accept Proposals
- add or hide Kinds and Relationship Types
- change a View's shared settings
- add or remove Sources
- merge or delete Concepts
- restore or undo someone else's Change
- Fork
- change Visibility
- invite
- transfer ownership
- delete (to Trash)

Also cover what an API token or MCP agent inherits, and the optional per-Expedition token restriction.

## Resolution (2026-09-28)

Grilled with the user.

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| Read; search; see Sources | ✓ | ✓ | ✓ (anyone, where Visibility allows) |
| Fork | ✓ | ✓ | ✓ (signed in) |
| Edit Concepts, Relationships, Views and their shared settings, Kinds, Relationship Types, Attributes | ✓ | ✓ | – |
| Add or remove Sources; Merge; delete Concepts | ✓ | ✓ | – |
| In-app AI (Grow, Write the article); accept or dismiss Proposals | ✓ | ✓ | – |
| View history; undo any Change; **restore to a point** | ✓ | ✓ | – |
| **Invite editors and viewers** | ✓ | ✓ | – |
| Change someone's role; remove a collaborator | ✓ | – | – |
| Change Visibility; transfer ownership; delete to Trash / restore from Trash | ✓ | – | – |

- **Invites:** editors can invite both editors and viewers, per the user. Changing an existing collaborator's role and removing people stay with the owner. That boundary wasn't asked explicitly; revisit if it chafes.
- **Restore** is an undoable Change, and history shows who did it.
- **API tokens and MCP agents** inherit their user's role on each Expedition. MCP writes are always Proposals, and create is a first build ([MCP tool surface and skills](10-mcp-tool-surface-and-skills.md)). A token can optionally be restricted to chosen Expeditions at consent.
- There is **exactly one owner**; ownership transfers only to an existing editor.

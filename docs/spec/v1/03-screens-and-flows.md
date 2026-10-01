# 3. Screens and flows

Designed on the Claude Design canvas ([App layout and page flow](../../wayfinder/mindmaps-v1/tickets/12-app-layout-and-page-flow.md)). The record, with all 24 original decisions, is [prototypes/app-flow.md](../../wayfinder/mindmaps-v1/prototypes/app-flow.md), and the saved artboards are in [`app-flow/project/`](../../wayfinder/mindmaps-v1/prototypes/app-flow/project/). The canvas still says "graph", "Mindmaps" and "Snapshot"; **this section is the corrected version.** The artboards are a design reference, not production markup. The components come from [Design system](07-design-system.md).

## 3.1 Page flow

```
Sign in ─┐                         ┌─ Shared/public link ──┐
         ▼                         ▼                       │
      Library ──New──▶ Sources ──▶ Choose Views ──▶ Expedition (building → ready)
         ▲  │                                             │   ├ side panel: Concept / View / Suggestions / History / Share
         │  └──── open / Continue reading ───────────────▶│   └ Grow (Ask, Concept actions)
         └──────────────────────────── back ──────────────┘
MCP agent ── create_expedition ──▶ new Expedition (first build) · propose_changes ──▶ Suggestions
```

## 3.2 Library (canvas 01)

- **Sections:**
  - **Continue reading:** the 3 most recent, resuming each at the reader's last position.
  - **Your Expeditions**, **Shared with you** and **Drafts:** Expeditions with Sources added but not yet built.
  - A **Tag** filter on Expedition Tags.
  - **Trash**, for owners: 30 days, restorable.
- **Cards** show:
  - the fixed **thumbnail illustration** of the best View's View Type (no per-Expedition preview is rendered)
  - the title
  - the collaborators' **avatars with a short summary**
  - Concept and View counts, and the date
  - live build status while building
- **Global search:** "Search Concepts, articles and #tags" opens a command dialog, with results grouped by Expedition, Concept and Tag, and an "Include public Expeditions" toggle.
- **New** starts the create flow. **Import** accepts our JSON and creates a new private Expedition.

## 3.3 Create: Sources (canvas 02a)

- **Start from anything, mixed and several at once:**
  - **paste an AI chat** from any assistant (the copy says "just paste in an AI chat")
  - **upload files:** chat exports from ChatGPT, Claude or Gemini, PDF, DOCX, Markdown, TXT, HTML; 25 MB each
  - **write a prompt** alone
  - optional goal chips ("learn it", "decide", "plan")

  Sources stack up in a list. **No link fetching in v1**; share links can't be read without the assistant's login, so the copy says "paste the conversation instead".

- **The prompt alone** produces background knowledge (provenance empty).
- **The cost estimate** (e.g. "~420k tokens, about $1.10") shows before continuing. It uses the reader's key, or the instance key, depending on the instance mode. Over the token cap, the reader picks which Sources or sections to include.
- **Next** runs the **skim** (≈10–20 s) and starts **extraction in the background** at the same moment.

## 3.4 Create: Choose Views (canvas 02b)

- **Proposed Views as cards:** the View Type thumbnail, the question in the reader's words, and why it was proposed ("You kept asking 'what is…'"). The 3–4 best are pre-selected.
- **Also on the page:** "Suggest more Views", "Ask for a specific View" (a free-text request), and a live "N Concepts found across M Sources" counter.
- **There is no Concept review step.** Concepts are curated inside Views afterwards.
- **"Create Expedition with N Views"** queues the chosen Views. "Save draft" keeps the Sources, the title and the chosen Views (queued, not built) for later; a draft reopens in the create flow.

## 3.5 Building (canvas 02c, 02d, 02e)

- **The Expedition opens immediately.** The Views bar shows each View's status (queued / building with a step label and progress / ready / failed).
- **Building never blocks.** The first finished View opens by itself, other Views keep building, and a toast announces each one as it finishes.
- **Skeletons per View Type,** shown while each View streams in:
  - Graph Views stream nodes into reserved slots.
  - Tables show rows first, then fill cells, with "?" for unknowns.
  - Anatomy and Outline show structure first.
  - Map frames the area, then drops pins.
  - Timeline and Rates draw the axis first.
- **Failure is per View:** a plain reason ("only one estimate per trend"), with **Retry**, **Try another View** or **Remove**. Other Views are untouched.
- **"Leave it building; we'll notify you"** leads to a web push notification when it's done.
- **After the Views finish,** overviews for every Concept, then articles for core Concepts, are written in the background. Reading can start as soon as the overviews exist.
- **Controls:** "Cancel" keeps the finished Views. Hitting the spending cap pauses the build with Continue or Stop.

## 3.6 Expedition screen (canvas 03)

- **Layout:**
  1. the **Views bar** under the header: a tab per View (its View Type's icon and its name), reorderable. Hovering or focusing a tab shows a card with the View's question, what its View Type is and its build status. Tabs that don't fit go into a "N more" menu that shows each View's icon, name and question at full length; the open View always keeps its tab.
  2. the **canvas**, as wide as possible
  3. the **side panel**, which slides open on selection and shut when closed. It is 520 px by default and widens to 760 px while the reader reads a Concept's full article, narrowing again on the way back. The reader can drag its edge to resize it, from 320 px up to whatever leaves the canvas 360 px; the reading and article widths are each kept per browser. Dragging it below 320 px closes it. A Sheet on narrow screens (under 1024 px).
- **An Expedition opens on its best View** (chosen by a curator; by default the first to finish building), or on the reader's last position.
- **There's no toolbar above the canvas.** A **floating View button** (icon, name, question, settings icon) opens the **View panel**, which has:
  - the description
  - **shared settings**: what the View includes; editors only
  - **your settings**: e.g. "Show all steps", "Hide what I've read"
  - "Duplicate" and "Read the View Type"
- **View-specific status floats on the canvas** as a chip, e.g. "Path to MLA · 7 of 11 read", with a clear button.
- **The header** holds:
  - the title
  - **presence** avatars
  - Share
  - the Suggestions count
  - History (owners and editors)
  - the account menu, with the theme toggle
- **Presence:** live cursors for collaborators, and "agent via MCP" shown as a participant.
- **Search inside the Expedition** (text or `#tag`) highlights matches on the canvas.

## 3.7 Side panel: reading and editing (canvas 04)

- **Three depths** with a back stack:
  1. summary
  2. **overview**: one deep paragraph, in Newsreader serif
  3. **article**: sections

  In-text links navigate the panel.

- **Provenance per article section** (and for the overview) is marked as either:
  - **"From the chat, turn 14"**, linking to the segment in the Source viewer
  - **"Background knowledge"**
- **Reading status:** Not read yet / Read / I knew this. Read and known Concepts show a check on the canvas in every View.
- **Also shown:** Relationships in natural language, both ways ("needs …", "is needed to understand …"), Attributes, Tags and aliases.
- **Editing in place** (editors): fields, sections, Relationships, Tags, and **Merge with…**.
  - Re-parenting asks **"Just this View"** or **"Everywhere"**.
  - Edits coalesce into Changes.
- **Actions for editors** (preset asks to the curator agent): "Add what's missing to understand this", "Add examples", "Write the article", "Suggest related".

## 3.8 Grow and Suggestions (canvas 05)

- **"Ask about this Expedition"** in the side panel, for owners and editors. The copy reads "Uses your API key", or "Uses this instance's AI" in instance-key mode.
- **As the agent works,** its items appear **dashed on the canvas** and in the **Suggestions** tab. Each new Concept comes with a summary and overview. The ask can be stopped, and a per-ask spending cap applies (default $0.50).
- **Suggestions tab:**
  - Items are grouped by ask, with its author and rationale.
  - **Accept / Dismiss per item**, or **Accept all**. Dependencies are included and shown before confirming.
  - Stale items show "changed since suggested" with both versions.
  - Each review action is one undoable Change.
- **MCP Proposals** arrive with a toast ("Claude (via MCP) suggested 2 Concepts from a coding session: Review / Later").
- **Activity:** asks and their authors. The chat itself isn't kept.

## 3.9 History and sharing (canvas 06, amended)

- **History** (owners and editors) lists **Changes** with author, label and time ("Accepted 12 suggestions · Ana · 2h ago"). Each Change has **Undo**, **View as of here** (read-only) and **Restore to here**. Undo reports any edits it kept because they changed since. _(The canvas's Snapshot list and diff are replaced by this.)_
- **Share dialog:**
  - **Invite** by email as editor or viewer. An **email** is sent when a mailer is configured, and a **copyable invite link** is always offered. The invitee finds it under "Shared with you" with a **New** badge. Editors can invite. Only the owner changes roles or removes people.
  - **Visibility:** private / unlisted / public, **owner only**. A public or unlisted link shows the **latest state**, live.
  - A plain warning: **"Anyone who can view can also see the Sources."**
  - **Fork** (anyone signed in who can view): make your own copy.
  - **Export** to JSON or a Markdown folder.
- **Library cards** show who an Expedition is shared with.

## 3.10 Account and settings

- **Theme:** System / Light / Dark.
- **AI** (bring-your-own-key mode): keys per provider (the last 4 characters, Test, Delete). The model per stage is under Advanced. There's also the per-ask spending cap.
- **Connected agents:** MCP OAuth grants, and personal API tokens, each optionally restricted to chosen Expeditions.
- **Notifications:** web push on or off.

## 3.11 Anonymous and viewer experience

- Viewing public or unlisted Expeditions needs no login, and live updates still arrive.
- Reading status and position stay in the browser until sign-in, then merge into the account.
- Viewers get no AI, no Suggestions tab and no History. They can Fork and Export.

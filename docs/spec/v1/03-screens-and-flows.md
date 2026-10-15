# 3. Screens and flows

Designed on the Claude Design canvas ([App layout and page flow](../../wayfinder/mindmaps-v1/tickets/12-app-layout-and-page-flow.md)). The record, with all 24 original decisions, is [prototypes/app-flow.md](../../wayfinder/mindmaps-v1/prototypes/app-flow.md), and the saved artboards are in [`app-flow/project/`](../../wayfinder/mindmaps-v1/prototypes/app-flow/project/). The canvas still says "graph", "Mindmaps" and "Snapshot"; **this section is the corrected version.** The artboards are a design reference, not production markup. The components come from [Design system](07-design-system.md).

## 3.1 Page flow

```
Explore ─── public Expedition (no sign-in) · Fork ──▶ Sign in ──▶ Fork offered
Sign in ─┬─ new account ──▶ Welcome: connect your agent ─┐
         ▼                                               │
         ┌───────────────────────────────────────────────┘
         │                         ┌─ Shared/public link ──┐
         ▼                         ▼                       │
      Library ──New──▶ Sources ──▶ Choose Views ──▶ Expedition (building → ready)
         ▲  │                                             │   ├ side panel: Concept / View / Suggestions / History / Share
         │  └──── open / Continue reading ───────────────▶│   └ Grow (Ask, Concept actions)
         └──────────────────────────── back ──────────────┘
MCP agent ── create_expedition ──▶ new Expedition (first build) · propose_changes ──▶ Suggestions
```

**Sign in** (`/sign-in`):

- A brand panel on the sprout green: the wordmark, "Turn questions into something you can read and come back to.", one line on what Seply Learn does, and three short points.
- Beside it, one card: **Sign in or create an account**, with **Continue with Google** (and email and password where the server offers it). Under it: "New here? Next you connect the AI agent you already use, or skip it and read first."
- Then the link **Explore public Expeditions without signing in**.
- At phone width the panel sits above the card, with only the headline and one line.
- `next`, the desktop hand-off and an MCP client's sign-in (then consent) work as before.

**Welcome** (`/welcome`): where a new account lands, once.

- The sign-in screen sends a new account there. Google does it through Better Auth's new-user callback; email sign-up goes there directly. A later sign-in goes to the Library.
- It isn't shown when `next` points somewhere specific: an invite, an Expedition, an MCP client's consent.
- "WELCOME, <first name>", **Connect your agent**, and one line on what an agent does here.
- The agent tabs and numbered steps from `/connect` ([MCP §6.4](06-mcp.md#64-connecting-an-agent)): add Seply Learn, sign in when the agent asks, ask it to make an Expedition.
- A status line ticks when the agent's first call arrives.
- **Skip for now** and **Go to my Library** both go to the Library.

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
- **No AI yet:** when the account has no AI it may use and no agent is connected, a quiet bar sits at the top.
  - It says "No AI connected yet" and "You can read, edit and import now. To build Expeditions, connect your agent or add a key."
  - Its actions: **Connect your agent** (`/connect`), **Add a key** (Settings › AI) and **Ask to use this server's AI** (the request dialog, [3.12](#312-this-servers-ai-hosted)).
  - Ask shows only in `both` mode, when the server has its own AI and it isn't on for the account. Once asked, the bar says so instead.
  - The bar goes away once a key is added or an agent connects.
- **An empty Library** also shows **Start by reading one**: up to three public Expeditions from Explore, and **See all public Expeditions** (`/explore`).

## 3.3 Create: Sources (canvas 02a)

- **Start from anything, mixed and several at once.** The tabs, in order:
  - **A question** (the default): what the reader wants to understand
  - **Paste a chat** from any assistant (the copy says "just paste in an AI chat")
  - **Files:** chat exports from ChatGPT, Claude or Gemini, PDF, DOCX, Markdown, TXT, HTML; 25 MB each
  - optional goal chips ("learn it", "decide", "plan")

  Sources stack up in a list. **No link fetching in v1**; share links can't be read without the assistant's login, so the copy says "paste the conversation instead".

- **A question alone** produces background knowledge (provenance empty).
- **The cost estimate** (e.g. "~420k tokens, about $1.10") shows before continuing. It uses the reader's key, or the instance key, depending on the instance mode. Over the token cap, the reader picks which Sources or sections to include.
- **Next** runs the **skim** (≈10–20 s) and starts **extraction in the background** at the same moment.
- **No AI to build with** (no key of the reader's, and this server's AI isn't on for them): the panel **Building needs AI. Choose how.** replaces the estimate.
  - **Ask your agent to build it:** a request to copy, built from what the reader typed: "Make a Seply Learn Expedition about: <question>". From a chat or files it is "Make a Seply Learn Expedition from this conversation.", with the tip to ask in that same chat.
  - It says whether the reader's agent is connected, with **Connect it** when not.
  - **Or build it here with your key:** **Add an API key** (Settings › AI), and a small **Ask to use this server's AI** (the same rules as the Library's bar).
  - Choose Views stays off. Sources are still saved to the draft.

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
  3. the **side panel**, which slides open on selection and shut when closed. It is 520 px by default and widens to 860 px while the reader reads a Concept's full article, narrowing again on the way back. The reader can drag its edge to resize it, from 320 px up to whatever leaves the canvas 360 px; the reading and article widths are each kept per browser. Dragging it below 320 px closes it. A Sheet on narrow screens (under 1024 px).
- **An Expedition opens on its best View** (chosen by a curator; by default the first to finish building), or on the reader's last position.
- **There's no toolbar above the canvas.** A **floating View button** (the View Type's icon, the View's name and a settings icon; the question and description are in the View panel) sits over the canvas's top-left corner. On graph Views (Evidence, Cause & Effect, Lineage, Learning path) the diagram fills the canvas under it and fits its Concepts below it, and a View's own controls float just under it (the Learning path's "To understand …" bar, shown only while a path is focused; its "Show all steps" is a personal setting in the View panel, not a canvas control); Views with headers or axes (tables, Outline, Timeline, Map, …) start below it. It opens the **View panel**, which has:
  - the description
  - **shared settings**: what the View includes; editors only
  - **your settings**: e.g. "Show all steps", "Hide what I've read"
  - "Duplicate" and "Read the View Type"
- **View-specific status floats on the canvas** as a chip, e.g. "Path to MLA · 7 of 11 read", with a clear button.
- **The header** holds:
  - the title
    - *As built (issue #139):* for owners and editors, a pencil beside it opens **Expedition details**: the title, the summary and the Tags (prebuilt Dialog, Field, Input, Textarea and the Tag picker Concepts use; a Tag goes with its ×, a new one is typed). The Expedition menu has the same, "Title, summary and Tags…". Saving writes only what changed, as one edit.
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
  - **"Write the article" asks first**, in a dialog: Short (about 300 words), Standard (about 600) or Long (about 1,200), each with its cost estimate on this Expedition's Sources. Cancel spends nothing. A length over the reader's per-ask cap says so, and confirming it lets that one ask spend up to half again its estimate.

## 3.8 Grow and Suggestions (canvas 05)

- **"Ask about this Expedition"** in the side panel, for owners and editors. The copy reads "Uses your API key", or "Uses this instance's AI" in instance-key mode.
- **As the agent works,** its items appear **dashed on the canvas** and in the **Suggestions** tab. Each new Concept comes with a summary and overview. The ask can be stopped, and a per-ask spending cap applies (default $0.50).
- **Suggestions tab:**
  - Items are grouped by ask, with its author and rationale, then into entries (§1.5).
  - **A new Concept is one entry**, a package: its summary (and article, if suggested), with its Relationships to Concepts already in the Expedition nested under it, each with a checkbox (ticked). **Accept** takes the Concept and the ticked Relationships as one Change; unticked ones are dismissed with it. **Dismiss** dismisses the Concept and everything that depends on it; the toast says how many and its Undo brings them all back.
  - **A Relationship between suggested Concepts** is its own entry, **faded, with Accept off**, until those Concepts are accepted. Hovering or focusing it says why: "Accept NF4 and QLoRA first". It can still be dismissed. Once they're accepted it reads and works like any other entry.
  - Other items (a Relationship between Concepts already in the Expedition, an edit) are entries of their own, with **Accept / Dismiss**.
    - *As built (issue #139):* an edit of the Expedition reads "Summary and Tags of the Expedition", with the new summary and "add #ml, remove #synthetic"; an Attribute reads "New Attribute · Priority" (or "Attribute" for a change) with its type and values; an article that replaces another says so. An entry that needs a suggested Attribute waits for it like a Relationship waits for its Concepts.
  - **Accept all** per ask (and for everything, with more than one ask) asks first, in the tab's terms: "2 new Concepts, with 2 Relationships to Concepts already here", "then 1 Relationship between new Concepts", "1 other suggestion". It is one Change.
  - The canvas draws every pending item dashed, faded entries included, so the reader sees where they would go.
  - Stale items show "changed since suggested" with both versions.
  - Each review action is one undoable Change.
- **MCP Proposals** arrive with a toast ("Claude (via MCP) suggested 2 Concepts from a coding session: Review / Later").
- **Activity:** asks and their authors. The chat itself isn't kept.

## 3.9 History and sharing (canvas 06, amended)

- **History** (owners and editors) lists **Changes** with author, label and time ("Accepted 12 suggestions · Ana · 2h ago"). Each Change has **Undo**, **View as of here** (read-only) and **Restore to here**. Undo reports any edits it kept because they changed since. _(The canvas's Snapshot list and diff are replaced by this.)_
- **Share dialog:**
  - **Invite** by email as editor or viewer. An **email** is sent when a mailer is configured, and a **copyable invite link** is always offered. The invitee finds it under "Shared with you" with a **New** badge. Editors can invite. Only the owner changes roles or removes people.
    - *(WP-5.1)* An account with the invited email gets it at once; anyone else accepts through the link, which works once, for whichever signed-in account opens it first. Accepting never lowers a role. An editor cancels only the invites they sent. Anyone but the owner may **leave**. Someone removed or given another role is kicked from the live room and reopens with their new access.
  - **Visibility:** private / unlisted / public, **owner only**. A public or unlisted link shows the **latest state**, live.
    - *(WP-5.2)* Widening it from private asks first, saying the Sources become readable too. An unlisted or public Expedition shows its link to copy. Making it private again kicks every reader of the link from the live room.
  - A plain warning: **"Anyone who can view can also see the Sources."**
  - **Fork** (anyone signed in who can view): make your own copy.
    - *(WP-5.2)* Signed-in readers of a link open the share dialog too, read-only, to Fork. History has **Fork from here** on each Change (owners and editors: forking as of a Change needs History). A Fork's single Change reads "Forked from “…”".
  - *(WP-5.2)* **Move to Trash** (owner only), confirmed in the dialog. In Trash nobody can open it; the Library's Trash restores it for 30 days, then a daily job purges it.
  - **Export** to JSON or a Markdown folder.
- **Library cards** show who an Expedition is shared with.

## 3.10 Account and settings

- **Theme:** System / Light / Dark.
- **AI** (bring-your-own-key and `both` modes): keys per provider (the last 4 characters, Test, Delete). The model per stage is under Advanced. There's also the per-ask spending cap. In `both` mode the card says the reader's own key is used first, and has a line about this server's AI: on for the account, or off with **Ask to use this server's AI** ([3.12](#312-this-servers-ai-hosted)).
- **Connected agents:** MCP OAuth grants, and personal API tokens, each optionally restricted to chosen Expeditions. **Connect an agent** opens the step-by-step setup page, `/connect` ([MCP §6.4](06-mcp.md#64-connecting-an-agent)), which is also linked from Create: Sources, the Suggestions tab, Ask, the Library and the welcome step ([3.1](#31-page-flow)). **Add a key** links to `/settings#ai`, which scrolls to the AI card.
- **Notifications:** web push on or off.

## 3.11 Anonymous and viewer experience

- Viewing public or unlisted Expeditions needs no login, and live updates still arrive. Public ones are listed in Explore ([3.13](#313-explore)).
- Reading status and position stay in the browser until sign-in, then merge into the account.
- Viewers get no AI, no Suggestions tab and no History. They can Fork and Export.

## 3.12 This server's AI (hosted)

- Sign-up is open. Every account can create, import, Fork, edit, share and use MCP, approved or not.
- With access approval on ([2.6](02-architecture.md#26-auth-keys-and-tokens)), only accounts an admin has enabled use this server's AI key. The Library has no waiting-list banner; its "No AI connected yet" bar ([3.2](#32-library-canvas-01)) offers the request with the other ways to get AI.
- Create: Sources shows the "Building needs AI" panel ([3.3](#33-create-sources-canvas-02a)).
- Where the AI is needed later and the account has no key it may use (Choose Views, Grow, Write the article), one short line says: "Add your own AI key in Settings, ask to use this server's AI, or use your own agent over MCP." **Settings** and **MCP** (`/connect`) are links; **ask to use this server's AI** opens a small dialog with **Ask to use this server's AI** (an optional note, then "Request sent" with the date). Settings › AI has the same button ([3.10](#310-account-and-settings)).
- **Admin › Access requests** (admins only, from Settings): pending requests first, with name, email, note and date, and **Approve** / **Decline**; a second tab lists approved accounts. Approving emails the requester that the server's AI is on for them.

## 3.13 Explore

- **Route:** `/explore`. It needs no sign-in, and neither does opening an Expedition from it.
- **Lists** every public Expedition, newest Change first. Unlisted, private, Trash and drafts are never listed.
- **Cards** look like the Library's:
  - the thumbnail of the best View's View Type
  - the title and summary
  - the Expedition Tags
  - Concept and View counts, and the date
  - no people: no owner, collaborators, names or avatars.
- **Search** matches titles and summaries, as global search does. A **Tag filter** lists the most used Expedition Tags.
- **Paging:** 24 cards at a time, then **Load more**.
- **Header:** the wordmark, then **Sign in** when signed out, or **Library** and the account menu when signed in. The Library header links to Explore. The sign-in screen offers "Explore public Expeditions".
- **Opening a card** opens the Expedition read-only at `/e/:id`. Signed out, the Expedition's way back goes to Explore.
- **Fork when signed out:** a public or unlisted Expedition's header shows **Fork** next to **Sign in**. It goes to sign-in with `next=/e/<id>?fork=1`. Back on the Expedition, signed in, the share dialog opens with Fork one click away, and `fork=1` is removed from the address.
- **Endpoint:** see [2.8](02-architecture.md#28-search).


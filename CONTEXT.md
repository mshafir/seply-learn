# Umbel Learn

A tool for building, curating, and exploring Expeditions: bodies of knowledge on one subject, so a learner can take in a subject in well-defined chunks, see it from several angles, and see what they need to know first. Humans and LLMs curate Expeditions together. (Umbel Learn is a placeholder product name; Umbel is the umbrella for separate LLM tools such as Learn, Work and Plan. Older planning docs say "Mindmaps" and "Graph".)

## Language

### Expedition structure

**Expedition**:
A named, shareable body of knowledge on one subject: Concepts joined by Relationships, built from Sources, and explored through Views. A graph is only one of the ways to look at it.
_Avoid_: Graph, map, mind map, knowledge base, atlas, journey

**Source**:
Something an Expedition is built from: an AI chat (pasted text, share link or export, from any assistant), a file or link, or a prompt on its own. An Expedition can have several Sources, and each Concept records which Sources it came from. Content with no Source behind it is marked as background knowledge.
_Avoid_: Input, document, seed

**Concept**:
One well-defined chunk of knowledge in an Expedition, with a title, Kind, Tags, Attributes, an optional date and location, and content at three depths: a one-line summary, an overview (one deep paragraph that teaches it), and an optional article (a full wiki-style write-up). A Concept belongs to exactly one Expedition. Titles need not be unique; a Concept can carry aliases (other names for it), and two Concepts that turn out to be the same idea are merged into one, which keeps the other's title as an alias.
_Avoid_: Node, topic, card

**Concept Kind**:
What sort of thing a Concept is, e.g. idea (the default), person, place, thing, claim, evidence, criterion, decision, action, event. A built-in default set ships with every Expedition, and an Expedition can add its own. People are Concepts of kind person.
_Avoid_: Node type, entity type

**Attribute**:
A typed field (text, number, money, yes/no, with an optional unit) defined per Expedition and filled in on Concepts, e.g. price or drive time.
_Avoid_: Property, field, metadata

**Weight**:
How central a Concept is to its Expedition. It is computed from the Expedition's structure, and a curator can pin it as core or auxiliary. It sets visual prominence in the default View.
_Avoid_: Importance, rank, score

**Tag**:
A free-form label on a Concept, or on an Expedition, used for search and filtering. The two sets are separate.

**Relationship**:
A directed, typed link from one Concept to another in the same Expedition, with an optional note (e.g. "fails: Saturday check-in only").
_Avoid_: Edge, link, connection

**Relationship Type**:
A named kind of Relationship (e.g. prerequisite, example, part-of). A built-in default set ships with every Expedition, and an Expedition can add or remove its own.
_Avoid_: Edge type, predicate

### Viewing

**View**:
A saved way of looking at an Expedition: a View Type applied to that Expedition, with its settings (which Concepts are central, which Relationship Types and Attributes it uses). The same Concepts look different in different Views. Each View answers one question, and an Expedition opens on its best View. Some settings are shared with everyone who can edit (what the View includes); others are each reader's own (what they choose to show or hide).
_Avoid_: Pivot, lens, perspective, mode

**View Type**:
A named, documented way of looking at knowledge (e.g. Comparison Table, Outline, Evidence). It records the question the view answers, which Concepts are central, which Kinds, Relationship Types and Attributes it draws on, and how it is laid out. It is written as instructions that both curators and agents can follow, not as a strict filter.
_Avoid_: Pack, Presentation, template, chart type

### Reading

**Reading status**:
Where one reader stands with a Concept: not read yet, read, or known already (read before joining this Expedition). It belongs to the reader, not the Expedition, applies in every View, and lets a View shorten or skip what the reader has covered.
_Avoid_: Progress, mastery, completion

### Sharing and history

**Visibility**:
Who can view an Expedition: private (owner and invited collaborators), unlisted (anyone with the link), or public (listed and searchable).
_Avoid_: Privacy, access level

**Collaborator**:
A user invited to an Expedition as an editor or viewer.
_Avoid_: Member, contributor (a contributor in the subject is a person Concept)

**Change**:
One step in an Expedition's history: a group of edits with one author and one purpose, e.g. "Built from 3 Sources", "Accepted 12 Proposals", "Edited the MLA overview". History lists Changes; any Change can be undone, and an Expedition can be viewed as of, or restored to, any Change. Restoring is itself a new Change, so nothing is ever lost.
_Avoid_: Snapshot, version, revision, commit, checkpoint

**Fork**:
A new Expedition copied from another one's current state (or from any point in its history), owned by whoever forked it and recording where it came from. It starts its own history; the original's history is not copied.
_Avoid_: Clone, copy, duplicate

### Curation

**Proposal**:
A set of edits (new or changed Concepts and Relationships) suggested by an LLM (in-app or through MCP) that stays pending until a human accepts or rejects it, as a whole or item by item. Accepting it makes a Change. The first build of an Expedition from its Sources is not a Proposal: its Concepts and Views are created directly, and curated inside the Views afterwards. Likewise, a View a reader asks for later is created directly, with any new Concepts it needs; only its changes to existing Concepts become a Proposal. What a Source added later brings in is a Proposal.
Reader-facing copy calls Proposals "suggestions" ("Suggestions · 6"); everywhere else, including this glossary, the term is Proposal.
_Avoid_: draft, AI edit ("suggestion" only in reader-facing copy)

# Open-Source Tools for LLM-Assisted Knowledge Graphs for Learning

*Researched 2026-09-24. Star counts come from the GitHub API on that date unless noted otherwise.*

## The question

Which open-source tools already do most of this:

1. **Concept graph with prerequisites.** Knowledge is split into well-defined chunks (nodes). Edges say *"you need A before B"*.
2. **Visual exploration.** A learner can see where a concept sits, what it depends on, and what it unlocks.
3. **Built-in LLM / agent capabilities.** Generate nodes, propose edges, write explanations, tutor, and check mastery.
4. **Human + LLM co-curation.** A person reviews, edits, and approves what the LLM proposes, with provenance.

## TL;DR

- **No open-source project does all four well today.** The space splits into groups that each cover one or two of the pillars:
  - **Prerequisite-graph learning systems** (Metacademy, Oppia, Learning Commons, small DAG/mastery engines) have the right data model. They have little or no LLM co-authoring and weak visualization.
  - **AI tutors and course generators** have huge 2026 adoption: DeepTutor (~40k★) and OpenMAIC (~39k★). They generate lessons, quizzes, and "mastery paths", but they have **no explicit, curatable prerequisite graph**.
  - **"Graphs that teach" for code** also have huge adoption: Understand-Anything (~84k★) and Graphify (~121k★). They show the exact UX you describe (LLM builds a graph, then a dependency-ordered guided tour), but for codebases, not general knowledge.
  - **LLM knowledge curation** covers Karpathy's *LLM Wiki* pattern and Stanford's Co-STORM. Human and LLM co-build a shared structure, but it is a wiki or mind-map hierarchy, not a prerequisite DAG.
  - **GraphRAG infrastructure** (GraphRAG, LightRAG, Graphiti, Cognee, Neo4j LLM Graph Builder) extracts entity/relation graphs for retrieval. None of it models pedagogy.
- **Research shows why human curation is needed.** On K12-Bench prerequisite reasoning, frontier LLMs score only **~46–57% exact match** [K12-KGraph, 2026]. Human-in-the-loop methods like **ACE** (rank candidate edges, and experts confirm only the top ones) cut expert effort a lot and produced learning orders that improved student success.
- **Best models to copy:**
  - Curation and data format: **Lean Blueprint** (typed dependency graph, per-node status, humans and AI working in parallel).
  - Git-based content: **roadmap.sh / Learn Anything** (one markdown file per node, changes via PR).
  - Learner modeling: **Oppia / PathFinder** (prerequisite skills plus Bayesian Knowledge Tracing).
  - Evidence-backed LLM extraction: **SyllabusGraph** (every edge cites a source, plus an independent critic pass).
  - UX reference for "LLM builds a graph, then gives a guided tour": **Understand-Anything**.
- **The opening:** a local-first, git-backed concept DAG where an agent *proposes* nodes and prerequisite edges with evidence and confidence, a human accepts or rejects them in a review queue, and learners explore a zoomable graph with mastery overlays. Nothing mature and open fills this slot.

---

## Evaluation rubric

| Criterion | What we looked for |
|---|---|
| **Prereq model** | Typed, directed "requires" edges (ideally a validated DAG), not just "related to" links |
| **Chunking** | Nodes are self-contained learning units with content (explanation, resources, checks) |
| **Visualization** | Learner-facing graph / map exploration, not just a list |
| **LLM / agent** | LLM generates or suggests structure/content, tutors, or evaluates |
| **Human curation** | Review/approve workflow, direct editing, provenance, versioning |
| **Learner state** | Mastery tracking, personalized path through the graph |
| **Adoption / health** | Stars, recent commits, maintainers |
| **License** | Can you build on it? |

---

## 1. Prerequisite-graph-native learning systems (closest to the concept)

### Metacademy — the original "package manager for knowledge"
- **What:** Concepts in a prerequisite graph (mostly ML/stats). Pick a target concept and it computes a personalized learning plan: all the unmet prerequisites in topological order, each with curated resources.
- **Status:** **Archived 2023**, 688★. GPL-3.0 code, CC BY-SA content. Python 2.7 / Django.
- **LLM:** None, since it predates LLMs.
- **Why it matters:** The cleanest statement of your idea. Its data model (concept → prerequisites, plus curated resources and time estimates) is worth reusing. Its downfall was the **curation bottleneck**: experts had to hand-write every node and edge. LLM-assisted curation fixes exactly that.
- Links: [repo](https://github.com/metacademy/metacademy-application), [about](https://metacademy.org/about), [hunch.net intro](https://hunch.net/?p=2714), [foldl retrospective](http://www.foldl.me/2014/metacademy/)

### Oppia — production OSS learning platform with skill prerequisites
- **What:** A free, nonprofit, open-source lesson platform (6.8k★, Apache-2.0, very active). The base unit is a **skill** (concept card, worked examples, misconceptions). Lessons declare **prerequisite skills**, and those drive review questions at the start of a lesson.
- **Graph viz:** No learner-facing concept map.
- **LLM:** No LLM authoring of the graph.
- **Why it matters:** A proven, battle-tested *granularity*: a skill is phrased as "given X, compute Y", with misconceptions attached. Good model for "well-defined chunks".
- Links: [repo](https://github.com/oppia/oppia), [skills guide](https://oppia-user-guide.readthedocs.io/en/latest/admins/skills.html), [lesson planning](https://oppia-user-guide.readthedocs.io/en/latest/admins/guide.html)

### Learning Commons Knowledge Graph (CZI, with Anthropic) — open K-12 prerequisite *data*
- **What:** Machine-readable datasets:
  - US standards from all 50 states in 4 subjects
  - **Learning Components** (granular skills that break down standards)
  - **Learning Progressions** (how standards build on each other)
  - the **Math Coherence Map**
  - standards-aligned curricula (Illustrative Math, OpenSciEd)
  - a **curriculum dependency endpoint** for prerequisites between lesson groupings
- **Access:** REST API, **MCP server**, JSONL downloads, and agent plugins for ChatGPT and Claude.
- **Status and license:** 154★, active. Mixed licensing: many datasets are CC BY 4.0 / CC0, some are gated. General availability expected in 2026.
- **Why it matters:** For K-12 you can *import* a vetted prerequisite skeleton instead of generating one. The MCP server makes it directly usable by agents. It is a data layer, not a viewer or editor.
- Links: [repo](https://github.com/learning-commons-org/knowledge-graph), [site](https://learningcommons.org/), [launch blog](https://chanzuckerberg.com/blog/scaling-proven-learning-practices/), [coverage](https://www.edtechinnovationhub.com/news/new-knowledge-graph-from-anthropic-and-czi-links-ai-with-research-backed-teaching-tools)

### Lean Blueprint / LeanArchitect — the best human+AI curation model (for math)
- **What:** A "blueprint" is a typed dependency graph of definitions, lemmas, and theorems.
  - `\uses{}` records dependencies. A statement and its proof carry separate dependency lists.
  - Each node has a status (not ready / ready / formalized), shown as colors in the rendered dependency graph.
  - LeanArchitect (ITP 2026) extracts blueprint data from Lean code and infers dependencies automatically.
- **Status:** leanblueprint has 376★ (Apache-2.0) and is used by major formalization projects. Lean Atlas and TheoremGraph push it further toward human-AI collaboration.
- **Why it matters:** Small, locally specified nodes let many humans and AI agents work in parallel, and global progress is just a roll-up of node statuses. That is the collaboration pattern you want, applied to proofs instead of pedagogy.
- Links: [leanblueprint](https://github.com/PatrickMassot/leanblueprint), [LeanArchitect paper](https://arxiv.org/abs/2601.22554), [Lean Atlas](https://arxiv.org/abs/2604.16347), [TheoremGraph](https://arxiv.org/pdf/2606.25363)

### Small, recent prerequisite DAG / mastery engines (patterns, not platforms)
All are tiny (0–1★). They are worth reading for design ideas, not for adoption.

| Project | Notable idea | Links |
|---|---|---|
| **SyllabusGraph** (MIT, active Sep 2026) | Source-to-course agent pipeline. Every concept and edge cites **evidence** from the source texts, and an **independent critic model** reviews the graph. Interactive concept map with overview-to-detail zoom. Has a notion of mastery level: "a definition doesn't satisfy a dependency that needs a calculation". Demo: 3 QFT books → 117 concepts. Runs through Claude Code / Codex. | [repo](https://github.com/OscarBarreraGithub/syllabusgraph) |
| **PathFinder / Learning-Path** | Hand-built skill DAG (NetworkX, cycle-validated) plus LangGraph agents (gap finding, scheduling, quiz and explanation generation). **Bayesian Knowledge Tracing** estimates mastery, and the plan is redone when quiz scores come in. | [repo](https://github.com/gauravrai1704/Learning-Path) |
| **OpenScienceBasedLearningPlatform** | One `curriculum.json` (tracks → modules → skills → lessons) with CI checks for duplicate IDs, broken references, and **prerequisite cycles**. "Graph" view with zoom and pan. Changes by PR. | [repo](https://github.com/JohannesKnecht/OpenScienceBasedLearningPlatform) |
| **Open-source "Math Academy" for propositional logic** (Show HN) | 29-topic DAG. Solving a problem gives **fractional credit to prerequisite topics** weighted by edge weight, a Math Academy-style implicit repetition idea. | [HN](https://news.ycombinator.com/item?id=47503087) |
| **Skillgraph_OS** | DAG with "prerequisite" vs "helps-with" edge types, plus alternative routes through the graph. | [repo](https://github.com/Prashant-tgr/Skillgraph_OS) |
| **math-concept-mapper** | Teacher-facing concept-map editor with a class dashboard (hub/isolated concepts, class-wide **prerequisite gaps**) and AI recommendations. | [repo](https://github.com/jain-alisha/math-concept-mapper) |
| **Cognitive-knowledge-graph-engine** | Prerequisite-aware graph plus mastery tracking and recommendations. | [repo](https://github.com/prahasadev/Cognitive-knowledge-graph-engine) |

---

## 2. AI tutors and course generators (high adoption, no explicit prereq graph)

### DeepTutor (HKU Data Science Lab) — ~40.3k★, Apache-2.0, releases every few days
- **What:** An "agent-native" learning workspace:
  - RAG over your materials (LlamaIndex, GraphRAG, LightRAG, and others)
  - tutoring chat, problem solving, quiz generation, "interactive books"
  - persistent AI "partners"
  - **mastery paths with progression gates**
  - 3-layer learner memory
  - Mermaid / HTML visualizations
  - a skills marketplace
- **Stack:** Python / FastAPI and Next.js.
- **Gap:** Knowledge graphs are used *inside retrieval*. There is no curated, learner-visible prerequisite graph, and no documented prerequisite modeling.
- **Takeaway:** The strongest OSS "LLM tutor" foundation. You could pair it with a curated concept DAG: the graph decides *what's next*, and DeepTutor-style agents *teach it*.
- Links: [repo](https://github.com/HKUDS/DeepTutor), [20k★ in 111 days](https://xfutureagi.com/en/article/deeptutor-open-source-tutor/)

### OpenMAIC (Tsinghua) — ~38.9k★, MIT, v1.0 Aug 2026
- **What:** Turns a topic or document into a multi-agent classroom: AI teacher, TA, and classmates, with slides, quizzes, simulations, and project-based learning.
- **Pipeline:** outline → scenes, with a **human-editable outline** before generation and "Edit with AI" (validated JSON-patch edits).
- **Stack:** Next.js / LangGraph.
- **Gap:** A linear course *outline*, not a graph. No prerequisite modeling.
- **Takeaway:** A good reference for **human-edits-the-plan-then-agents-generate**. The outline-editing step is the curation hook.
- Links: [repo](https://github.com/THU-MAIC/OpenMAIC), [site](https://openmaic.io/)

---

## 3. "Graphs that teach" for codebases (proof the UX gets adopted)

### Understand-Anything — ~84k★, MIT
- **What:** A multi-agent pipeline (scanner, file/architecture analyzers, **tour-builder**, **graph-reviewer**) turns a codebase into an interactive force-directed knowledge graph.
  - Semantic search and Q&A over the graph.
  - **"Guided tours" that walk through the architecture ordered by dependency.**
  - The graph is committed as JSON so teams share it, and a read-only viewer needs no LLM.
- **Tagline:** "Graphs that teach > graphs that impress."
- **Takeaway:** This *is* your product shape. Its domain is code, where dependencies can be extracted mechanically. General knowledge needs LLM-proposed and human-verified prerequisite edges instead. The separate **graph-reviewer agent** and the **committed JSON graph** are both worth copying.
- Link: [repo](https://github.com/Egonex-AI/Understand-Anything)

### Graphify — ~121k★, Apache-2.0
- **What:** A `/graphify` skill for Claude Code, Codex, Cursor, and others. It turns any folder (code, docs, PDFs, images, video) into a local, queryable knowledge graph. Deterministic AST parsing where possible, "every edge explained", no Neo4j or vector store.
- **Takeaway:** Validates "agent skill + local graph file + explained edges" as a distribution model. Its edges are relations, not pedagogy.
- Links: [repo](https://github.com/Graphify-Labs/graphify), [site](https://graphify.net/)

---

## 4. LLM-maintained knowledge bases and human–AI curation

### Karpathy's "LLM Wiki" pattern (April 2026)
- **What:** Not a product but a very influential pattern (viral X post, gist with 5k+★ in days).
  - `raw/` holds immutable sources, `wiki/` holds LLM-written interlinked markdown pages, and a schema file (`CLAUDE.md` / `AGENTS.md`) governs the agent.
  - The human reads and edits in Obsidian, and the agent keeps the wiki current.
- **Implementations:** an Obsidian plugin, `llm-wiki-kit` (MCP), and a Hermes Agent skill.
- **Takeaway:** The most popular human+LLM curation workflow right now: plain files, git, and an agent governed by a schema. Add typed `prerequisites:` frontmatter and you are most of the way to a curatable concept DAG.
- Links: [gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), [guide](https://blog.starmorph.com/blog/karpathy-llm-wiki-knowledge-base-guide), [Obsidian plugin](https://community.obsidian.md/plugins/karpathywiki), [llm-wiki-kit](https://glama.ai/mcp/servers/iamsashank09/llm-wiki-kit)

### STORM / Co-STORM (Stanford OVAL) — ~31.5k★, MIT (last push Sep 2025)
- **What:** STORM researches a topic and writes a cited, Wikipedia-style article. In **Co-STORM** a human joins a discussion among agents ("experts" and a moderator) while the system keeps a **dynamic mind map**: a hierarchical concept structure that serves as a *shared conceptual space between human and system*.
- **Takeaway:** The best-studied design for human + LLM co-exploration of a topic. Its structure is a taxonomy, not prerequisites. Activity has slowed.
- Links: [repo](https://github.com/stanford-oval/storm), [PyPI](https://pypi.org/project/knowledge-storm/)

### Open Notebook (~39.4k★, MIT) and Khoj (~37.5k★, AGPL-3.0)
- Open-source NotebookLM alternatives for chat, sources, and podcasts. **Open Notebook has no mind maps.** Khoj can produce Mermaid mind maps.
- Relevant as a "learn from your sources" layer, not as graph tools.
- Links: [open-notebook](https://github.com/lfnovo/open-notebook), [XDA review](https://www.xda-developers.com/switched-from-notebooklm-to-open-source-tool-open-notebook/), [khoj](https://github.com/khoj-ai/khoj)

---

## 5. Personal knowledge management with graphs (DIY route)

| Tool | Relevance | License / adoption |
|---|---|---|
| **Obsidian** + **Breadcrumbs** plugin | Breadcrumbs adds **typed, directed links** (up/down/next/prev or custom, e.g. `requires`) from frontmatter and builds a real directed graph. Combine it with the LLM Wiki pattern to get a working prerequisite-graph prototype today. | Obsidian is closed-source (free). Breadcrumbs is OSS (~800★). |
| **InfraNodus AI Graph View** (Obsidian) | Text-network analysis: topical clusters, central ideas, and **gaps between clusters**. Also ships an LLM-Wiki mode. | Plugin AGPL-3.0 (172★). Backend is a commercial SaaS. |
| **Logseq** | Open-source outliner with graph view and whiteboards. | AGPL-3.0, ~45k★ |
| **AFFiNE** | Open-source docs + whiteboard + mind map, local-first, with AI features. | ~73k★, mixed license (check before building on it) |

**Takeaway:** You could get ~70% of the vision in a weekend, for a single user:
- one note per concept, with a `requires:` field
- an agent that proposes notes and edges, reviewed through git diffs
- a Breadcrumbs or Juggl view

What this route lacks: a learner-facing view, mastery tracking, and a shared review workflow.

---

## 6. Roadmaps and skill trees (curated, low AI)

### roadmap.sh (developer-roadmap) — ~368k★ (one of GitHub's most-starred repos)
- **What:** Interactive node-based roadmaps for developer roles. Each node's content is a markdown file (`content/<topic>@<node-id>.md`), edited through community PRs. The hosted site adds an AI roadmap generator and AI tutor, but **these are not in the open repo**.
- **License warning:** A **custom restrictive license**. Personal use only, no redistribution or commercial reuse without permission. You can study it but not build on it.
- **Takeaway:** Proves the demand for "show me the map, then let me click a node to learn". Also proves node-per-file plus PR curation works at scale. Its edges are roadmap order, not strict prerequisites.
- Links: [site](https://roadmap.sh/), [repo](https://github.com/kamranahmedse/developer-roadmap), [license](https://github.com/kamranahmedse/developer-roadmap/blob/master/license)

### Learn Anything — historical reference
- Began in 2017 as open-source, community-curated mind maps and learning paths, later "AI- and community-guided". The `learn-anything/learn-anything` repo (16.9k★) now holds a **different, dormant project (Linsa)**, so this is effectively discontinued as open source.
- Links: [origin story](https://medium.com/@nikitavoloboev/an-incredible-future-9f18bb0f3a7c), [old fork](https://github.com/Kaodemic/learn-anything)

### Others
- [niyue/skillmap](https://github.com/niyue/skillmap): a text DSL that renders a skill tree with progress bars and prerequisite edges.
- [Geekbang Skill-Map](https://sourceforge.net/projects/skill-map.mirror/): programmer skill maps.

---

## 7. GraphRAG / agent-memory infrastructure (useful substrate, not pedagogy)

These tools extract **entity/relation** graphs from text for retrieval or agent memory. They do not model *"learn A before B"*, and their graphs are noisy for teaching. They could serve as the ingestion layer that finds candidate concepts in a corpus.

| Project | ★ | License | Note |
|---|---|---|---|
| [microsoft/graphrag](https://github.com/microsoft/graphrag) | 36k | MIT | Community summaries over entity graph |
| [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) | 39.8k | MIT | Lighter GraphRAG, has a graph viewer. Used by DeepTutor |
| [getzep/graphiti](https://github.com/getzep/graphiti) | 31.1k | Apache-2.0 | Temporal KG for agent memory |
| [topoteretes/cognee](https://github.com/topoteretes/cognee) | 31k | Apache-2.0 | Memory / KG pipelines |
| [neo4j-labs/llm-graph-builder](https://github.com/neo4j-labs/llm-graph-builder) | 5.3k | Apache-2.0 | PDFs / YouTube / web → Neo4j KG, with a UI |
| [rahulnyk/knowledge_graph](https://github.com/rahulnyk/knowledge_graph) | 4.1k | MIT | Simple text → concept graph |
| [dylanhogg/llmgraph](https://github.com/dylanhogg/llmgraph) | 509 | MIT | Recursively expands a topic into a KG using an LLM's own knowledge (closest to "generate a concept map for X") |

---

## 8. Visualization building blocks

| Library | ★ | Fit |
|---|---|---|
| [xyflow (React Flow)](https://github.com/xyflow/xyflow) | 38.5k | Best for an **editable** node/edge UI (curation). Pair it with ELK/dagre for layered DAG layout |
| [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) | 11.2k | Graph algorithms plus many layouts, including `dagre` and `klay` for prerequisite DAGs |
| [Sigma.js](https://github.com/jacomyal/sigma.js) | 12.2k | WebGL, handles thousands of nodes (a whole-field "map of knowledge") |
| [markmap](https://github.com/markmap/markmap) / [simple-mind-map](https://github.com/wanglin2/mind-map) | 13.1k / 12.8k | Tree-shaped mind maps from markdown. Easy LLM output target, but can't express a DAG |
| [Excalidraw](https://github.com/excalidraw/excalidraw) / [tldraw](https://github.com/tldraw/tldraw) | 133k / 51k | Freeform canvas. tldraw needs a commercial license for production use |

Prerequisite graphs are **DAGs, not trees**. A layered (Sugiyama) layout, where foundations sit at the bottom and goals at the top, reads far better than force-directed layouts for "what do I need first?".

---

## 9. Closed-source reference points (for comparison only)

- **Math Academy:** Probably the best existing product built on a prerequisite knowledge graph. It uses a hand-curated topic graph with "encompassing" edges, so practicing an advanced topic gives implicit review credit to its prerequisites, plus diagnostic placement. ([how it works](https://www.mathacademy.com/how-our-ai-works))
- **Khan Academy:** Its old "knowledge map" (a graph of exercises) was retired. Khanmigo is its LLM tutor.
- **NotebookLM:** Auto-generated mind maps from sources. Hierarchical, not prerequisite-based, and hard to edit.
- **Heptabase / Scrintal / Kosmik:** Visual card-whiteboards for studying. The human builds the map.
- **InfraNodus:** Commercial text-network analysis. See the Obsidian plugin above.

---

## 10. Research worth knowing

| Work | Key point |
|---|---|
| **K12-KGraph / K12-Bench** (2026) | Curriculum-aligned KG with an LLM extraction pipeline. On prerequisite reasoning, Gemini-3-Flash scores 57% and Gemma-4-31B 46% exact match. **LLMs alone are not reliable prerequisite judges.** [arXiv](https://arxiv.org/html/2605.09635) |
| **ACE: AI-Assisted Construction of Educational KGs** (JEDM, 2024) | Scores concept pairs, sends the top-ranked candidates to experts, and infers more edges from what experts confirm. Big cut in expert effort. Students who studied in ACE's order had better success rates. Dataset and code on GitHub. **Blueprint for the review queue.** [paper](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/737) |
| **Concept Catalyst** (2026) | Teachers build concept maps while the LLM stays behind the UI as a suggestion generator. Keeps decisions with the teacher. [arXiv](https://arxiv.org/pdf/2605.20511) |
| **Graphusion** (2024) | RAG-based KG construction with a global merge step. Applied to building NLP-domain concept graphs. [arXiv](https://arxiv.org/pdf/2410.17600) |
| **ProPRL** (2026) | Property-aware prerequisite relation learning in educational KGs. [arXiv](https://arxiv.org/pdf/2608.03006) |
| **Knowledge gaps from tutor chats via prerequisite graphs** (2026) | Maps student questions to a GPT-4-extracted prerequisite graph to find missing foundations. [arXiv](https://arxiv.org/html/2606.10736) |
| **Leveraging LLMs for educational concept & relation extraction** (MDPI, 2025) | Few-shot prompting beats zero-shot by ~6 points on relation extraction, and prerequisites gain the most from examples. [paper](https://www.mdpi.com/2504-4990/7/3/103) |
| **CourseMapper** (RWTH) | MOOC platform with educational and personal KGs. Concepts are extracted from slides and linked to Wikipedia. Bottom-up construction beat top-down. [paper](https://link.springer.com/chapter/10.1007/978-3-032-00056-9_11) |
| **TutorialBank / LectureBank** | Classic hand-labeled prerequisite datasets for evaluation. [arXiv](https://arxiv.org/pdf/1805.04617) |
| **Systematic review of concept map generation** (2025) | Survey of automatic concept-map generation methods. [arXiv](https://arxiv.org/pdf/2509.14554) |

---

## Comparison matrix

Scale: ● strong · ◐ partial · ○ none/weak

| Tool | Prereq model | Chunked nodes | Visual graph | LLM / agent | Human curation | Learner state | Adoption | License |
|---|---|---|---|---|---|---|---|---|
| Metacademy | ● | ● | ◐ | ○ | ◐ (expert-edited) | ◐ (learning plans) | archived | GPL / CC BY-SA |
| Oppia | ◐ (prereq skills) | ● | ○ | ○ | ● (creator tools) | ● | 6.8k★, active | Apache-2.0 |
| Learning Commons KG | ● (progressions, dependencies) | ● (learning components) | ○ | ◐ (MCP for agents) | ● (expert-authored) | ○ | 154★, backed by CZI | mixed / CC |
| Lean Blueprint | ● (`\uses`) | ● | ● (dependency graph) | ◐ (LeanArchitect, AI provers) | ● | ◐ (node status) | 376★, used across math community | Apache-2.0 |
| SyllabusGraph | ● | ● | ● | ● (agent + critic) | ◐ (human audit pending) | ◐ | 1★ | MIT |
| PathFinder | ● (DAG) | ◐ | ◐ | ● | ◐ (JSON files) | ● (BKT) | 0★ | – |
| DeepTutor | ○ | ◐ | ◐ (Mermaid) | ● | ◐ | ● | 40k★ | Apache-2.0 |
| OpenMAIC | ○ (linear outline) | ● | ○ | ● | ● (outline + slide editing) | ◐ | 39k★ | MIT |
| Understand-Anything | ● (code deps) | ● | ● | ● (multi-agent + reviewer) | ◐ (committed JSON) | ○ | 84k★ | MIT |
| Graphify | ◐ | ◐ | ● | ● | ◐ | ○ | 121k★ | Apache-2.0 |
| LLM Wiki pattern | ○ (links only) | ● | ◐ (Obsidian) | ● | ● (files + git) | ○ | viral, many forks | pattern |
| Co-STORM | ○ (hierarchy) | ◐ | ◐ (mind map) | ● | ● (human in discourse) | ○ | 31.5k★, slowing | MIT |
| Obsidian + Breadcrumbs | ● (typed links) | ● | ● | ◐ (plugins) | ● | ○ | large | closed app + OSS plugin |
| roadmap.sh | ◐ (ordering) | ● | ● | ○ in OSS | ● (PRs) | ◐ | 368k★ | **restrictive** |
| GraphRAG / LightRAG / etc. | ○ | ○ | ◐ | ● | ○ | ○ | 30–40k★ | MIT / Apache |

---

## Gaps and design implications

1. **Prerequisite edges are where LLMs are weakest and where errors cost the most.** A missing or backwards prerequisite sends learners into material they can't yet follow. Make every edge a **proposal** that carries a confidence score and cited evidence (the SyllabusGraph pattern). Route low-confidence or high-impact edges to a human review queue (the ACE pattern). Record who approved what.
2. **Distinguish edge types.** Useful types:
   - `requires` (hard prerequisite)
   - `helps` (soft prerequisite)
   - `part-of` (decomposition)
   - `related`
   - `encompasses` (Math Academy-style implicit practice)

   Consider *depth-qualified* prerequisites ("requires B at the *apply* level, not just *define*"), which SyllabusGraph hints at.
3. **Plain files plus git beats a database for curation.** One markdown file per concept, with frontmatter for prerequisites, objectives, resources, and checks. Every successful curated-knowledge project here (roadmap.sh, Learn Anything, Lean Blueprint, LLM Wiki, Understand-Anything's committed JSON) keeps content in files under version control. Agents and humans edit the same files, and review happens in diffs or PRs. Add CI checks for cycles and dangling references (OpenScienceBasedLearningPlatform).
4. **Keep the graph separate from the tutor.** The curated DAG decides *what* to learn and in what order. An LLM tutor (DeepTutor/OpenMAIC-style) handles *how*, generating explanations and quizzes for one node at a time. Mastery should come from a transparent model (BKT, or Math Academy-style credit that flows to prerequisites), not from LLM judgment.
5. **Visualization should be DAG-first.** Show a layered "what do I need first?" view for one target concept (Metacademy's learning plan), zoomable out to a whole-field map (Sigma.js scale). Overlay mastery, and mark AI-proposed edges that haven't been reviewed yet in a distinct style.
6. **Reuse, don't regenerate, where vetted graphs exist.** Learning Commons covers K-12 standards and progressions (with an MCP server). Mathlib/blueprint dependency graphs cover formal math. Wikipedia/Wikidata can anchor concept identity, which CourseMapper does.
7. **Distribute as an agent skill or MCP server.** Graphify and Understand-Anything reached massive adoption by shipping as skills for Claude Code / Codex / Cursor. A "curate a concept graph" skill plus a static viewer is a low-friction way in.

### Suggested starting stack (if building)
- **Content:** a folder of `concepts/*.md` files. Frontmatter holds `requires`, `helps`, `objectives`, `sources`, `status: proposed|reviewed`, and `confidence`.
- **Agents:** proposer (extracts concepts and edges from sources, with citations), critic (checks for cycles, finds missing prerequisites, verifies evidence), and tutor (per-node explanation and quizzes).
- **Curation UI:** React Flow editor with an accept/reject queue for proposed edges. Git commits record provenance.
- **Learner UI:** Cytoscape.js or Sigma.js with dagre/ELK layered layout, a mastery overlay, and "plan my path to X".
- **Seed data:** Learning Commons (K-12), or a user corpus through a LightRAG/Graphify-style ingestion pass.

---

## Sources

- Metacademy: https://github.com/metacademy/metacademy-application · https://metacademy.org/about · https://hunch.net/?p=2714 · http://www.foldl.me/2014/metacademy/
- Oppia: https://github.com/oppia/oppia · https://oppia-user-guide.readthedocs.io/en/latest/admins/skills.html
- Learning Commons: https://github.com/learning-commons-org/knowledge-graph · https://learningcommons.org/ · https://chanzuckerberg.com/blog/scaling-proven-learning-practices/ · https://www.edtechinnovationhub.com/news/new-knowledge-graph-from-anthropic-and-czi-links-ai-with-research-backed-teaching-tools
- Lean Blueprint: https://github.com/PatrickMassot/leanblueprint · https://arxiv.org/abs/2601.22554 · https://arxiv.org/abs/2604.16347
- SyllabusGraph: https://github.com/OscarBarreraGithub/syllabusgraph
- PathFinder: https://github.com/gauravrai1704/Learning-Path
- OpenScienceBasedLearningPlatform: https://github.com/JohannesKnecht/OpenScienceBasedLearningPlatform
- Propositional-logic Math Academy (HN): https://news.ycombinator.com/item?id=47503087
- Skillgraph_OS: https://github.com/Prashant-tgr/Skillgraph_OS
- math-concept-mapper: https://github.com/jain-alisha/math-concept-mapper
- DeepTutor: https://github.com/HKUDS/DeepTutor · https://xfutureagi.com/en/article/deeptutor-open-source-tutor/
- OpenMAIC: https://github.com/THU-MAIC/OpenMAIC · https://openmaic.io/
- Understand-Anything: https://github.com/Egonex-AI/Understand-Anything
- Graphify: https://github.com/Graphify-Labs/graphify · https://graphify.net/
- Karpathy LLM Wiki: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f · https://blog.starmorph.com/blog/karpathy-llm-wiki-knowledge-base-guide
- STORM / Co-STORM: https://github.com/stanford-oval/storm
- Open Notebook: https://github.com/lfnovo/open-notebook · https://www.xda-developers.com/switched-from-notebooklm-to-open-source-tool-open-notebook/
- Breadcrumbs: https://github.com/SkepticMystic/breadcrumbs · InfraNodus plugin: https://github.com/noduslabs/infranodus-obsidian-plugin
- roadmap.sh: https://github.com/kamranahmedse/developer-roadmap · https://roadmap.sh/about
- Learn Anything: https://medium.com/@nikitavoloboev/an-incredible-future-9f18bb0f3a7c · https://github.com/learn-anything/learn-anything
- Math Academy: https://www.mathacademy.com/how-our-ai-works
- Heptabase alternatives overview: https://tana.inc/blog/best-heptabase-alternatives-2026
- K12-KGraph: https://arxiv.org/html/2605.09635
- ACE: https://jedm.educationaldatamining.org/index.php/JEDM/article/view/737
- Concept Catalyst: https://arxiv.org/pdf/2605.20511
- Graphusion: https://arxiv.org/pdf/2410.17600
- ProPRL: https://arxiv.org/pdf/2608.03006
- Knowledge gaps via prerequisite graphs: https://arxiv.org/html/2606.10736
- MDPI LLM concept extraction: https://www.mdpi.com/2504-4990/7/3/103
- CourseMapper: https://link.springer.com/chapter/10.1007/978-3-032-00056-9_11
- Concept map generation review: https://arxiv.org/pdf/2509.14554

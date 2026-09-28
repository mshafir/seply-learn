---
id: learning-path
name: Learning path
status: candidate — tried, not singled out
answers: "What do I need to understand first?"
tried-in: [statins/learn, printer/make]
---

# Learning path

A prerequisite DAG, read left to right from foundations to the thing you want to understand. It's the original "learning graph" idea from the product brief.

## What was tried

- **Statins → Learning path.** `prerequisite` only, layered left to right: cholesterol → lipoproteins → LDL → plaque → statins → residual risk. It read cleanly and was the best-structured graph layout of the first pass.
- **3D printer → Learn to make.** `prerequisite` / `enables` / `part-of`, layered: models → slicing → Claude-as-CAD → electronics → projects. The mix of three Relationship Types made it a general dependency graph rather than a path.

## Why it fell flat

- It wasn't singled out. None of the three chats was a learning chat, so a reading order wasn't what the reader was looking for.
- It had no sense of *where you are*: nothing marks what's known, what's next, or a route to one target Concept.
- With `enables` and `part-of` mixed in (printer), "before" stopped meaning "needed to understand".

## Ideas for the next pass

- Try it on a real learning source (a course, a textbook chapter, the research doc in `docs/research/`).
- Ask for a *target* Concept and show only its prerequisite closure, in order: a path, not the whole DAG.
- Let the reader mark Concepts as known, and dim everything they already have.
- Could supply the Outline's sibling order (see the Outline's open questions).

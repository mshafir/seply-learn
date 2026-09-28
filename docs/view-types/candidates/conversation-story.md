---
id: conversation-story
name: Conversation story
status: candidate — tried, fell flat
answers: "How did the thinking evolve over the chat?"
tried-in: [printer/story, vacation/story]
---

# Conversation story

Concepts placed by the turn they entered the source (conversation order, not real dates), running top to bottom like the chat itself. It shows how a question grew and changed.

## What was tried

- **3D printer → How the chat went.** Every Concept with an `order`, vertical: from "what can I make?" through buying, air quality and electronics to "which booster fan?".
- **Family trip → How the search evolved.** Criteria, claims, options, the decision and events by turn: requirements appear (turn 1 heated pool, turn 5 Shabbat and budget, turn 11 walkable Saturday), options come and go, the resorts arrive at turn 17.
- The first attempt was horizontal and piled up; vertical read much better.

## Why it fell flat

- Every Concept got a slot, so the view was long and flat. Important turns (the pivot to resorts) looked the same as passing mentions.
- Edges between turns were hidden to avoid a hairball, which left disconnected cards in a column.
- The Timeline View Type now uses a real timeline component for real dates. Conversation order was taken out of it rather than forced into the same axis.

## Ideas for the next pass

- Group by *phase* of the conversation (search the Cape → try Region C → switch to resorts → book), with the Concepts introduced in each phase as a cluster.
- Show only the turning points: new requirements, dropped requirements, corrections, and decisions.
- Could reuse vis-timeline with turns as the axis and phases as background ranges.

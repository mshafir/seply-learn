---
id: timeline
name: Timeline
status: proven (idea); rendering needs a purpose-built timeline component
answers: "When did (or will) things happen, and what overlaps?"
proven-in: [statins/timeline, vacation/calendar]
---

# Timeline

Dated Concepts on a **zoomable time axis**, as **points** (an approval, a trial result) and **spans** (a trip, "on a statin since", a drug's patent life). They are grouped into lanes by theme. It shows history, sequence and overlap, and it works best as a purpose-built timeline component, not as a graph with an x axis.

## Instructions

1. **Place every dated Concept.** A point for a moment, a span for anything with a start and end (or an ongoing start).
2. **Group into lanes** by what the reader wants to compare. For statins: drug history, trials & evidence, and my own plan. For the trip: the search, the booking follow-ups, and the trip itself.
3. **Handle uneven density:**
   - Let the reader zoom from decades to days.
   - The initial viewport should frame the interesting cluster, not the whole range.
   - Long empty stretches should compress (or be broken) rather than eat the screen.
4. **Respect fuzzy dates:** a year only ("1987"), a month ("2026-11"), a season, "c. 1680s". Don't fake day precision.
5. **Mark "now"** so past and planned are distinct: a planned follow-up, a scheduled call, an upcoming trip.
6. **Read it** for sequence (what came first), cause-in-time (a trial result before a guideline change) and what's coming up.

## Draws on

- **Kinds:** *event* primarily, plus any Concept with a date: *source* (a trial's result date), *thing* (a product launch), *action* (a planned retest), *measurement* (when a number was taken).
- **Relationship Types:** none required. Relationships between dated items (a withdrawal *led to* a policy) can be drawn as arcs on demand.
- **Attributes:** the date as a point, a span, or fuzzy, and the lane (derived from a Tag or Kind, or set explicitly).
- **Settings:** lane grouping, initial range, whether to include undated Concepts in a side list, and whether the time field is the real date or the *source order* (conversation turn).

## Layout & interaction

- A horizontal axis with zoom and pan, lanes stacked vertically, spans as bars and points as markers with labels that don't overlap.
- Clicking opens the Concept alongside; search dims non-matches.
- **Component options** (to evaluate):
  - **vis-timeline:** groups/lanes, ranges, zoom; vanilla JS with React wrappers.
  - **Knight Lab TimelineJS:** storytelling slides.
  - **react-calendar-timeline:** scheduling-style lanes.
  - A custom d3-based axis inside React Flow is what the prototype did, and it's not enough.
- **Conversation order** ("when did this idea enter the chat") is a different time. It read best **vertically**, like the chat, and may belong to a separate View Type (see *Conversation story* in the candidates).

## Building it from a source

- Extract every explicit date and date range, at the precision stated. "Approved 2003" is a year, not 2003-01-01.
- Extract relative dates against the source's own date ("follow up in 8 weeks" from a chat dated mid-September means ~November) and mark them approximate.
- Create event Concepts for things that *happened* even when the source only mentions them in passing (cerivastatin withdrawn 2001).
- Tag each dated Concept with the lane it belongs to.

## In the sample graphs

- **Statins → Timeline.** Lovastatin (1987), cerivastatin withdrawn (2001), rosuvastatin approved (2003), pitavastatin (2009), the EAS consensus and ACC/AHA BP thresholds (2017), the trans-fat ban (2018), bempedoic acid (2020), the Lp(a)HORIZON miss (2026-09-04), starting rosuvastatin (Sep 2026), then AHA Sessions and the lipid retest (Nov 2026).
  - On a linear axis, forty years of history left the 2026 cluster piled into one corner.
  - A compressed axis (one slot per distinct date, log-scaled gaps) made it legible but distorted real durations.
  - It also had no lanes separating *drug history* from *my plan*, no spans, and no "now" marker. That's what a purpose-built component should provide.
- **Family trip → Calendar.** Search started (2026-09-09), the chosen resort booked (2026-09-10), a follow-up call a few months later, and the trip itself (a week-long span).
  - The trip was forced into two point events (arrive, head home) because the format had no spans. It should be one bar.
  - The "now" line would sit between booking and January.

## What worked / what didn't

- **Worked:**
  - Dates on Concepts, including month-precision ones.
  - The idea of mixing history, evidence and personal plan on one axis.
- **Didn't:**
  - The linear scale piled up clusters; the compressed scale distorted durations.
  - No spans, no lanes, no zoom-to-cluster, no "now".
  - The graph canvas isn't a timeline component.

## Open questions

- Date model: point, span, ongoing, fuzzy/circa, BCE (see the Concept time fog on the planning map).
- Which component, given React, theming, and the offline desktop app?
- Is conversation order a setting of Timeline, or its own View Type?

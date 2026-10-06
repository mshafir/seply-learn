---
id: comparison-table
name: Comparison Table
status: proven
answers: "How do the options stack up against what matters?"
proven-in: [statins/compare, printer/decide, printer/air-rank, vacation/compare]
---

# Comparison Table

A grid with **options down the side and what matters across the top**. The one View Type that was valuable in all three sample graphs. It's the natural shape of any decision, and it's also a compact reference for a family of similar things (drugs, boards, printers). It trades the graph's sense of connection for fast side-by-side reading and for exposing **what's unknown**.

## Instructions

1. **Pick the row set:** the Concepts being compared. They are peers of one Kind (usually *thing*/option), often narrowed by a Tag. Everything in a row should be a real alternative or a sibling in the same family.
2. **Pick the columns.** There are two sorts:
   - **Attribute columns:** facts about the option itself (price, nights, drive time, mechanism, status).
   - **Criterion columns:** a *criterion* Concept (e.g. "Heated pool"). The cell is the Relationship from the row option to that criterion (`meets` / `partly` / `fails`), with the Relationship's **note** as the cell text ("'lightly heated' ~70°F").
3. **Order the rows** by the Attribute that drives the decision (usually price), or by rank for a checklist.
4. **Show gaps honestly.** A missing Relationship is `?`, not blank. The gaps are the research still to do.
5. **Read it** by scanning a column to see who clears a criterion, and a row to see one option's whole profile. The chosen option, if there is one, should stand out.

## Draws on

- **Kinds:** rows are usually *thing* (options, products, drugs, properties); criterion columns are *criterion*.
- **Relationship Types:** `meets` / `partly` / `fails` from option to criterion. Colour and a note carry the verdict. `chosen` marks the winner.
- **Attributes:** typed per Graph. Money and number values format and sort; text is shown as is.
- **Settings:** the row Kind or Tag, the ordered column list, and the sort Attribute.

## Layout & interaction

- A sticky header row and a sticky first column (the option name). Horizontal scroll when wide.
- Cell = coloured dot + verdict + note. Hovering shows the full note.
- Clicking a row opens that option's Concept alongside. Clicking a criterion header opens the criterion.
- Search dims non-matching rows rather than hiding them, so the grid keeps its shape.

## Building it from a source

- Every option mentioned becomes a Concept, even the ones rejected in one line. Rejections are data.
- Pull **criteria out as their own Concepts** the moment a requirement is stated ("heated pool is a hard requirement"). Record whether each is hard or a nice-to-have, and when it was introduced or dropped.
- For every option × criterion the source actually addresses, write a verdict Relationship **with the evidence as its note** ("fails: 'Pool is not heated'", "partly: carbon only — add a Bento").
- Put numbers into Attributes, not prose: price with what it covers (all-in vs base), nights, bedrooms, drive hours.
- Don't invent verdicts the source didn't give. Leave the `?`.

## In the sample graphs

- **Family trip → Compare options.** 22 properties (Region B houses, Region C rentals, Region D and Region E resorts) × price, nights, drive time, heated pool, no driving on Shabbat, budget, beach, pickleball, kids, kitchen, oceanfront and status, sorted by price.
  - It retold the chat's whole search on one screen. The cheap Region C houses failed on "heated pool", the Cape houses failed on budget, and the chosen resort's weak cell is "partly · 'lightly heated' ~70°F".
  - The `?` cells showed which properties were never checked against which requirement.
- **A 3D printer for the family → Which printer?** 8 printers × price, enclosed, filters ultrafine particles, price/value, multicolor, ABS/ASA and status.
  - The "trap" became visible: refurbished X1C = "fails · fake discount".
  - The recommended refurb P1S reads as enclosed + great price + "partly · carbon only — add a Bento".
- **A 3D printer → Air: what to do first.** Mitigation actions sorted by an *impact rank* Attribute. The same View Type used as a **ranked checklist**: rows are actions, not options.
- **Statins → Compare treatments.** Drugs × mechanism, LDL effect, cost, main downsides and status. All Attribute columns, no criteria.
  - It works as a **reference table** for a family of things, not only for decisions.

## What worked / what didn't

- **Worked:**
  - Decision chats are tabular at heart.
  - Notes as cell text carried most of the value.
  - Sorting by price made the budget story obvious.
  - `?` for unknowns was unexpectedly useful.
- **Didn't:**
  - Wide tables need horizontal scroll, and there's no column grouping (hard vs nice-to-have).
  - The chosen option (the chosen resort, "BOOKED") only showed through a status text column.
  - Dropped criteria (walkable Saturday, kosher) still had to be left out by hand.

## Open questions

- Should criteria carry a hard/soft flag so the table can group columns and flag options that fail a hard criterion?
- Is a score column (weighted criteria) helpful, or does it fake precision?
- Should the chosen row be pinned or highlighted, with eliminated rows collapsed?
- How should Views keep row and column settings in sync as options and criteria are added (e.g. "all criteria not dropped")?

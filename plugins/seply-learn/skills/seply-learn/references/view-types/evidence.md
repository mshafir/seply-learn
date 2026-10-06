---
id: evidence
name: Evidence
status: proven
answers: "What do we believe, how strongly, and what is it based on?"
proven-in: [statins/evidence]
---

# Evidence

An argument map with **claims at the center**. Each claim is a hub, with the evidence that **supports** it fanned out on one side and the evidence that **challenges** it on the other. It separates *what is asserted* from *why*. That matters wherever a source mixes settled findings, live debate and fringe dissent, and wherever a reader has to judge how much to trust a statement.

## Instructions

1. **Put claims at the center.** A claim is a single assertion that could be true or false, phrased as a sentence: "LDL causes atherosclerosis", "High Lp(a) roughly doubles lifetime risk", "Lifelong statins look safe".
2. **Fan out from each claim:**
   - **Supports** on one side: studies, methods, datasets, expert bodies, and other claims.
   - **Challenges** on the other: contrary results, dissenting groups, failed replications.
   - Each link carries a note saying *how* it bears on the claim ("benefit tracks LDL, not the drug", "only the treatment hypothesis — not the risk").
3. **Let evidence be shared.** One source can back several claims (Mendelian randomization supports three). Show the sharing rather than duplicating the source.
4. **Leave out** mechanisms, actions and personal context. They belong to other views.
5. **Read it** claim by claim: how much supports it, what kind, and whether any challenge actually lands on the claim or only near it.

## Draws on

- **Kinds:** central Concepts are *claim*. Around them sit *source*/evidence (trials, methods, consensus statements), *person*/org (dissenting groups, sponsors), and sometimes other claims.
- **Relationship Types:** `supports`, `challenges` (evidence → claim), with notes. Claim → claim `supports` builds chains.
- **Attributes (proposed):** on claims, *consensus* (settled / contested / fringe) and *confidence*; on evidence, *type* (RCT, Mendelian randomization, cohort, imaging, review, anecdote), *date* and *size*.
- **Settings:** which claims to include (all claims, or tagged), and whether to show claim → claim chains.

## Layout & interaction

- Each claim is a prominent card. Supporting evidence fans to one side in green, challenges to the other in amber/dashed, and link notes show on hover or selection.
- With many claims, stack claim hubs vertically and draw shared evidence once, between the claims it serves.
- Selecting a piece of evidence highlights every claim it bears on. Selecting a claim dims everything else.

## Building it from a source

- Whenever the source says "studies show", "trials found", "the consensus is", "some argue", split out **the claim** and **the evidence** as separate Concepts.
- Name the evidence specifically (SAMSON, IMPROVE-IT, Lp(a)HORIZON, EAS 2017 consensus), with its date.
- Capture the *direction and scope* in the note. The statins chat's most important nuance was that the Lp(a)HORIZON miss **challenges the treatment hypothesis but not the risk association**. A bare `challenges` edge would say the opposite.
- Record dissent even when it's dismissed (THINCS). It's part of why the claim is trusted.

## In the sample graphs

- **Statins → Evidence**, rendered as a left-to-right layered graph:
  - **LDL causes atherosclerosis** is backed by Mendelian randomization, the EAS 2017 consensus, IMPROVE-IT ("benefit tracks LDL, not the drug") and the PCSK9 outcome trials, and challenged by THINCS ("fringe").
  - **High Lp(a) roughly doubles lifetime risk** is backed by Mendelian randomization and challenged by Lp(a)HORIZON, with the note "only the treatment hypothesis — not the risk".
  - **LDL can't practically be too low** is backed by the PCSK9 trials and by Mendelian randomization (PCSK9 loss-of-function carriers).
  - **Lifelong statins look safe** is backed by the West of Scotland 20-year follow-up, SAMSON (muscle symptoms mostly nocebo) and Mendelian randomization (by inference).
  - Mendelian randomization emerged as the shared backbone behind three claims. That's the most interesting thing the view revealed, and the reason to render shared evidence once.
- The layered rendering put sources left and claims right. It worked, but it didn't make the claims visually central. Hence the instruction above: **claims as hubs, fan out from them**.

## What worked / what didn't

- **Worked:**
  - Separating claims from sources.
  - Notes on the challenge edges.
  - Seeing one method underpin several claims.
- **Didn't:**
  - The claims weren't the visual center.
  - Supports and challenges weren't spatially separated.
  - There's no signal of strength (an RCT and a dissenting blog look the same).

## Open questions

- Should chat self-corrections ("I said the pool was smaller — that was wrong") be modelled as evidence challenging an earlier claim, or kept as a separate `corrects` Relationship (see the corrections fog on the map)?
- Should claims show a computed or curated verdict (settled / contested) as a badge?
- This View Type probably generalizes beyond science: the printer's "a mini split isn't ventilation" and the trip's "Region C owners don't heat pools" are claims with evidence too. Worth trying on those.

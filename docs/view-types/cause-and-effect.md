---
id: cause-and-effect
name: Cause & Effect
status: proven
answers: "What drives what — and what can I pull on to change the outcome?"
proven-in: [statins/mechanism, printer/air]
---

# Cause & Effect

A directed flow of **influence**: Concepts that **cause / raise** other Concepts, and Concepts that **block / lower** them, flowing toward the outcomes that matter. It explains a mechanism (how a statin ends up lowering LDL). It also covers **risk and mitigation**, where hazards feed a risk and actions push back on it: the same View Type seen from a practical angle.

## Instructions

1. **Put the outcomes at the end of the flow:** the thing someone cares about moving (Atherosclerotic plaque, LDL cholesterol, Air quality risk).
2. **Trace influences backward** from each outcome. What raises it? What lowers or blocks it? Then repeat for those.
3. **Keep the sign on every link.** Raise/cause is positive; lower/block/mitigate is negative. Chains compose: statins **block** the mevalonate pathway, which **raises** cholesterol, so statins lower cholesterol. The reader should be able to follow the sign.
4. **Quantify in the note** where the source does ("8–10%", "~20–25%", "irreversibly", "LDL is the remnant").
5. **Separate levers from facts of nature.** Actions and drugs are things you can pull; biology and physics are not. In risk mode, rank the levers by impact.
6. **Leave out** evidence, history and personal context.
7. **Read it** from the outcome backward to find the levers, or from a lever forward to see everything it touches.

## Draws on

- **Kinds:** *idea* (mechanisms, quantities), *thing* (drugs, materials, devices), *action* (levers), *risk* (outcomes to reduce).
- **Relationship Types:** a positive and a negative influence type: `raises`/`causes` and `lowers`/`blocks`/`mitigates`. Everything else in the view is the same.
- **Attributes:** *impact rank* on mitigations (printer air quality), and magnitudes where available.
- **Settings:** which outcomes to anchor on, how far upstream to trace, and mechanism mode vs risk mode (the latter groups actions and orders them by impact).

## Layout & interaction

- Layered flow toward the outcomes: top-down for mechanisms, left-to-right for risk.
- Edge colour carries the sign: red raises, green lowers/mitigates.
- **Trace mode:** selecting a Concept highlights everything upstream (what drives it) or downstream (what it affects), with the net sign along each path.
- In risk mode, mitigations sit in a band beside the risk, ordered by rank, so the view doubles as "what to do first".

## Building it from a source

- Look for mechanism language: "inhibits", "upregulates", "drives", "strips out", "binds", "removes".
- Look for risk language: "emits", "exposure", "the biggest lever", "in order of impact".
- Make each quantity its own Concept (LDL, Lp(a), ultrafine particles, VOCs) so influences can meet at it.
- Keep the magnitude and the caveat in the note ("statins raise Lp(a): slightly, if anything"). Without it the view overstates.
- When the source ranks interventions, record the rank as an Attribute.

## In the sample graphs

- **Statins → Mechanism** (top-down):
  - Statins **block** the mevalonate pathway ("inhibit HMG-CoA reductase"), which **raises** cholesterol (liver synthesis).
  - Statins **raise** LDL receptors ("liver upregulates"), which **lower** LDL cholesterol ("clears LDL from blood").
  - LDL, ApoB and Lp(a) all **raise** atherosclerotic plaque, which raises vulnerable plaque.
  - Diet levers feed into LDL: soluble fiber, sterols and unsaturated fat **lower** it; unfiltered coffee **raises** it.
  - Grapefruit **blocks** CYP3A4, which clears the CYP3A4-metabolised statins, explaining the interaction.
  - PCSK9 inhibitors and the Lp(a) drugs **lower** Lp(a); statins nudge it up. That's the whole "why treat LDL harder when Lp(a) is high" argument in one picture.
- **A 3D printer for the family → Air quality** (left-to-right, risk mode):
  - ABS/ASA **causes** ultrafine particles and VOCs, and PLA causes fewer. Both **cause** the Air quality risk.
  - A band of ~10 mitigation actions (placement, leave the room, let it cool, PLA/PETG only, HEPA cartridge, Bento scrubber, crack a window, purifier, distance, duct outside) **mitigates** the risk, each with an impact rank.
  - "Duct exhaust outside" expands into its build (connector, pull the carbon filter, inline booster fan, duct), and the fan options hang off it (CLOUDLINE chosen, RAXIAL fails).
  - This is the same pattern as the mechanism view, but the reader asks "what should I do?" instead of "how does it work?".

## What worked / what didn't

- **Worked:**
  - Signed, coloured edges made the mechanism legible.
  - The notes carried magnitudes.
  - The air-quality risk view read naturally as causes → risk ← mitigations.
- **Didn't:**
  - There's no trace mode, so double negatives (statins ⊣ mevalonate → cholesterol) must be worked out by eye.
  - The layered layout doesn't separate levers from biology.
  - The air view mixed the venting build (`part-of`, `prerequisite`) into the causal flow, which blurred it.

## Open questions

- Should net sign along a path be computed and shown ("statins → LDL: lowers, via 2 paths")?
- Do "risk mode" and "mechanism mode" stay one View Type with a setting, or become two View Types sharing a layout?
- Should implementation detail (how to build a mitigation) collapse into the mitigation until expanded?

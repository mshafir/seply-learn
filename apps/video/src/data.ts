// The committed fixtures, imported the way a first build imports a file
// (@seply/domain), then read as the Expedition the Views draw
// (@seply/views expeditionFromState). Deterministic: fixed clock and ids.
import { importExpeditionJson, ulidSequence } from "@seply/domain";
import { expeditionFromState, type Expedition, type View } from "@seply/views";
import ebikeFile from "@seply/domain/fixtures/ebike.json";
import tripFile from "@seply/domain/fixtures/trip.json";

const T0 = Date.parse("2026-09-01T00:00:00Z");

export type Fixture = {
  expedition: Expedition;
  /** A Concept's id, from its id in the file. */
  concept: (fileId: string) => string;
  /** A View, from its id in the file. */
  view: (fileId: string) => View;
};

function open(file: unknown, expeditionId: string): Fixture {
  const newId = ulidSequence(T0);
  const imported = importExpeditionJson(file, {
    expeditionId,
    actor: "video",
    changeId: newId(),
    nextOpId: ulidSequence(T0 - 60_000),
    newId,
    at: new Date(T0).toISOString(),
  });
  const expedition = expeditionFromState(imported.state);
  const concept = (fileId: string) => {
    const id = imported.ids.concepts.get(fileId);
    if (!id) throw new Error(`no Concept "${fileId}" in ${expeditionId}`);
    return id;
  };
  const view = (fileId: string) => {
    const id = imported.ids.views.get(fileId);
    const v = expedition.views.find((x) => x.id === id);
    if (!v) throw new Error(`no View "${fileId}" in ${expeditionId}`);
    return v;
  };
  return { expedition, concept, view };
}

export const ebike = open(ebikeFile, "video-ebike");
export const trip = open(tripFile, "video-trip");

/** The agent's suggestion in scene 5: a Concept and the Relationship that places it. */
export const SUGGESTED_ID = "suggested-torque-sensor";
export const suggestedRelationship = {
  from: SUGGESTED_ID,
  type: "builtin:prerequisite",
  to: ebike.concept("hills"),
};
export const suggestedKey = `${suggestedRelationship.from}|${suggestedRelationship.type}|${suggestedRelationship.to}`;

/**
 * The e-bike Expedition with the pending suggestion applied, as the app
 * previews a Proposal (spec 3.8): the Views draw it dashed in `--suggested`.
 */
export const ebikeWithSuggestion: Expedition = {
  ...ebike.expedition,
  concepts: [
    ...ebike.expedition.concepts,
    {
      id: SUGGESTED_ID,
      title: "Torque sensor",
      kind: "builtin:idea",
      tags: [],
      summary: "Assists in step with how hard you pedal, which keeps steep starts smooth.",
    },
  ],
  relationships: [...ebike.expedition.relationships, suggestedRelationship],
};

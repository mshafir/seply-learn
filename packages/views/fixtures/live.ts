// Live fixtures: an Expedition file imported the way a first build is
// (@seply/domain's importExpeditionJson), loaded into an @seply/sync op
// engine, and exposed as its TanStack DB collections. Tests and the harness
// read the Views from these, as the app does. Deterministic: fixed clock,
// sequential ULIDs.
import { importExpeditionJson, makeOps, ulidSequence, type ImportIdMap, type OpBody } from "@seply/domain";
import { createEngineCollections, OpEngine, type EngineCollections } from "@seply/sync";
import { computeRiskView } from "./index.ts";

const T0 = Date.parse("2026-09-01T00:00:00Z");
let opened = 0;

export type LiveFixture = {
  engine: OpEngine;
  collections: EngineCollections;
  /** Old id (as written in the file) → the id the import minted. */
  ids: ImportIdMap;
  /** A Concept's minted id, from its id in the file. */
  concept: (fileId: string) => string;
  /** A View's minted id, from its id in the file. */
  view: (fileId: string) => string;
  /**
   * Another tab's edit arriving by pull: the bodies as confirmed ops from
   * someone else, received by the engine (which rebases our pending ops).
   */
  pull: (bodies: OpBody[]) => void;
  dispose: () => void;
};

/**
 * The compute sample's economics View in risk mode (fixtures/index.ts
 * `computeRiskView`), as a View of the live Expedition: the op that creates
 * it, with the imported ids.
 */
export function computeRiskViewOp(f: LiveFixture): OpBody {
  const v = computeRiskView;
  if (v.viewType !== "cause-and-effect") throw new Error("computeRiskView is a Cause & Effect View");
  const { id, label, description, settings } = v;
  return {
    kind: "view.create",
    target: id,
    value: {
      viewType: "cause-and-effect",
      label,
      ...(description ? { question: description } : {}),
      orderKey: "zz",
      settings: {
        ...settings,
        positive: settings.positive.map((t) => `builtin:${t}`),
        negative: settings.negative.map((t) => `builtin:${t}`),
        outcomes: settings.outcomes.map(f.concept),
      },
      settingsVersion: 1,
      status: "ready",
    },
  };
}

/** Imports an Expedition file and opens live collections over it. */
export function openLiveFixture(file: unknown, opts: { expeditionId?: string; actor?: string } = {}): LiveFixture {
  const expeditionId = opts.expeditionId ?? "exp-fixture";
  const actor = opts.actor ?? "reader";
  const newId = ulidSequence(T0);
  const imported = importExpeditionJson(file, {
    expeditionId,
    actor,
    changeId: newId(),
    nextOpId: ulidSequence(T0 - 60_000),
    newId,
    at: new Date(T0).toISOString(),
  });
  const engine = new OpEngine(imported.state, { actor, now: () => T0 + 60_000 }, imported.ops.length);
  const collections = createEngineCollections(engine, { id: `fixture${++opened}` });

  let seq = imported.ops.length;
  const remoteOpId = ulidSequence(T0 + 120_000);
  const pull = (bodies: OpBody[]) => {
    const ops = makeOps(bodies, { expeditionId, actor: "another-tab", changeId: remoteOpId(), nextOpId: remoteOpId });
    engine.receive(ops.map((op) => ({ ...op, serverSeq: ++seq })));
  };
  const lookup = (map: Map<string, string>, kind: string) => (fileId: string) => {
    const id = map.get(fileId);
    if (!id) throw new Error(`no ${kind} "${fileId}" in the fixture`);
    return id;
  };

  return {
    engine,
    collections,
    ids: imported.ids,
    concept: lookup(imported.ids.concepts, "Concept"),
    view: lookup(imported.ids.views, "View"),
    pull,
    dispose: () => collections.dispose(),
  };
}

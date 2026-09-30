// Live data for the Views: one Expedition's TanStack DB collections
// (@seply/sync), read as the Expedition the Views draw.
//
// Every change to the collections (a local edit, optimistic or confirmed, or
// someone else's edit arriving by pull) bumps a version; the Expedition is
// rebuilt once per render from the collections' current rows. A pull that
// touches several tables notifies once per table in the same tick, and React
// batches those into one render, so the canvas re-lays out once.
import { useMemo, useSyncExternalStore } from "react";
import type { TableCollections } from "@seply/sync";
import { expeditionFromRows } from "./data.ts";
import type { Expedition } from "./model.ts";

/** The collections the Views read (a subset of `createEngineCollections`'s). */
export type ExpeditionCollections = Pick<
  TableCollections,
  "expeditions" | "concepts" | "relationships" | "kindDefs" | "relTypeDefs" | "attributeDefs" | "views"
>;

const TABLES = ["expeditions", "concepts", "relationships", "kindDefs", "relTypeDefs", "attributeDefs", "views"] as const;

/** A version that changes whenever any of the collections does. */
function versionStore(collections: ExpeditionCollections) {
  let version = 0;
  return {
    subscribe(onChange: () => void) {
      // With `includeInitialState`, the subscription has "seen" every row, so
      // it is told about deletes too (without it, TanStack DB drops deletes of
      // rows it never sent). The initial rows arrive during the call; they are
      // what the first read already has, so they don't count as a change.
      let subscribing = true;
      const subs = TABLES.map((t) =>
        collections[t].subscribeChanges(
          () => {
            if (subscribing) return;
            version++;
            onChange();
          },
          { includeInitialState: true },
        ),
      );
      subscribing = false;
      return () => subs.forEach((s) => s.unsubscribe());
    },
    getSnapshot: () => version,
  };
}

/** The rows of the collections as they are now, as the Expedition the Views draw. */
export function readExpedition(collections: ExpeditionCollections): Expedition {
  return expeditionFromRows({
    expedition: collections.expeditions.values().next().value,
    concepts: collections.concepts.values(),
    relationships: collections.relationships.values(),
    kindDefs: collections.kindDefs.values(),
    relTypeDefs: collections.relTypeDefs.values(),
    attributeDefs: collections.attributeDefs.values(),
    views: collections.views.values(),
  });
}

/**
 * The live Expedition: re-read whenever the collections change, and the same
 * object between changes (so layouts don't re-run on unrelated renders).
 */
export function useLiveExpedition(collections: ExpeditionCollections): Expedition {
  const store = useMemo(() => versionStore(collections), [collections]);
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
  return useMemo(() => readExpedition(collections), [collections, version]);
}

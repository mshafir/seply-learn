// The Expedition screen's live data: one live query per sync collection.
// Every edit (local, pulled, or rebased) re-renders what reads it.
import { useLiveQuery } from "@tanstack/react-db"
import type {
  ArticleSectionRow,
  AttributeDefRow,
  ConceptRow,
  EngineCollections,
  ExpeditionRow,
  KindDefRow,
  RelationshipRow,
  RelTypeDefRow,
  SourceRow,
  ViewRow,
} from "@umbel/sync"

/** Live rows of one Expedition (domain types; tombstoned entities are absent). */
export type ExpeditionData = {
  expedition: ExpeditionRow | undefined
  concepts: ConceptRow[]
  relationships: RelationshipRow[]
  articleSections: ArticleSectionRow[]
  kindDefs: KindDefRow[]
  relTypeDefs: RelTypeDefRow[]
  attributeDefs: AttributeDefRow[]
  /** In rail order (`orderKey`). */
  views: ViewRow[]
  sources: SourceRow[]
}

const byOrderKey = (a: ViewRow, b: ViewRow) =>
  a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0

export function useExpeditionData(c: EngineCollections): ExpeditionData {
  const expeditions = useLiveQuery(() => c.expeditions, [c]).data
  const concepts = useLiveQuery(() => c.concepts, [c]).data
  const relationships = useLiveQuery(() => c.relationships, [c]).data
  const articleSections = useLiveQuery(() => c.articleSections, [c]).data
  const kindDefs = useLiveQuery(() => c.kindDefs, [c]).data
  const relTypeDefs = useLiveQuery(() => c.relTypeDefs, [c]).data
  const attributeDefs = useLiveQuery(() => c.attributeDefs, [c]).data
  const views = useLiveQuery(() => c.views, [c]).data
  const sources = useLiveQuery(() => c.sources, [c]).data

  return {
    expedition: expeditions?.[0],
    concepts: concepts ?? [],
    relationships: relationships ?? [],
    articleSections: articleSections ?? [],
    kindDefs: kindDefs ?? [],
    relTypeDefs: relTypeDefs ?? [],
    attributeDefs: attributeDefs ?? [],
    views: [...(views ?? [])].sort(byOrderKey),
    sources: sources ?? [],
  }
}

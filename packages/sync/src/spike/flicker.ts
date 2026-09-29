// Spike tooling (WP-0.5): records every value a row shows, change event by
// change event, and finds flicker: a row going back to a value it had
// already moved past (optimistic → old → confirmed).
//
// Change events are finer than renders: React batches events into one render,
// so a clean event stream implies clean renders, not the other way round.

export type Observable<T> = {
  subscribeChanges: (
    cb: (
      changes: Array<{ type: string; key: string | number; value: T }>
    ) => void,
    opts?: { includeInitialState?: boolean }
  ) => { unsubscribe: () => void }
}

export class Recorder<T extends object, V> {
  /** Every value each key showed, in order; `undefined` = row absent. */
  readonly timelines = new Map<string, Array<V | undefined>>()
  private readonly sub: { unsubscribe: () => void }

  constructor(
    source: Observable<T>,
    private readonly select: (row: T) => V
  ) {
    this.sub = source.subscribeChanges(
      (changes) => {
        for (const c of changes) {
          const key = String(c.key)
          const list = this.timelines.get(key) ?? []
          list.push(c.type === "delete" ? undefined : this.select(c.value))
          this.timelines.set(key, list)
        }
      },
      { includeInitialState: true }
    )
  }

  timeline(key: string): Array<V | undefined> {
    return this.timelines.get(key) ?? []
  }

  stop(): void {
    this.sub.unsubscribe()
  }
}

export type Flicker<V> = { at: number; value: V | undefined; reason: string }

/**
 * Checks a timeline against the order values are meant to appear in. Values
 * may be skipped or repeated, but never go back to an earlier one, and never
 * show a value outside `order`.
 */
export function findFlicker<V>(
  timeline: ReadonlyArray<V | undefined>,
  order: ReadonlyArray<V | undefined>
): Flicker<V>[] {
  const found: Flicker<V>[] = []
  let high = 0
  timeline.forEach((value, at) => {
    const i = order.indexOf(value, high)
    if (i >= 0) high = i
    else if (order.includes(value))
      found.push({ at, value, reason: `went back to ${JSON.stringify(value)}` })
    else found.push({ at, value, reason: "value never meant to show" })
  })
  return found
}

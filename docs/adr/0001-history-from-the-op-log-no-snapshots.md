# History comes from the operation log alone; no Snapshots

Every shared edit to an Expedition is already an operation in its per-Expedition log, so v1 drops the planned **Snapshots** (named frozen copies). History is a list of **Changes** (groups of operations with one author and purpose). Undo, "view as of" and "restore to here" work from the log, and restoring appends inverse operations rather than rewinding. Public and unlisted links always show the latest state. Anyone who wants a stable, separate copy **Forks** the Expedition.

## Considered Options

- **Snapshot = log position + frozen JSON copy in object storage** (the earlier plan): fast public links pinned to a frozen state, but it needs a second storage path, auto-Snapshots before bulk changes, and a Snapshot diff UI, all of which the log and Fork already cover.
- **Snapshot = log position only**: cheap, but it adds a concept without adding a capability.

## Consequences

- Public readers see edits as they happen, including half-finished ones and Views still building. A stable public version means a Fork.
- "View as of" replays the log (with caching if needed), so log replay must stay fast and operations carry a schema version for upgrading.
- Reintroducing named, frozen versions later is additive (a named Change position), but public-link semantics would change.

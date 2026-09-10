import type { Schema } from './schema'

/**
 * Merge a freshly parsed schema (`next`, with brand-new ids) into the current schema (`prev`),
 * preserving ids of tables/columns/refs/enums that match so that node positions and selection survive.
 * Matching order: id (if next already carries prev ids) -> name path -> rename heuristic
 * (same table with identical column count and exactly one column name changed => rename).
 *
 * OWNER: worker-1 (core-dbml). This stub returns `next` unchanged.
 */
export function reconcile(prev: Schema, next: Schema): Schema {
  void prev
  return next
}

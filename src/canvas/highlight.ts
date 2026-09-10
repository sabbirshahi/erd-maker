/**
 * M5 hover/focus highlighting. Given an anchor (a hovered/pinned table or ref) compute
 * exactly the tables and refs that should carry the `highlighted` class.
 */
import type { Schema } from '@/core/schema'

export type Anchor = { kind: 'table'; id: string } | { kind: 'ref'; id: string }

export interface HighlightSets {
  tables: Set<string>
  refs: Set<string>
}

export const emptyHighlight = (): HighlightSets => ({ tables: new Set(), refs: new Set() })

export function computeHighlight(schema: Schema, anchor: Anchor | null): HighlightSets {
  const out = emptyHighlight()
  if (!anchor) return out
  if (anchor.kind === 'table') {
    out.tables.add(anchor.id)
    for (const r of schema.refs) {
      if (r.from.tableId === anchor.id || r.to.tableId === anchor.id) {
        out.refs.add(r.id)
        out.tables.add(r.from.tableId)
        out.tables.add(r.to.tableId)
      }
    }
  } else {
    const r = schema.refs.find((x) => x.id === anchor.id)
    if (r) {
      out.refs.add(r.id)
      out.tables.add(r.from.tableId)
      out.tables.add(r.to.tableId)
    }
  }
  return out
}

/** Table ids directly connected to `tableId` (including itself). */
export const neighbourTableIds = (schema: Schema, tableId: string): string[] => [
  ...computeHighlight(schema, { kind: 'table', id: tableId }).tables,
]

export const sameAnchor = (a: Anchor | null, b: Anchor | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id)

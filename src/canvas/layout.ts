/**
 * Layout helpers: size estimation, grid placement for tables that have no saved
 * position, and the elkjs "layered" adapter used by Auto-layout. Pure TypeScript.
 */
import type { ElkNode } from 'elkjs/lib/elk-api'
import { fkSide, type Layout, type Schema, type Table } from '@/core/schema'

export interface Size {
  width: number
  height: number
}

export const NODE_WIDTH = 240
export const HEADER_HEIGHT = 36
export const ROW_HEIGHT = 26
export const GAP_X = 80
export const GAP_Y = 60

export type SizeLookup = (table: Table) => Size

/** Deterministic size guess used before the DOM has measured a node. */
export function estimateTableSize(table: Table): Size {
  const longest = table.columns.reduce(
    (m, c) => Math.max(m, c.name.length + c.type.length + 8),
    table.name.length + 6,
  )
  const width = Math.min(420, Math.max(NODE_WIDTH, 8 * longest + 40))
  const height = HEADER_HEIGHT + ROW_HEIGHT * Math.max(1, table.columns.length) + 8
  return { width, height }
}

export interface GridOptions {
  origin?: { x: number; y: number }
  columns?: number
  gapX?: number
  gapY?: number
}

/** Place tables in rows of `columns` cells; each row is as tall as its tallest table. */
export function gridLayout(tables: Table[], sizes: SizeLookup = estimateTableSize, opts: GridOptions = {}): Layout {
  const origin = opts.origin ?? { x: 0, y: 0 }
  const columns = Math.max(1, opts.columns ?? Math.ceil(Math.sqrt(tables.length)))
  const gapX = opts.gapX ?? GAP_X
  const gapY = opts.gapY ?? GAP_Y
  const out: Layout = {}
  let x = origin.x
  let y = origin.y
  let rowHeight = 0
  tables.forEach((t, i) => {
    const size = sizes(t)
    if (i > 0 && i % columns === 0) {
      x = origin.x
      y += rowHeight + gapY
      rowHeight = 0
    }
    out[t.id] = { x, y }
    x += size.width + gapX
    rowHeight = Math.max(rowHeight, size.height)
  })
  return out
}

/** Bounding box of the positioned tables (undefined when nothing is positioned). */
export function layoutBounds(
  schema: Schema,
  layout: Layout,
  sizes: SizeLookup = estimateTableSize,
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let b: { minX: number; minY: number; maxX: number; maxY: number } | undefined
  for (const t of schema.tables) {
    const p = layout[t.id]
    if (!p) continue
    const s = sizes(t)
    b = b
      ? {
          minX: Math.min(b.minX, p.x),
          minY: Math.min(b.minY, p.y),
          maxX: Math.max(b.maxX, p.x + s.width),
          maxY: Math.max(b.maxY, p.y + s.height),
        }
      : { minX: p.x, minY: p.y, maxX: p.x + s.width, maxY: p.y + s.height }
  }
  return b
}

/**
 * Positions for tables missing from `layout`, placed in a grid below the existing
 * diagram (or at the origin when the diagram is empty). Returns only the new entries.
 */
export function placeUnpositioned(schema: Schema, layout: Layout, sizes: SizeLookup = estimateTableSize): Layout {
  const missing = schema.tables.filter((t) => !layout[t.id])
  if (missing.length === 0) return {}
  const bounds = layoutBounds(schema, layout, sizes)
  const origin = bounds ? { x: bounds.minX, y: bounds.maxY + GAP_Y } : { x: 0, y: 0 }
  return gridLayout(missing, sizes, { origin, columns: Math.max(3, Math.ceil(Math.sqrt(missing.length))) })
}

/** Build the elk graph: one node per table, one edge per ref (FK table -> referenced table). */
export function buildElkGraph(schema: Schema, sizes: SizeLookup = estimateTableSize): ElkNode {
  const ids = new Set(schema.tables.map((t) => t.id))
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(GAP_Y),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(GAP_X),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: schema.tables.map((t) => {
      const s = sizes(t)
      return { id: t.id, width: s.width, height: s.height }
    }),
    edges: schema.refs
      .filter((r) => r.from.tableId !== r.to.tableId && ids.has(r.from.tableId) && ids.has(r.to.tableId))
      .map((r) => {
        const { fk, target } = fkSide(r)
        return { id: r.id, sources: [fk.tableId], targets: [target.tableId] }
      }),
  }
}

export function elkResultToLayout(root: ElkNode): Layout {
  const out: Layout = {}
  for (const c of root.children ?? []) {
    out[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }
  }
  return out
}

export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>
}

let elkInstance: Promise<ElkLike> | undefined

/** Lazily create the elk engine (bundled build, main thread; ~1.4 MB, its own chunk). */
export function getElk(): Promise<ElkLike> {
  if (!elkInstance) {
    elkInstance = import('elkjs/lib/elk.bundled.js').then((m) => new m.default() as unknown as ElkLike)
  }
  return elkInstance
}

/** Layered layout for the whole schema. Falls back to a grid when elk fails. */
export async function elkLayout(
  schema: Schema,
  sizes: SizeLookup = estimateTableSize,
  engine?: ElkLike,
): Promise<Layout> {
  if (schema.tables.length === 0) return {}
  try {
    const elk = engine ?? (await getElk())
    const result = await elk.layout(buildElkGraph(schema, sizes))
    const layout = elkResultToLayout(result)
    // elk drops nothing, but guard against a missing node anyway
    const missing = placeUnpositioned(schema, layout, sizes)
    return { ...layout, ...missing }
  } catch {
    return gridLayout(schema.tables, sizes)
  }
}

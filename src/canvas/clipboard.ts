/**
 * Copy / cut / paste / duplicate for canvas selections. Pure schema transforms plus a small
 * in-memory clipboard, so the keyboard layer stays thin and this is unit-testable.
 *
 * Tables are copied with their columns, indexes and Django metadata. A relation is carried along
 * only when both of its endpoints are in the selection, which keeps a pasted group self-consistent
 * instead of inventing references to tables the user did not copy.
 */
import { newId, type Layout, type Ref, type Schema, type Table } from '@/core/schema'
import { uniqueName } from './mutations'

export interface ClipboardPayload {
  tables: Table[]
  refs: Ref[]
  /** Positions of the copied tables, used to keep their relative arrangement on paste. */
  layout: Layout
}

/** Extract the given tables (and any relation fully inside the set) as a clipboard payload. */
export function copySelection(schema: Schema, layout: Layout, tableIds: readonly string[]): ClipboardPayload | null {
  const ids = new Set(tableIds)
  const tables = schema.tables.filter((t) => ids.has(t.id))
  if (tables.length === 0) return null
  const refs = schema.refs.filter((r) => ids.has(r.from.tableId) && ids.has(r.to.tableId))
  const picked: Layout = {}
  for (const t of tables) if (layout[t.id]) picked[t.id] = { ...layout[t.id] }
  return { tables: structuredClone(tables), refs: structuredClone(refs), layout: picked }
}

export interface PasteResult {
  /** New table ids in payload order, so the caller can select them. */
  tableIds: string[]
  /** Positions for the new tables. */
  layout: Layout
}

/**
 * Insert a payload into `draft`, giving everything fresh ids and non-clashing table names.
 * `offset` shifts the pasted copy so it does not land exactly on top of the original.
 */
export function pasteInto(draft: Schema, payload: ClipboardPayload, offset = { x: 40, y: 40 }): PasteResult {
  const tableIds: string[] = []
  const layout: Layout = {}
  // old id -> new id, for tables and for every column, so relations and indexes can be remapped.
  const tableMap = new Map<string, string>()
  const columnMap = new Map<string, string>()

  for (const source of payload.tables) {
    const table: Table = structuredClone(source)
    const oldTableId = table.id
    table.id = newId()
    table.name = uniqueName(
      draft.tables.map((t) => t.name),
      source.name,
    )
    for (const col of table.columns) {
      const oldColumnId = col.id
      col.id = newId()
      columnMap.set(oldColumnId, col.id)
    }
    for (const index of table.indexes) {
      index.id = newId()
      index.columnIds = index.columnIds.map((id) => columnMap.get(id) ?? id)
    }
    tableMap.set(oldTableId, table.id)
    draft.tables.push(table)
    tableIds.push(table.id)

    const at = payload.layout[oldTableId]
    if (at) layout[table.id] = { x: at.x + offset.x, y: at.y + offset.y }
  }

  for (const source of payload.refs) {
    const from = tableMap.get(source.from.tableId)
    const to = tableMap.get(source.to.tableId)
    if (!from || !to) continue
    draft.refs.push({
      ...structuredClone(source),
      id: newId(),
      // A copied relation keeps its own name only if DBML would not clash; drop it to stay safe.
      name: undefined,
      from: { tableId: from, columnIds: source.from.columnIds.map((id) => columnMap.get(id) ?? id) },
      to: { tableId: to, columnIds: source.to.columnIds.map((id) => columnMap.get(id) ?? id) },
    })
  }

  return { tableIds, layout }
}

/**
 * The selected tables as a standalone schema: enums and project settings are carried over, and a
 * relation is kept only when both of its endpoints are in the selection.
 */
export function schemaSubset(schema: Schema, tableIds: readonly string[]): Schema {
  const ids = new Set(tableIds)
  const tables = schema.tables.filter((t) => ids.has(t.id))
  const refs = schema.refs.filter((r) => ids.has(r.from.tableId) && ids.has(r.to.tableId))
  // Keep only the enums the surviving columns actually use, so the export has no dangling types.
  const used = new Set(tables.flatMap((t) => t.columns.map((c) => c.type.replace(/^.*\./, ''))))
  return {
    project: schema.project,
    tables: structuredClone(tables),
    refs: structuredClone(refs),
    enums: structuredClone(schema.enums.filter((e) => used.has(e.name))),
  }
}

/** Human-readable summary for the toast after a clipboard action. */
export function describePayload(payload: ClipboardPayload): string {
  const t = payload.tables.length
  const r = payload.refs.length
  const tables = `${t} table${t === 1 ? '' : 's'}`
  return r > 0 ? `${tables} and ${r} relation${r === 1 ? '' : 's'}` : tables
}

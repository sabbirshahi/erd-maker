/**
 * Pure draft mutators used by the toolbar and inspector (run inside `update('canvas', …)`).
 */
import { newColumn, newIdColumn, newTable, type Column, type Schema, type Table } from '@/core/schema'

export function uniqueName(existing: Iterable<string>, base: string): string {
  const taken = new Set(existing)
  let n = 1
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export const uniqueTableName = (s: Schema): string =>
  uniqueName(
    s.tables.map((t) => t.name),
    'table',
  )

export const uniqueColumnName = (t: Table): string =>
  uniqueName(
    t.columns.map((c) => c.name),
    'column',
  )

/** Adds a table with an `id` column; returns it so callers can position/select it. */
export function addTable(d: Schema, name = uniqueTableName(d)): Table {
  const t = newTable({ name, columns: [newIdColumn()] })
  d.tables.push(t)
  return t
}

export function addColumn(d: Schema, tableId: string, partial?: Partial<Column>): Column | undefined {
  const t = d.tables.find((x) => x.id === tableId)
  if (!t) return undefined
  const c = newColumn({ name: uniqueColumnName(t), ...partial })
  t.columns.push(c)
  return c
}

export function removeColumn(d: Schema, tableId: string, columnId: string): void {
  const t = d.tables.find((x) => x.id === tableId)
  if (!t) return
  t.columns = t.columns.filter((c) => c.id !== columnId)
  t.indexes = t.indexes
    .map((i) => ({ ...i, columnIds: i.columnIds.filter((c) => c !== columnId) }))
    .filter((i) => i.columnIds.length > 0)
  d.refs = d.refs.filter(
    (r) =>
      !(r.from.tableId === tableId && r.from.columnIds.includes(columnId)) &&
      !(r.to.tableId === tableId && r.to.columnIds.includes(columnId)),
  )
}

export function removeTable(d: Schema, tableId: string): void {
  d.tables = d.tables.filter((t) => t.id !== tableId)
  d.refs = d.refs.filter((r) => r.from.tableId !== tableId && r.to.tableId !== tableId)
}

export function removeRef(d: Schema, refId: string): void {
  d.refs = d.refs.filter((r) => r.id !== refId)
}

/** Move the column at `from` to index `to` (clamped). */
export function moveColumn(d: Schema, tableId: string, from: number, to: number): void {
  const t = d.tables.find((x) => x.id === tableId)
  if (!t || from < 0 || from >= t.columns.length) return
  const target = Math.max(0, Math.min(t.columns.length - 1, to))
  if (from === target) return
  const [c] = t.columns.splice(from, 1)
  t.columns.splice(target, 0, c)
}

/** A column is "blank" when the user has not typed anything meaningful into it yet. */
export const isBlankColumn = (c: Column): boolean =>
  c.name.trim() === '' && !c.pk && !c.unique && !c.notNull && !c.increment && !c.default && !c.note

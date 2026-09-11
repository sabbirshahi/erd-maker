/**
 * Seeded fake dataset generator for the demo. Pure TypeScript (no DOM). OWNER: worker-5 (demo).
 *
 * Guarantees: tables in FK-safe order, FK values drawn from generated parent rows, unique and
 * composite-unique columns deduplicated, not-null honoured, enum columns drawn from the enum,
 * `increment` primary keys 1..N, one-to-one FKs unique, and join rows for `<>` refs.
 */
import { faker } from '@faker-js/faker/locale/en'
import type { Column, Ref, Schema, Table } from '../schema'
import { findEnumByName, fkSide, primaryKeyColumnIds, topologicalTables } from '../schema'
import { parseType, uniqueFallback, valueForColumn, type ParsedType } from './heuristics'

export interface FakeTable {
  tableId: string
  /** SQL table name (schema qualifier dropped — SQLite has a single namespace). */
  name: string
  columns: string[]
  rows: unknown[][]
}

/** Join rows for a many-to-many (`<>`) ref. The runtime maps this onto Django's through table. */
export interface FakeJoin {
  refId: string
  /** SQL table names of the two endpoints as written in the ref (`from <> to`). */
  fromTable: string
  toTable: string
  /** Column names of the primary keys the pairs refer to. */
  fromColumn: string
  toColumn: string
  /** Distinct [fromPk, toPk] pairs. */
  rows: [unknown, unknown][]
}

export interface FakeDataset {
  /** Tables in FK-safe insert order (parents first). */
  tables: FakeTable[]
  joins: FakeJoin[]
  seed: number
}

export const MIN_ROWS = 1
export const MAX_ROWS = 200
export const DEFAULT_ROWS = 25

interface FkInfo {
  ref: Ref
  targetTableId: string
  targetColumnId: string
  /** One-to-one refs must not reuse a parent row. */
  unique: boolean
}

const UNIQUE_RETRIES = 25
const NULL_RATE = 0.12

const key = (tableId: string, columnId: string): string => `${tableId}\u0000${columnId}`

function enumValuesFor(schema: Schema, col: Column): string[] | undefined {
  const raw = col.type.trim()
  const e = findEnumByName(schema, raw) ?? findEnumByName(schema, raw.split('.').pop() ?? raw)
  return e?.values.map((v) => v.name)
}

/** Which columns carry a FK, and where it points. */
function fkColumns(schema: Schema): Map<string, FkInfo> {
  const out = new Map<string, FkInfo>()
  for (const ref of schema.refs) {
    if (ref.kind === '<>') continue
    const { fk, target } = fkSide(ref)
    fk.columnIds.forEach((colId, i) => {
      const targetColumnId = target.columnIds[i] ?? target.columnIds[0]
      if (!targetColumnId) return
      out.set(key(fk.tableId, colId), {
        ref,
        targetTableId: target.tableId,
        targetColumnId,
        unique: ref.kind === '-',
      })
    })
  }
  return out
}

/**
 * Generate a fake dataset for every table of the schema.
 * Deterministic for a given (schema, rowsPerTable, seed).
 */
export async function generateFakeData(
  schema: Schema,
  rowsPerTable: number = DEFAULT_ROWS,
  seed = 42,
): Promise<FakeDataset> {
  const n = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(rowsPerTable) || DEFAULT_ROWS))
  faker.seed(seed)

  const fks = fkColumns(schema)
  /** Every generated column value, for FK sampling: tableId+columnId -> values by row index. */
  const values = new Map<string, unknown[]>()
  const tables: FakeTable[] = []

  for (const table of topologicalTables(schema)) {
    const pkIds = new Set(primaryKeyColumnIds(table))
    const parsed = new Map<string, ParsedType>()
    const enums = new Map<string, string[] | undefined>()
    for (const c of table.columns) {
      const ev = enumValuesFor(schema, c)
      enums.set(c.id, ev)
      parsed.set(c.id, parseType(c.type, ev !== undefined))
    }
    const uniqueIds = new Set(table.columns.filter((c) => c.unique || (c.pk && pkIds.size === 1)).map((c) => c.id))
    const compositeUnique = table.indexes
      .filter((i) => (i.unique || i.pk) && i.columnIds.length > 1)
      .map((i) => i.columnIds)
    const seenUnique = new Map<string, Set<string>>()
    for (const id of uniqueIds) seenUnique.set(id, new Set())
    const seenComposite = compositeUnique.map(() => new Set<string>())
    const colValues = new Map<string, unknown[]>()
    for (const c of table.columns) colValues.set(c.id, [])
    /** Per one-to-one ref: parent indices already used. */
    const usedParents = new Map<string, Set<number>>()

    const rows: unknown[][] = []
    for (let i = 0; i < n; i++) {
      let row: unknown[] = []
      for (let attempt = 0; attempt <= UNIQUE_RETRIES; attempt++) {
        row = generateRow(table, i, attempt, {
          schema, parsed, enums, pkIds, uniqueIds, seenUnique, fks, values, colValues, usedParents,
        })
        const collides = compositeUnique.some((ids, k) => {
          const sig = JSON.stringify(ids.map((id) => row[table.columns.findIndex((c) => c.id === id)]))
          return seenComposite[k].has(sig)
        })
        if (!collides) break
      }
      compositeUnique.forEach((ids, k) => {
        seenComposite[k].add(JSON.stringify(ids.map((id) => row[table.columns.findIndex((c) => c.id === id)])))
      })
      table.columns.forEach((c, ci) => {
        colValues.get(c.id)!.push(row[ci])
        if (uniqueIds.has(c.id)) seenUnique.get(c.id)!.add(JSON.stringify(row[ci]))
      })
      rows.push(row)
    }

    for (const c of table.columns) values.set(key(table.id, c.id), colValues.get(c.id)!)
    tables.push({ tableId: table.id, name: table.name, columns: table.columns.map((c) => c.name), rows })
  }

  const joins = generateJoins(schema, values, n)
  return { tables, joins, seed }
}

interface RowContext {
  schema: Schema
  parsed: Map<string, ParsedType>
  enums: Map<string, string[] | undefined>
  pkIds: Set<string>
  uniqueIds: Set<string>
  seenUnique: Map<string, Set<string>>
  fks: Map<string, FkInfo>
  values: Map<string, unknown[]>
  colValues: Map<string, unknown[]>
  usedParents: Map<string, Set<number>>
}

function generateRow(table: Table, i: number, rowAttempt: number, ctx: RowContext): unknown[] {
  const row: unknown[] = new Array(table.columns.length).fill(null)
  /** Parent row index chosen per ref so composite FKs stay consistent. */
  const parentIdx = new Map<string, number | null>()

  // Pass 1: plain columns (pk first so self-references can fall back to it).
  table.columns.forEach((col, ci) => {
    if (ctx.fks.has(key(table.id, col.id))) return
    row[ci] = plainValue(table, col, i, rowAttempt, ctx)
  })

  // Pass 2: FK columns.
  table.columns.forEach((col, ci) => {
    const fk = ctx.fks.get(key(table.id, col.id))
    if (!fk) return
    const selfRef = fk.targetTableId === table.id
    const parentValues = selfRef
      ? ctx.colValues.get(fk.targetColumnId) ?? []
      : ctx.values.get(key(fk.targetTableId, fk.targetColumnId)) ?? []
    const nullable = !col.notNull && !col.pk
    if (!parentIdx.has(fk.ref.id)) {
      parentIdx.set(fk.ref.id, pickParent(fk, parentValues.length, nullable, ctx))
    }
    const idx = parentIdx.get(fk.ref.id)!
    if (idx === null) {
      // No parent available: self-reference points at this row's own pk when not nullable.
      if (!nullable && selfRef) {
        const targetCi = table.columns.findIndex((c) => c.id === fk.targetColumnId)
        row[ci] = targetCi >= 0 ? row[targetCi] : null
      } else if (!nullable) {
        row[ci] = fallbackParentless(col, ctx.parsed.get(col.id)!)
      } else {
        row[ci] = null
      }
      return
    }
    row[ci] = parentValues[idx]
  })
  return row
}

function pickParent(fk: FkInfo, count: number, nullable: boolean, ctx: RowContext): number | null {
  if (count === 0) return null
  if (nullable && faker.datatype.boolean(NULL_RATE)) return null
  if (fk.unique) {
    let used = ctx.usedParents.get(fk.ref.id)
    if (!used) {
      used = new Set()
      ctx.usedParents.set(fk.ref.id, used)
    }
    const free: number[] = []
    for (let k = 0; k < count; k++) if (!used.has(k)) free.push(k)
    if (free.length === 0) return nullable ? null : faker.number.int({ min: 0, max: count - 1 })
    const pick = faker.helpers.arrayElement(free)
    used.add(pick)
    return pick
  }
  return faker.number.int({ min: 0, max: count - 1 })
}

/** A FK column whose parent table has no rows yet (cycle): emit a plausible scalar. */
function fallbackParentless(col: Column, parsed: ParsedType): unknown {
  void col
  return parsed.category === 'int' ? 1 : parsed.category === 'uuid' ? faker.string.uuid() : '1'
}

function plainValue(table: Table, col: Column, i: number, rowAttempt: number, ctx: RowContext): unknown {
  const parsed = ctx.parsed.get(col.id)!
  const enumValues = ctx.enums.get(col.id)
  const isPk = ctx.pkIds.has(col.id)
  if (isPk && col.increment) return i + 1
  if (isPk && parsed.category === 'int' && ctx.pkIds.size === 1) return i + 1
  const nullable = !col.notNull && !isPk && !col.unique
  if (nullable && faker.datatype.boolean(NULL_RATE)) return null

  const unique = ctx.uniqueIds.has(col.id)
  if (!unique) return valueForColumn(col, table, parsed, enumValues)

  const seen = ctx.seenUnique.get(col.id)!
  let v = valueForColumn(col, table, parsed, enumValues)
  for (let attempt = 0; attempt < UNIQUE_RETRIES && seen.has(JSON.stringify(v)); attempt++) {
    v = valueForColumn(col, table, parsed, enumValues)
  }
  for (let attempt = 0; attempt < UNIQUE_RETRIES && seen.has(JSON.stringify(v)); attempt++) {
    v = uniqueFallback(v, parsed, i, attempt + rowAttempt * UNIQUE_RETRIES)
  }
  return v
}

function generateJoins(schema: Schema, values: Map<string, unknown[]>, n: number): FakeJoin[] {
  const joins: FakeJoin[] = []
  for (const ref of schema.refs) {
    if (ref.kind !== '<>') continue
    const from = schema.tables.find((t) => t.id === ref.from.tableId)
    const to = schema.tables.find((t) => t.id === ref.to.tableId)
    if (!from || !to) continue
    const fromPkId = ref.from.columnIds[0] ?? primaryKeyColumnIds(from)[0]
    const toPkId = ref.to.columnIds[0] ?? primaryKeyColumnIds(to)[0]
    const fromCol = from.columns.find((c) => c.id === fromPkId)
    const toCol = to.columns.find((c) => c.id === toPkId)
    if (!fromCol || !toCol) continue
    const fromVals = values.get(key(from.id, fromPkId)) ?? []
    const toVals = values.get(key(to.id, toPkId)) ?? []
    const rows: [unknown, unknown][] = []
    const seen = new Set<string>()
    if (toVals.length > 0) {
      for (const f of fromVals) {
        const k = faker.number.int({ min: 0, max: Math.min(3, toVals.length) })
        for (let j = 0; j < k; j++) {
          const t = faker.helpers.arrayElement(toVals)
          const sig = JSON.stringify([f, t])
          if (seen.has(sig)) continue
          seen.add(sig)
          rows.push([f, t])
        }
        if (rows.length >= n * 3) break
      }
    }
    joins.push({
      refId: ref.id,
      fromTable: from.name,
      toTable: to.name,
      fromColumn: fromCol.name,
      toColumn: toCol.name,
      rows,
    })
  }
  return joins
}

export { parseType } from './heuristics'

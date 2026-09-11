/**
 * Merge a freshly parsed schema (`next`, with brand-new ids) into the current schema (`prev`),
 * preserving ids of tables/columns/indexes/refs/enums that match so node positions, selection and
 * undo history survive a text edit.
 *
 * Matching order, per entity kind:
 *  1. id           — `next` already carries a `prev` id (e.g. a parser that re-used ids).
 *  2. name path    — `schema.table`, `schema.table.column`, enum by `schema.name`, enum value by name,
 *                    index by resolved column-id list, ref by resolved endpoints (either direction).
 *  3. rename       — columns: same table, exactly one unmatched column on each side ⇒ that column
 *                    was renamed, keep its id. Tables: exactly one unmatched table on each side with
 *                    identical column names ⇒ the table was renamed. Enum values: same as columns.
 *
 * Django-only metadata (`django` bags) has no home in DBML text, so when `next` comes from the DBML
 * parser it arrives without it. For matched entities whose `next.django` is undefined, the previous
 * bag is carried over (disable with `{ preserveDjango: false }` when `next` is authoritative for it).
 *
 * Pure: neither input is mutated; the result is a deep copy of `next` with ids (and bags) patched.
 *
 * OWNER: worker-1 (core-dbml).
 */
import type { Column, Enum, EnumValue, Index, Ref, RefEndpoint, Schema, Table } from './schema'
import { cloneSchema } from './schema'

export interface ReconcileOptions {
  /** Copy `django` bags from `prev` onto matched entities that lack one in `next`. Default true. */
  preserveDjango?: boolean
}

const tablePath = (t: Table): string => `${t.schema ?? ''}.${t.name}`
const enumPath = (e: Enum): string => `${e.schema ?? ''}.${e.name}`

const sameNames = (a: { name: string }[], b: { name: string }[]): boolean =>
  a.length === b.length && a.every((x, i) => x.name === b[i].name)

const sameNameSet = (a: { name: string }[], b: { name: string }[]): boolean => {
  if (a.length !== b.length) return false
  const names = new Set(a.map((x) => x.name))
  return b.every((x) => names.has(x.name))
}

/**
 * Pair up `prev`/`next` entities by id, then by key, then (optionally) a single-leftover rename.
 * Returns the matched pairs; `next` entities keep their position in the output.
 */
function pair<T extends { id: string }>(
  prev: T[],
  next: T[],
  key: (x: T) => string,
  rename?: (prevLeft: T[], nextLeft: T[]) => [T, T][],
): Map<T, T> {
  const matched = new Map<T, T>() // next -> prev
  const usedPrev = new Set<T>()

  const prevById = new Map(prev.map((p) => [p.id, p]))
  for (const n of next) {
    const p = prevById.get(n.id)
    if (p && !usedPrev.has(p)) {
      matched.set(n, p)
      usedPrev.add(p)
    }
  }

  const prevByKey = new Map<string, T[]>()
  for (const p of prev) {
    if (usedPrev.has(p)) continue
    const k = key(p)
    const list = prevByKey.get(k)
    if (list) list.push(p)
    else prevByKey.set(k, [p])
  }
  for (const n of next) {
    if (matched.has(n)) continue
    const list = prevByKey.get(key(n))
    const p = list?.find((x) => !usedPrev.has(x))
    if (p) {
      matched.set(n, p)
      usedPrev.add(p)
    }
  }

  if (rename) {
    const prevLeft = prev.filter((p) => !usedPrev.has(p))
    const nextLeft = next.filter((n) => !matched.has(n))
    if (prevLeft.length > 0 && nextLeft.length > 0) {
      for (const [n, p] of rename(prevLeft, nextLeft)) {
        if (matched.has(n) || usedPrev.has(p)) continue
        matched.set(n, p)
        usedPrev.add(p)
      }
    }
  }
  return matched
}

/** Exactly one leftover on each side ⇒ a rename. */
function singleLeftover<T>(prevLeft: T[], nextLeft: T[]): [T, T][] {
  return prevLeft.length === 1 && nextLeft.length === 1 ? [[nextLeft[0], prevLeft[0]]] : []
}

function reconcileColumns(prev: Table, next: Table, preserveDjango: boolean): Map<string, string> {
  const idMap = new Map<string, string>() // next column id -> prev column id
  const pairs = pair<Column>(prev.columns, next.columns, (c) => c.name, singleLeftover)
  for (const [n, p] of pairs) {
    idMap.set(n.id, p.id)
    n.id = p.id
    if (preserveDjango && n.django === undefined && p.django !== undefined) n.django = structuredClone(p.django)
  }
  return idMap
}

function reconcileIndexes(prev: Table, next: Table): void {
  // Column ids on `next` have already been rewritten, so a plain id-list key lines up with `prev`.
  const key = (i: Index) => `${i.pk ? 'pk' : ''}|${i.unique ? 'u' : ''}|${i.columnIds.join(',')}`
  const loose = (i: Index) => i.columnIds.join(',')
  const exact = pair<Index>(prev.indexes, next.indexes, key)
  const leftPrev = prev.indexes.filter((p) => ![...exact.values()].includes(p))
  const leftNext = next.indexes.filter((n) => !exact.has(n))
  const byColumns = pair<Index>(leftPrev, leftNext, loose)
  for (const [n, p] of [...exact, ...byColumns]) n.id = p.id
}

function reconcileTables(prev: Schema, next: Schema, preserveDjango: boolean): Map<string, string> {
  const columnIdMap = new Map<string, string>()
  const renameTables = (prevLeft: Table[], nextLeft: Table[]): [Table, Table][] => {
    const out: [Table, Table][] = []
    const taken = new Set<Table>()
    for (const n of nextLeft) {
      const candidates = prevLeft.filter((p) => !taken.has(p) && sameNames(p.columns, n.columns))
      const loose = candidates.length > 0 ? candidates : prevLeft.filter((p) => !taken.has(p) && sameNameSet(p.columns, n.columns))
      if (loose.length === 1) {
        out.push([n, loose[0]])
        taken.add(loose[0])
      }
    }
    return out
  }
  const pairs = pair<Table>(prev.tables, next.tables, tablePath, renameTables)
  for (const [n, p] of pairs) {
    n.id = p.id
    if (preserveDjango && n.django === undefined && p.django !== undefined) n.django = structuredClone(p.django)
    const colMap = reconcileColumns(p, n, preserveDjango)
    for (const [from, to] of colMap) columnIdMap.set(from, to)
    for (const i of n.indexes) i.columnIds = i.columnIds.map((id) => colMap.get(id) ?? id)
    reconcileIndexes(p, n)
  }
  return columnIdMap
}

const endpointKey = (e: RefEndpoint): string => `${e.tableId}(${e.columnIds.join(',')})`
const refKey = (r: Ref): string => `${endpointKey(r.from)}->${endpointKey(r.to)}`
const reversedKey = (r: Ref): string => `${endpointKey(r.to)}->${endpointKey(r.from)}`

function reconcileRefs(prev: Schema, next: Schema, preserveDjango: boolean): void {
  // Endpoint ids on `next` are already rewritten to `prev` ids where tables/columns matched.
  const exact = pair<Ref>(prev.refs, next.refs, refKey)
  const leftPrev = prev.refs.filter((p) => ![...exact.values()].includes(p))
  const leftNext = next.refs.filter((n) => !exact.has(n))
  // Same relationship written from the other side (`a.x > b.y` became `b.y < a.x`).
  const prevReversed = new Map(leftPrev.map((p) => [reversedKey(p), p]))
  const flipped = new Map<Ref, Ref>()
  for (const n of leftNext) {
    const p = prevReversed.get(refKey(n))
    if (p && ![...flipped.values()].includes(p)) flipped.set(n, p)
  }
  for (const [n, p] of [...exact, ...flipped]) {
    n.id = p.id
    if (preserveDjango && n.django === undefined && p.django !== undefined) n.django = structuredClone(p.django)
  }
}

function reconcileEnums(prev: Schema, next: Schema): void {
  const pairs = pair<Enum>(prev.enums, next.enums, enumPath, (prevLeft, nextLeft) => {
    const out: [Enum, Enum][] = []
    const taken = new Set<Enum>()
    for (const n of nextLeft) {
      const candidates = prevLeft.filter((p) => !taken.has(p) && sameNameSet(p.values, n.values))
      if (candidates.length === 1) {
        out.push([n, candidates[0]])
        taken.add(candidates[0])
      }
    }
    return out
  })
  for (const [n, p] of pairs) {
    n.id = p.id
    const values = pair<EnumValue>(p.values, n.values, (v) => v.name, singleLeftover)
    for (const [nv, pv] of values) nv.id = pv.id
  }
}

function remapEndpoint(e: RefEndpoint, columnIdMap: Map<string, string>): void {
  e.columnIds = e.columnIds.map((id) => columnIdMap.get(id) ?? id)
}

export function reconcile(prev: Schema, next: Schema, options: ReconcileOptions = {}): Schema {
  const preserveDjango = options.preserveDjango ?? true
  const out = cloneSchema(next)

  const tableIdMap = new Map<string, string>()
  const before = out.tables.map((t) => t.id)
  const columnIdMap = reconcileTables(prev, out, preserveDjango)
  out.tables.forEach((t, i) => {
    if (before[i] !== t.id) tableIdMap.set(before[i], t.id)
  })

  for (const r of out.refs) {
    r.from.tableId = tableIdMap.get(r.from.tableId) ?? r.from.tableId
    r.to.tableId = tableIdMap.get(r.to.tableId) ?? r.to.tableId
    remapEndpoint(r.from, columnIdMap)
    remapEndpoint(r.to, columnIdMap)
  }
  reconcileRefs(prev, out, preserveDjango)
  reconcileEnums(prev, out)
  return out
}

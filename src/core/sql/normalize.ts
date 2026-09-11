/**
 * Rewrite a Schema into the subset SQL DDL can express, before it is handed to a DDL generator:
 *  - `-` (one-to-one) becomes a plain FK (`>`) on the `from` side; a warning is raised when the FK
 *    column is not unique, since the DDL then only says "many-to-one".
 *  - `<>` (many-to-many) becomes an explicit join table `<from>_<to>` with a composite primary key
 *    and two FKs. Naming mirrors what @dbml/core's exporter would do, but doing it here keeps the
 *    output deterministic and identical across the postgres/mysql/sqlite targets.
 *
 * Diagnostics describe each rewrite (`lossy: true`) so the Problems panel can show them.
 */
import type { Column, Diagnostic, Ref, Schema, Table } from '../schema'
import { cloneSchema, diag, findTable, newId, primaryKeyColumnIds } from '../schema'

const columnIsUnique = (t: Table, columnIds: string[]): boolean => {
  if (columnIds.length === 1) {
    const c = t.columns.find((x) => x.id === columnIds[0])
    if (c?.pk || c?.unique) return true
  }
  const pk = primaryKeyColumnIds(t)
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  if (sameSet(pk, columnIds)) return true
  return t.indexes.some((i) => (i.unique || i.pk) && sameSet(i.columnIds, columnIds))
}

/** Type a join-table FK column should have to reference `c`: auto-increment keys become plain ints. */
export function fkColumnType(c: Column): string {
  const t = c.type.toLowerCase()
  if (t === 'serial') return 'int'
  if (t === 'bigserial') return 'bigint'
  if (t === 'smallserial') return 'smallint'
  return c.type
}

function uniqueTableName(base: string, taken: Set<string>): string {
  let name = base
  let n = 2
  while (taken.has(name)) name = `${base}_${n++}`
  taken.add(name)
  return name
}

export function normalizeForSql(schema: Schema): { schema: Schema; diagnostics: Diagnostic[] } {
  const out = cloneSchema(schema)
  const diagnostics: Diagnostic[] = []
  const taken = new Set(out.tables.map((t) => t.name))
  const refs: Ref[] = []

  for (const ref of out.refs) {
    if (ref.kind === '-') {
      const from = findTable(out, ref.from.tableId)
      const to = findTable(out, ref.to.tableId)
      if (from && to && !columnIsUnique(from, ref.from.columnIds)) {
        diagnostics.push(
          diag({
            severity: 'warning',
            source: 'sql',
            lossy: true,
            refId: ref.id,
            tableId: from.id,
            message: `One-to-one ${from.name} - ${to.name} is exported as a plain foreign key; mark ${from.name}.${ref.from.columnIds.map((id) => from.columns.find((c) => c.id === id)?.name ?? '?').join(', ')} unique to keep it one-to-one`,
          }),
        )
      }
      refs.push({ ...ref, kind: '>' })
      continue
    }
    if (ref.kind !== '<>') {
      refs.push(ref)
      continue
    }
    const from = findTable(out, ref.from.tableId)
    const to = findTable(out, ref.to.tableId)
    if (!from || !to) continue
    const name = uniqueTableName(`${from.name}_${to.name}`, taken)
    const join: Table = { id: newId(), name, columns: [], indexes: [] }
    const fkFor = (t: Table, endpoint: { columnIds: string[] }, prefix: string): string[] => {
      const ids: string[] = []
      for (const cid of endpoint.columnIds) {
        const src = t.columns.find((c) => c.id === cid)
        if (!src) continue
        const col: Column = {
          id: newId(),
          name: `${prefix}_${src.name}`,
          type: fkColumnType(src),
          pk: false,
          unique: false,
          notNull: true,
          increment: false,
        }
        join.columns.push(col)
        ids.push(col.id)
      }
      return ids
    }
    const fromIds = fkFor(from, ref.from, from.name)
    const toIds = fkFor(to, ref.to, from.id === to.id ? `${to.name}_2` : to.name)
    if (fromIds.length === 0 || toIds.length === 0) continue
    join.indexes.push({ id: newId(), columnIds: [...fromIds, ...toIds], unique: false, pk: true })
    out.tables.push(join)
    const actions = { onDelete: ref.onDelete, onUpdate: ref.onUpdate }
    refs.push(
      { id: newId(), kind: '>', from: { tableId: join.id, columnIds: fromIds }, to: { tableId: from.id, columnIds: ref.from.columnIds }, ...actions },
      { id: newId(), kind: '>', from: { tableId: join.id, columnIds: toIds }, to: { tableId: to.id, columnIds: ref.to.columnIds }, ...actions },
    )
    diagnostics.push(
      diag({
        severity: 'info',
        source: 'sql',
        lossy: true,
        refId: ref.id,
        tableId: join.id,
        message: `Many-to-many ${from.name} <> ${to.name} is exported as join table "${name}"`,
      }),
    )
  }

  out.refs = refs.map((r) => {
    if (r.onDelete === undefined) delete r.onDelete
    if (r.onUpdate === undefined) delete r.onUpdate
    return r
  })
  return { schema: out, diagnostics }
}

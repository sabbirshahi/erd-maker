/**
 * Shared helpers for the core-dbml tests: compare Schemas structurally, ignoring nanoid identity.
 * Every id is replaced by the entity's name path so deep-equality works across parses.
 */
import type { Schema, RefEndpoint } from '@/core/schema'

type Plain = Record<string, unknown>

export function stripIds(s: Schema): Plain {
  const tableName = new Map<string, string>()
  const columnName = new Map<string, string>()
  for (const t of s.tables) {
    const tn = t.schema ? `${t.schema}.${t.name}` : t.name
    tableName.set(t.id, tn)
    for (const c of t.columns) columnName.set(c.id, `${tn}.${c.name}`)
  }
  const ep = (e: RefEndpoint) => ({
    table: tableName.get(e.tableId) ?? `?${e.tableId}`,
    columns: e.columnIds.map((id) => columnName.get(id) ?? `?${id}`),
  })
  return {
    project: { ...s.project },
    enums: s.enums.map((e) => ({
      name: e.name,
      schema: e.schema,
      note: e.note,
      values: e.values.map((v) => ({ name: v.name, note: v.note })),
    })),
    tables: s.tables.map((t) => ({
      name: t.name,
      schema: t.schema,
      alias: t.alias,
      note: t.note,
      headerColor: t.headerColor,
      django: t.django,
      columns: t.columns.map((c) => {
        const { id: _id, ...rest } = c
        void _id
        return rest
      }),
      indexes: t.indexes.map((i) => ({
        columns: i.columnIds.map((id) => columnName.get(id) ?? `?${id}`),
        unique: i.unique,
        pk: i.pk,
        name: i.name,
        type: i.type,
        note: i.note,
      })),
    })),
    refs: s.refs.map((r) => ({
      name: r.name,
      kind: r.kind,
      from: ep(r.from),
      to: ep(r.to),
      onDelete: r.onDelete,
      onUpdate: r.onUpdate,
      django: r.django,
    })),
  }
}

/** SQL DDL has no home for `default: null`, and normalises numeric literals (`0.0` -> `0`). */
function canonicalDefault(d: unknown): string | undefined {
  if (d === undefined || d === null) return undefined
  const s = String(d).trim()
  if (s === '' || /^null$/i.test(s)) return undefined
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s))
  return s
}

/**
 * Canonical form for comparing schemas that came through SQL DDL: FK-side-first refs (`<` becomes
 * `>`, `-` becomes `>`), refs sorted, ref names dropped, type names lower-cased, pk implies not null,
 * `default: null` dropped and numeric defaults normalised. Things DDL cannot carry are dropped too:
 * project/passthrough, table alias + header colour, index type/note, enum value notes.
 */
export function canonical(s: Schema): Plain {
  const p = stripIds(s)
  const enums = (p.enums as Plain[])
    .map((e): Plain => ({ ...e, note: undefined, values: (e.values as Plain[]).map((v) => ({ name: v.name })) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const qualified = (t: Plain) => `${t.schema ?? ''}.${t.name}`
  const tables = [...(p.tables as Plain[])].sort((a, b) => qualified(a).localeCompare(qualified(b))).map((t) => ({
    ...t,
    alias: undefined,
    headerColor: undefined,
    columns: (t.columns as Plain[]).map((c) => ({
      ...c,
      type: String(c.type).toLowerCase(),
      notNull: Boolean(c.notNull) || Boolean(c.pk),
      default: canonicalDefault(c.default),
    })),
    indexes: (t.indexes as Plain[])
      .map((i): Plain => ({ ...i, type: undefined, note: undefined }))
      .sort((a, b) => JSON.stringify(a.columns).localeCompare(JSON.stringify(b.columns))),
  }))
  const refs = (p.refs as Plain[])
    .map((r) => {
      const kind = r.kind as string
      if (kind === '<') return { ...r, kind: '>', from: r.to, to: r.from, name: undefined }
      if (kind === '-') return { ...r, kind: '>', name: undefined }
      return { ...r, name: undefined }
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { enums, tables, refs }
}

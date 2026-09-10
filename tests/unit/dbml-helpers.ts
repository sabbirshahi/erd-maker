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

/**
 * Canonical form for comparing schemas that came through SQL: FK-side-first refs (`<` becomes `>`),
 * refs sorted, type names lower-cased, names/aliases/passthrough dropped, pk implies not null.
 */
export function canonical(s: Schema): Plain {
  const p = stripIds(s)
  const tables = (p.tables as Plain[]).map((t) => ({
    ...t,
    alias: undefined,
    headerColor: undefined,
    columns: (t.columns as Plain[]).map((c) => ({
      ...c,
      type: String(c.type).toLowerCase(),
      notNull: Boolean(c.notNull) || Boolean(c.pk),
    })),
    indexes: (t.indexes as Plain[])
      .map((i): Plain => ({ ...i, type: undefined }))
      .sort((a, b) => JSON.stringify(a.columns).localeCompare(JSON.stringify(b.columns))),
  }))
  const refs = (p.refs as Plain[])
    .map((r) => {
      const kind = r.kind as string
      if (kind === '<') return { ...r, kind: '>', from: r.to, to: r.from, name: undefined }
      return { ...r, name: undefined }
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { enums: p.enums, tables, refs }
}

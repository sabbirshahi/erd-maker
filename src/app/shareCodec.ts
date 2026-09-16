/**
 * The wire form of a share link.
 *
 * A share payload is compressed before it reaches the URL, so repeated key names are nearly free —
 * a compressor eats those. What a compressor cannot help with is the part of the document that is
 * random: every table, column, ref, index and enum value carries a 10-character nanoid, and those
 * ids are the single largest thing in a big diagram. They are also meaningless outside the document
 * they came from, so the compact form drops them entirely and refers to tables and columns by
 * position; `unpackShare` mints fresh ids on the way back in. Layout coordinates round to whole
 * pixels (sub-pixel node positions are invisible and cost ~15 characters each), booleans collapse
 * into a bit field, and absent fields disappear instead of being spelled out as `null`.
 *
 * Two formats exist on the wire and both must keep decoding:
 *
 *  - **v1** — `{ v: 1, schema, layout }`, the original shape. Links in this form are already out in
 *    the world, so it stays readable forever. It is also the encoder's fallback for the rare
 *    document that cannot be expressed positionally (a ref pointing at a table that is not in
 *    `schema.tables`), where being verbatim beats being small.
 *  - **v2** — the positional array below.
 *
 * The version is the first element of the payload, so an array is v2 and an object is v1; the
 * transport (lz-string, see share.ts) does not need to know which it carries.
 *
 * A v2 payload is read by POSITION, so a new field is only ever APPENDED — moving one would make
 * every link already in the wild decode as something else. A reader that finds nothing at a
 * position defaults it, which is what lets an older link open in a newer build.
 */
import {
  newId,
  type Column,
  type Enum,
  type EnumValue,
  type Index,
  type Layout,
  type Project,
  type Ref,
  type RefAction,
  type RefEndpoint,
  type RefKind,
  type Schema,
  type Table,
} from '@/core/schema'

export interface ShareDoc {
  schema: Schema
  layout: Layout
  /**
   * What the sender called the diagram. Optional on the wire in both formats: every link handed
   * out before this existed carries no name, and those must keep opening. A document without one
   * is named by the reader, not by the codec.
   */
  name?: string
}

/** Bump when the positional layout below changes shape, never when a field is appended. */
export const COMPACT_VERSION = 2

const KINDS: readonly RefKind[] = ['>', '<', '-', '<>']
const ACTIONS: readonly RefAction[] = [
  'cascade',
  'restrict',
  'set null',
  'set default',
  'no action',
]

/** Thrown while packing a document that cannot be expressed positionally. Never escapes this module. */
class CompactError extends Error {}

type Row = unknown[]

/** Trailing absent fields cost five characters each as `,null`; drop them and let the reader default. */
function trim<T>(row: T[]): T[] {
  const out = row.slice()
  while (out.length > 0 && (out[out.length - 1] === null || out[out.length - 1] === undefined))
    out.pop()
  return out
}

/** `null` for anything empty, so `trim` can drop it and the reader can default it. */
const some = <T>(value: T | undefined): T | null => (value === undefined ? null : value)
const someList = <T>(list: T[] | undefined): T[] | null => (list && list.length > 0 ? list : null)
const someObject = <T extends object>(value: T | undefined): T | null =>
  value && Object.keys(value).length > 0 ? value : null

// ---------- pack ----------

function packColumn(c: Column): Row {
  const flags = (c.pk ? 1 : 0) | (c.unique ? 2 : 0) | (c.notNull ? 4 : 0) | (c.increment ? 8 : 0)
  return trim([c.name, c.type, flags || null, some(c.default), some(c.note), someObject(c.django)])
}

function packIndex(ix: Index, columnAt: (id: string) => number): Row {
  const flags = (ix.unique ? 1 : 0) | (ix.pk ? 2 : 0)
  return trim([
    ix.columnIds.map(columnAt),
    flags || null,
    some(ix.name),
    some(ix.type),
    some(ix.note),
  ])
}

function packTable(t: Table): Row {
  const index = new Map(t.columns.map((c, i) => [c.id, i]))
  const columnAt = (id: string): number => {
    const i = index.get(id)
    if (i === undefined) throw new CompactError(`column ${id} is not in table ${t.id}`)
    return i
  }
  return trim([
    t.name,
    t.columns.map(packColumn),
    someList(t.indexes.map((ix) => packIndex(ix, columnAt))),
    some(t.schema),
    some(t.alias),
    some(t.note),
    some(t.headerColor),
    someObject(t.django),
  ])
}

function packEnum(e: Enum): Row {
  const values = e.values.map((v) => trim([v.name, some(v.note)]))
  return trim([e.name, values, some(e.schema), some(e.note)])
}

function packProject(p: Project): Row {
  return trim([p.appLabel, some(p.name), some(p.note), someList(p.passthrough)])
}

function packRefs(schema: Schema): Row[] {
  const tableAt = new Map(schema.tables.map((t, i) => [t.id, i]))
  const columnAt = new Map(
    schema.tables.map((t) => [t.id, new Map(t.columns.map((c, i) => [c.id, i]))]),
  )
  const endpoint = (e: RefEndpoint): Row => {
    const ti = tableAt.get(e.tableId)
    const cols = columnAt.get(e.tableId)
    if (ti === undefined || !cols)
      throw new CompactError(`ref endpoint table ${e.tableId} is missing`)
    return [
      ti,
      e.columnIds.map((id) => {
        const ci = cols.get(id)
        if (ci === undefined) throw new CompactError(`ref endpoint column ${id} is missing`)
        return ci
      }),
    ]
  }
  return schema.refs.map((r) => {
    const [ft, fc] = endpoint(r.from)
    const [tt, tc] = endpoint(r.to)
    return trim([
      ft,
      fc,
      tt,
      tc,
      KINDS.indexOf(r.kind),
      some(r.name),
      r.onDelete ? ACTIONS.indexOf(r.onDelete) : null,
      r.onUpdate ? ACTIONS.indexOf(r.onUpdate) : null,
      someObject(r.django),
    ])
  })
}

/** Positions in table order, flattened and rounded: `[x0, y0, x1, y1, …]`, `null` where unplaced. */
function packLayout(doc: ShareDoc): (number | null)[] {
  const flat: (number | null)[] = []
  for (const t of doc.schema.tables) {
    const p = doc.layout[t.id]
    flat.push(p ? Math.round(p.x) : null, p ? Math.round(p.y) : null)
  }
  return trim(flat)
}

/**
 * The JSON-ready payload for a document: the compact array, or the verbatim v1 object when the
 * document cannot be expressed positionally. Never throws.
 */
export function packShare(doc: ShareDoc): unknown {
  const name = doc.name?.trim() || undefined
  try {
    return trim([
      COMPACT_VERSION,
      packProject(doc.schema.project),
      doc.schema.tables.map(packTable),
      someList(packRefs(doc.schema)),
      someList(doc.schema.enums.map(packEnum)),
      someList(packLayout(doc)),
      // Appended, so positions 0-5 read the same as they did before names existed.
      some(name),
    ])
  } catch {
    return name
      ? { v: 1, schema: doc.schema, layout: doc.layout, name }
      : { v: 1, schema: doc.schema, layout: doc.layout }
  }
}

// ---------- unpack ----------
//
// Everything below reads a string someone pasted into their address bar. Nothing here may throw,
// and nothing may assume a field is the type it was written as.

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const int = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0
const obj = <T>(v: unknown): T | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : undefined
const row = (v: unknown): Row => (Array.isArray(v) ? v : [])

function unpackColumn(raw: unknown): Column | null {
  const r = row(raw)
  const name = str(r[0])
  if (name === undefined) return null
  const flags = int(r[2])
  const c: Column = {
    id: newId(),
    name,
    type: str(r[1]) ?? 'varchar(255)',
    pk: (flags & 1) !== 0,
    unique: (flags & 2) !== 0,
    notNull: (flags & 4) !== 0,
    increment: (flags & 8) !== 0,
  }
  const def = str(r[3])
  if (def !== undefined) c.default = def
  const note = str(r[4])
  if (note !== undefined) c.note = note
  const django = obj<Column['django']>(r[5])
  if (django) c.django = django
  return c
}

function unpackIndex(raw: unknown, columns: Column[]): Index | null {
  const r = row(raw)
  const ids: string[] = []
  for (const ci of row(r[0])) {
    const col = columns[int(ci)]
    if (!col) return null
    ids.push(col.id)
  }
  const flags = int(r[1])
  const ix: Index = {
    id: newId(),
    columnIds: ids,
    unique: (flags & 1) !== 0,
    pk: (flags & 2) !== 0,
  }
  const name = str(r[2])
  if (name !== undefined) ix.name = name
  const type = str(r[3])
  if (type !== undefined) ix.type = type
  const note = str(r[4])
  if (note !== undefined) ix.note = note
  return ix
}

function unpackTable(raw: unknown): Table | null {
  const r = row(raw)
  const name = str(r[0])
  if (name === undefined) return null
  const columns = row(r[1])
    .map(unpackColumn)
    .filter((c): c is Column => c !== null)
  const indexes = row(r[2])
    .map((ix) => unpackIndex(ix, columns))
    .filter((ix): ix is Index => ix !== null)
  const t: Table = { id: newId(), name, columns, indexes }
  const schema = str(r[3])
  if (schema !== undefined) t.schema = schema
  const alias = str(r[4])
  if (alias !== undefined) t.alias = alias
  const note = str(r[5])
  if (note !== undefined) t.note = note
  const headerColor = str(r[6])
  if (headerColor !== undefined) t.headerColor = headerColor
  const django = obj<Table['django']>(r[7])
  if (django) t.django = django
  return t
}

function unpackEnum(raw: unknown): Enum | null {
  const r = row(raw)
  const name = str(r[0])
  if (name === undefined) return null
  const values: EnumValue[] = []
  for (const v of row(r[1])) {
    const vr = row(v)
    const vn = str(vr[0])
    if (vn === undefined) continue
    const value: EnumValue = { id: newId(), name: vn }
    const note = str(vr[1])
    if (note !== undefined) value.note = note
    values.push(value)
  }
  const e: Enum = { id: newId(), name, values }
  const schema = str(r[2])
  if (schema !== undefined) e.schema = schema
  const note = str(r[3])
  if (note !== undefined) e.note = note
  return e
}

function unpackProject(raw: unknown): Project {
  const r = row(raw)
  const p: Project = { appLabel: str(r[0]) ?? 'app' }
  const name = str(r[1])
  if (name !== undefined) p.name = name
  const note = str(r[2])
  if (note !== undefined) p.note = note
  const passthrough = row(r[3]).filter((s): s is string => typeof s === 'string')
  if (passthrough.length > 0) p.passthrough = passthrough
  return p
}

function unpackEndpoint(t: unknown, c: unknown, tables: Table[]): RefEndpoint | null {
  const table = tables[int(t)]
  if (!table) return null
  const columnIds: string[] = []
  for (const ci of row(c)) {
    const col = table.columns[int(ci)]
    if (!col) return null
    columnIds.push(col.id)
  }
  return { tableId: table.id, columnIds }
}

function unpackRef(raw: unknown, tables: Table[]): Ref | null {
  const r = row(raw)
  const from = unpackEndpoint(r[0], r[1], tables)
  const to = unpackEndpoint(r[2], r[3], tables)
  if (!from || !to) return null
  const ref: Ref = { id: newId(), from, to, kind: KINDS[int(r[4])] ?? '>' }
  const name = str(r[5])
  if (name !== undefined) ref.name = name
  const onDelete = ACTIONS[int(r[6])]
  if (typeof r[6] === 'number' && onDelete) ref.onDelete = onDelete
  const onUpdate = ACTIONS[int(r[7])]
  if (typeof r[7] === 'number' && onUpdate) ref.onUpdate = onUpdate
  const django = obj<Ref['django']>(r[8])
  if (django) ref.django = django
  return ref
}

function unpackLayout(raw: unknown, tables: Table[]): Layout {
  const flat = row(raw)
  const layout: Layout = {}
  tables.forEach((t, i) => {
    const x = flat[i * 2]
    const y = flat[i * 2 + 1]
    if (typeof x === 'number' && typeof y === 'number') layout[t.id] = { x, y }
  })
  return layout
}

function unpackCompact(payload: Row): ShareDoc {
  const tables = row(payload[2])
    .map(unpackTable)
    .filter((t): t is Table => t !== null)
  const schema: Schema = {
    project: unpackProject(payload[1]),
    tables,
    refs: row(payload[3])
      .map((r) => unpackRef(r, tables))
      .filter((r): r is Ref => r !== null),
    enums: row(payload[4])
      .map(unpackEnum)
      .filter((e): e is Enum => e !== null),
  }
  const doc: ShareDoc = { schema, layout: unpackLayout(payload[5], tables) }
  // Absent in every link made before names were carried, and in any link whose diagram was unnamed.
  const name = str(payload[6])
  if (name !== undefined) doc.name = name
  return doc
}

/** The v1 shape, kept verbatim — these documents already carry ids, so they keep them. */
function unpackPlain(payload: unknown): ShareDoc | null {
  const d = obj<Partial<ShareDoc>>(payload)
  if (!d?.schema || !Array.isArray(d.schema.tables)) return null
  const doc: ShareDoc = { schema: d.schema, layout: d.layout ?? {} }
  const name = str(d.name)
  if (name !== undefined) doc.name = name
  return doc
}

/** Read either wire format. Returns null for anything that is not a share payload. */
export function unpackShare(payload: unknown): ShareDoc | null {
  if (Array.isArray(payload)) return payload[0] === COMPACT_VERSION ? unpackCompact(payload) : null
  return unpackPlain(payload)
}

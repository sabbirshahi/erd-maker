/**
 * Schema IR -> DBML text. Deterministic and idempotent: generate(parse(generate(s))) === generate(s).
 *
 * Layout: Project passthrough block, enums, tables (source order), refs, then remaining passthrough
 * blocks (TableGroup / sticky Note). Two-space indent. Column settings are emitted in the fixed order
 * `[pk, increment, not null, unique, default: x, note: 'x']`; refs are always standalone lines
 * (inline `[ref: ...]` settings are never produced).
 */
import type { Column, Enum, Index, Ref, RefEndpoint, Schema, Table } from '../schema'
import { quoteDbmlString } from './parse'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Type base names may carry a schema qualifier or array suffix, e.g. `auth.role`, `int[]`. */
const TYPE_IDENT = /^[A-Za-z_][A-Za-z0-9_.]*(\[\])?$/

export function dbmlIdent(name: string): string {
  return IDENT.test(name) ? name : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Quote the base of a type name when it is not a plain identifier, e.g. `"character varying"(20)`. */
export function dbmlType(type: string): string {
  const paren = type.indexOf('(')
  const base = paren === -1 ? type : type.slice(0, paren)
  const args = paren === -1 ? '' : type.slice(paren)
  if (TYPE_IDENT.test(base)) return type
  return `${dbmlIdent(base)}${args}`
}

function qualifiedName(schema: string | undefined, name: string): string {
  return schema ? `${dbmlIdent(schema)}.${dbmlIdent(name)}` : dbmlIdent(name)
}

function columnSettings(c: Column): string[] {
  const s: string[] = []
  if (c.pk) s.push('pk')
  if (c.increment) s.push('increment')
  if (c.notNull) s.push('not null')
  if (c.unique) s.push('unique')
  if (c.default !== undefined && c.default !== '') s.push(`default: ${c.default}`)
  if (c.note) s.push(`note: ${quoteDbmlString(c.note)}`)
  return s
}

function columnLine(c: Column): string {
  const settings = columnSettings(c)
  const head = `${dbmlIdent(c.name)} ${dbmlType(c.type)}`
  return settings.length > 0 ? `${head} [${settings.join(', ')}]` : head
}

function indexLine(i: Index, t: Table): string | undefined {
  const names: string[] = []
  for (const id of i.columnIds) {
    const col = t.columns.find((c) => c.id === id)
    if (!col) return undefined
    names.push(dbmlIdent(col.name))
  }
  if (names.length === 0) return undefined
  const cols = names.length === 1 ? names[0] : `(${names.join(', ')})`
  const s: string[] = []
  if (i.pk) s.push('pk')
  if (i.unique) s.push('unique')
  if (i.name) s.push(`name: ${quoteDbmlString(i.name)}`)
  if (i.type) s.push(`type: ${i.type}`)
  if (i.note) s.push(`note: ${quoteDbmlString(i.note)}`)
  return s.length > 0 ? `${cols} [${s.join(', ')}]` : cols
}

function tableBlock(t: Table): string {
  let head = `Table ${qualifiedName(t.schema, t.name)}`
  if (t.alias) head += ` as ${dbmlIdent(t.alias)}`
  if (t.headerColor) head += ` [headercolor: ${t.headerColor}]`
  const lines: string[] = [`${head} {`]
  for (const c of t.columns) lines.push(`  ${columnLine(c)}`)
  const idx = t.indexes.map((i) => indexLine(i, t)).filter((l): l is string => l !== undefined)
  if (idx.length > 0) {
    lines.push('')
    lines.push('  indexes {')
    for (const l of idx) lines.push(`    ${l}`)
    lines.push('  }')
  }
  if (t.note) {
    lines.push('')
    lines.push(`  Note: ${quoteDbmlString(t.note)}`)
  }
  lines.push('}')
  return lines.join('\n')
}

function enumBlock(e: Enum): string {
  const lines: string[] = [`Enum ${qualifiedName(e.schema, e.name)} {`]
  for (const v of e.values) {
    lines.push(v.note ? `  ${dbmlIdent(v.name)} [note: ${quoteDbmlString(v.note)}]` : `  ${dbmlIdent(v.name)}`)
  }
  // DBML has no enum-level Note (only value notes), so `e.note` has no textual home.
  lines.push('}')
  return lines.join('\n')
}

function endpointText(e: RefEndpoint, s: Schema): string | undefined {
  const t = s.tables.find((x) => x.id === e.tableId)
  if (!t) return undefined
  const names: string[] = []
  for (const id of e.columnIds) {
    const c = t.columns.find((x) => x.id === id)
    if (!c) return undefined
    names.push(dbmlIdent(c.name))
  }
  if (names.length === 0) return undefined
  const cols = names.length === 1 ? names[0] : `(${names.join(', ')})`
  return `${qualifiedName(t.schema, t.name)}.${cols}`
}

function refLine(r: Ref, s: Schema): string | undefined {
  const from = endpointText(r.from, s)
  const to = endpointText(r.to, s)
  if (!from || !to) return undefined
  const head = r.name ? `Ref ${dbmlIdent(r.name)}:` : 'Ref:'
  const settings: string[] = []
  if (r.onDelete) settings.push(`delete: ${r.onDelete}`)
  if (r.onUpdate) settings.push(`update: ${r.onUpdate}`)
  const tail = settings.length > 0 ? ` [${settings.join(', ')}]` : ''
  return `${head} ${from} ${r.kind} ${to}${tail}`
}

const isProjectBlock = (b: string): boolean => /^Project\b/i.test(b.trimStart())

function projectBlock(s: Schema): string | undefined {
  const { name, note } = s.project
  if (!name && !note) return undefined
  const lines = [`Project ${dbmlIdent(name ?? 'project')} {`]
  if (note) lines.push(`  Note: ${quoteDbmlString(note)}`)
  lines.push('}')
  return lines.join('\n')
}

export function generateDbml(schema: Schema): string {
  const passthrough = (schema.project.passthrough ?? []).map((b) => b.trim()).filter((b) => b.length > 0)
  const blocks: string[] = []

  const projectBlocks = passthrough.filter(isProjectBlock)
  if (projectBlocks.length > 0) blocks.push(...projectBlocks)
  else {
    const synthesized = projectBlock(schema)
    if (synthesized) blocks.push(synthesized)
  }

  for (const e of schema.enums) blocks.push(enumBlock(e))
  for (const t of schema.tables) blocks.push(tableBlock(t))

  const refs = schema.refs.map((r) => refLine(r, schema)).filter((l): l is string => l !== undefined)
  if (refs.length > 0) blocks.push(refs.join('\n'))

  blocks.push(...passthrough.filter((b) => !isProjectBlock(b)))

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : ''
}

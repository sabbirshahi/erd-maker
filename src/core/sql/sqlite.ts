/**
 * Schema -> SQLite DDL. @dbml/core has no SQLite target and SQLite cannot `ALTER TABLE ... ADD
 * FOREIGN KEY`, so instead of rewriting the Postgres text we emit the DDL directly: every FK is an
 * inline table constraint, enums become `CHECK (col IN (...))`, and column types go through the
 * type-rewrite table below (`serial` -> `INTEGER PRIMARY KEY AUTOINCREMENT`, `timestamp` -> `TEXT`,
 * `boolean` -> `INTEGER`, ...). Tables are emitted parents-first. Expects a schema that already went
 * through `normalizeForSql` (no `-` / `<>` refs).
 */
import type { Column, Diagnostic, Enum, Ref, Schema, Table } from '../schema'
import { diag, fkSide, primaryKeyColumnIds, topologicalTables } from '../schema'

/** DBML base type (lower-cased, args stripped) -> SQLite storage class. Anything else is kept as written. */
export const SQLITE_TYPES: Record<string, string> = {
  int: 'INTEGER',
  integer: 'INTEGER',
  int2: 'INTEGER',
  int4: 'INTEGER',
  int8: 'INTEGER',
  smallint: 'INTEGER',
  tinyint: 'INTEGER',
  mediumint: 'INTEGER',
  bigint: 'INTEGER',
  serial: 'INTEGER',
  smallserial: 'INTEGER',
  bigserial: 'INTEGER',
  bool: 'INTEGER',
  boolean: 'INTEGER',
  bit: 'INTEGER',
  varchar: 'TEXT',
  nvarchar: 'TEXT',
  char: 'TEXT',
  nchar: 'TEXT',
  character: 'TEXT',
  'character varying': 'TEXT',
  text: 'TEXT',
  citext: 'TEXT',
  string: 'TEXT',
  uuid: 'TEXT',
  json: 'TEXT',
  jsonb: 'TEXT',
  xml: 'TEXT',
  inet: 'TEXT',
  cidr: 'TEXT',
  macaddr: 'TEXT',
  enum: 'TEXT',
  timestamp: 'TEXT',
  timestamptz: 'TEXT',
  datetime: 'TEXT',
  datetime2: 'TEXT',
  date: 'TEXT',
  time: 'TEXT',
  timetz: 'TEXT',
  interval: 'TEXT',
  decimal: 'NUMERIC',
  numeric: 'NUMERIC',
  money: 'NUMERIC',
  float: 'REAL',
  float4: 'REAL',
  float8: 'REAL',
  double: 'REAL',
  'double precision': 'REAL',
  real: 'REAL',
  bytea: 'BLOB',
  blob: 'BLOB',
  binary: 'BLOB',
  varbinary: 'BLOB',
}

const INTEGER_TYPES = new Set(Object.entries(SQLITE_TYPES).filter(([, v]) => v === 'INTEGER').map(([k]) => k))

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`
const quoteString = (s: string): string => `'${s.replace(/'/g, "''")}'`

function baseType(type: string): string {
  const paren = type.indexOf('(')
  const base = (paren === -1 ? type : type.slice(0, paren)).trim()
  return base.replace(/\[\]$/, '').toLowerCase()
}

/** Map a DBML column type to a SQLite type name. Enum-typed columns become TEXT. */
export function sqliteType(type: string, isEnum: boolean): string {
  if (isEnum) return 'TEXT'
  const base = baseType(type)
  if (type.trim().endsWith('[]')) return 'TEXT'
  return SQLITE_TYPES[base] ?? type
}

/** Raw DBML default -> SQLite default clause body, or undefined when SQLite should have none. */
export function sqliteDefault(raw: string, type: string): string | undefined {
  const d = raw.trim()
  if (d === '' || /^null$/i.test(d)) return undefined
  if (/^true$/i.test(d)) return '1'
  if (/^false$/i.test(d)) return '0'
  if (d.startsWith('`') && d.endsWith('`')) {
    const expr = d.slice(1, -1).trim()
    if (/^(now|current_timestamp|getdate|sysdate|localtimestamp)\s*\(\s*\)$/i.test(expr) || /^current_timestamp$/i.test(expr)) {
      return 'CURRENT_TIMESTAMP'
    }
    if (/^current_date$/i.test(expr) || /^curdate\(\)$/i.test(expr)) return 'CURRENT_DATE'
    if (/^current_time$/i.test(expr) || /^curtime\(\)$/i.test(expr)) return 'CURRENT_TIME'
    if (/^(gen_random_uuid|uuid_generate_v4|uuid)\s*\(\s*\)$/i.test(expr)) {
      return "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))"
    }
    return `(${expr})`
  }
  if (d.startsWith("'") && d.endsWith("'")) {
    // DBML escapes `\'`; SQLite doubles the quote.
    const body = d.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    return quoteString(body)
  }
  if (d.startsWith('"') && d.endsWith('"')) return quoteString(d.slice(1, -1))
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(d)) {
    if (/^(bool|boolean|bit)$/.test(baseType(type))) return Number(d) ? '1' : '0'
    return d
  }
  return `(${d})`
}

const commentLines = (text: string, indent = ''): string[] => text.split(/\r?\n/).map((l) => `${indent}-- ${l}`)

interface Ctx {
  schema: Schema
  enumsByType: Map<string, Enum>
  tableName: (t: Table) => string
  diagnostics: Diagnostic[]
}

function columnDef(c: Column, t: Table, singlePk: boolean, ctx: Ctx): string {
  const en = ctx.enumsByType.get(c.type.toLowerCase())
  let type = sqliteType(c.type, en !== undefined)
  const parts: string[] = []
  if (singlePk) {
    if (c.increment) {
      if (!INTEGER_TYPES.has(baseType(c.type))) {
        ctx.diagnostics.push(
          diag({
            severity: 'warning',
            source: 'sql',
            lossy: true,
            tableId: t.id,
            columnId: c.id,
            message: `${t.name}.${c.name}: SQLite AUTOINCREMENT requires INTEGER, so \`${c.type}\` was rewritten`,
          }),
        )
      }
      type = 'INTEGER'
      parts.push('PRIMARY KEY AUTOINCREMENT')
    } else parts.push('PRIMARY KEY')
  } else if (c.increment) {
    ctx.diagnostics.push(
      diag({
        severity: 'warning',
        source: 'sql',
        lossy: true,
        tableId: t.id,
        columnId: c.id,
        message: `${t.name}.${c.name}: SQLite only auto-increments a single INTEGER PRIMARY KEY column; \`increment\` was dropped`,
      }),
    )
  }
  if (c.notNull && !singlePk) parts.push('NOT NULL')
  if (c.unique && !singlePk) parts.push('UNIQUE')
  if (c.default !== undefined) {
    const d = sqliteDefault(c.default, c.type)
    if (d !== undefined) parts.push(`DEFAULT ${d}`)
  }
  if (en) {
    parts.push(`CHECK (${quoteIdent(c.name)} IN (${en.values.map((v) => quoteString(v.name)).join(', ')}))`)
  }
  return [quoteIdent(c.name), type, ...parts].join(' ')
}

function fkConstraint(r: Ref, ctx: Ctx): string | undefined {
  const { fk, target } = fkSide(r)
  const fkTable = ctx.schema.tables.find((t) => t.id === fk.tableId)
  const targetTable = ctx.schema.tables.find((t) => t.id === target.tableId)
  if (!fkTable || !targetTable) return undefined
  const cols = (t: Table, ids: string[]) => ids.map((id) => t.columns.find((c) => c.id === id)).filter((c): c is Column => c !== undefined)
  const fkCols = cols(fkTable, fk.columnIds)
  const targetCols = cols(targetTable, target.columnIds)
  if (fkCols.length === 0 || fkCols.length !== targetCols.length) return undefined
  let s = r.name ? `CONSTRAINT ${quoteIdent(r.name)} ` : ''
  s += `FOREIGN KEY (${fkCols.map((c) => quoteIdent(c.name)).join(', ')}) REFERENCES ${quoteIdent(ctx.tableName(targetTable))} (${targetCols.map((c) => quoteIdent(c.name)).join(', ')})`
  if (r.onDelete) s += ` ON DELETE ${r.onDelete.toUpperCase()}`
  if (r.onUpdate) s += ` ON UPDATE ${r.onUpdate.toUpperCase()}`
  return s
}

function createTable(t: Table, ctx: Ctx): string {
  const pkIds = primaryKeyColumnIds(t)
  const singlePkId = pkIds.length === 1 ? pkIds[0] : undefined
  const lines: string[] = []
  if (t.note) lines.push(...commentLines(t.note))
  lines.push(`CREATE TABLE ${quoteIdent(ctx.tableName(t))} (`)
  const body: string[] = []
  for (const c of t.columns) {
    const def = columnDef(c, t, c.id === singlePkId, ctx)
    body.push(c.note ? `${commentLines(c.note, '  ').join('\n')}\n  ${def}` : `  ${def}`)
  }
  if (pkIds.length > 1) {
    const names = pkIds.map((id) => t.columns.find((c) => c.id === id)).filter((c): c is Column => c !== undefined)
    body.push(`  PRIMARY KEY (${names.map((c) => quoteIdent(c.name)).join(', ')})`)
  }
  for (const i of t.indexes) {
    if (i.pk || !i.unique || i.columnIds.length < 2) continue
    const names = i.columnIds.map((id) => t.columns.find((c) => c.id === id)).filter((c): c is Column => c !== undefined)
    if (names.length !== i.columnIds.length) continue
    body.push(`  ${i.name ? `CONSTRAINT ${quoteIdent(i.name)} ` : ''}UNIQUE (${names.map((c) => quoteIdent(c.name)).join(', ')})`)
  }
  for (const r of ctx.schema.refs) {
    if (r.kind === '<>') continue
    if (fkSide(r).fk.tableId !== t.id) continue
    const fk = fkConstraint(r, ctx)
    if (fk) body.push(`  ${fk}`)
  }
  lines.push(body.join(',\n'))
  lines.push(');')
  return lines.join('\n')
}

function createIndexes(t: Table, ctx: Ctx): string[] {
  const out: string[] = []
  const table = ctx.tableName(t)
  for (const i of t.indexes) {
    if (i.pk) continue
    if (i.unique && i.columnIds.length >= 2) continue // emitted inline as a UNIQUE table constraint
    const cols = i.columnIds.map((id) => t.columns.find((c) => c.id === id)).filter((c): c is Column => c !== undefined)
    if (cols.length === 0 || cols.length !== i.columnIds.length) continue
    if (i.unique && cols.length === 1 && cols[0].unique) continue // already UNIQUE on the column
    const name = i.name ?? `${table}_${cols.map((c) => c.name).join('_')}_idx`.replace(/[^A-Za-z0-9_]+/g, '_')
    const head = i.note ? `${commentLines(i.note).join('\n')}\n` : ''
    out.push(`${head}CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols.map((c) => quoteIdent(c.name)).join(', ')});`)
  }
  return out
}

export function generateSqlite(schema: Schema): { text: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const enumsByType = new Map<string, Enum>()
  for (const e of schema.enums) {
    enumsByType.set(e.name.toLowerCase(), e)
    if (e.schema) enumsByType.set(`${e.schema}.${e.name}`.toLowerCase(), e)
  }
  // SQLite has no schemas: `auth.sessions` is flattened to `auth_sessions` (unless that name is taken).
  const names = new Map<string, string>()
  const taken = new Set(schema.tables.filter((t) => !t.schema).map((t) => t.name))
  for (const t of schema.tables) {
    if (!t.schema) {
      names.set(t.id, t.name)
      continue
    }
    let flat = `${t.schema}_${t.name}`
    let n = 2
    while (taken.has(flat)) flat = `${t.schema}_${t.name}_${n++}`
    taken.add(flat)
    names.set(t.id, flat)
    diagnostics.push(
      diag({
        severity: 'info',
        source: 'sql',
        lossy: true,
        tableId: t.id,
        message: `SQLite has no schemas: ${t.schema}.${t.name} is exported as "${flat}"`,
      }),
    )
  }
  const ctx: Ctx = { schema, enumsByType, tableName: (t) => names.get(t.id) ?? t.name, diagnostics }

  const blocks: string[] = ['-- SQLite DDL generated by DBridge', 'PRAGMA foreign_keys = ON;']
  const ordered = topologicalTables(schema)
  for (const t of ordered) blocks.push(createTable(t, ctx))
  const indexes = ordered.flatMap((t) => createIndexes(t, ctx))
  if (indexes.length > 0) blocks.push(indexes.join('\n\n'))
  return { text: `${blocks.join('\n\n')}\n`, diagnostics }
}

/**
 * DBML text -> Schema IR via @dbml/core.
 *
 * We parse with the `dbmlv2` compiler (the one dbdiagram.io ships today) rather than the legacy
 * `dbml` PEG grammar: it resolves table aliases in refs, keeps header colours as written, supports
 * sticky `Note` blocks and `Ref` colours, and reports semantic errors ("A Table must have at least
 * one column") with accurate positions. Both surface `CompilerError.diags[]` the same way.
 */
import { CompilerError, Parser } from '@dbml/core'
import type { Column, Diagnostic, Enum, Index, Ref, RefAction, RefKind, Schema, Table } from '../schema'
import { diag, emptySchema, newId } from '../schema'

// ---------- minimal structural view of the @dbml/core model (runtime shape verified against 10.1.1) ----------

interface Pos {
  offset: number
  line: number
  column: number
}
interface Tok {
  start: Pos
  end: Pos
}
interface DbColumnType {
  schemaName: string | null
  type_name: string
  args: string | null
}
interface DbDefault {
  type: string
  value: unknown
}
interface DbField {
  name: string
  type: DbColumnType
  pk?: boolean
  unique?: boolean
  not_null?: boolean
  increment?: boolean
  dbdefault?: DbDefault | null
  note?: string | null
  token?: Tok
}
interface DbIndexColumn {
  type: 'column' | 'expression'
  value: string
}
interface DbIndex {
  name?: string | null
  pk?: boolean | string | null
  unique?: boolean | null
  type?: string | null
  note?: string | null
  columns: DbIndexColumn[]
  token?: Tok
}
interface DbTable {
  name: string
  alias?: string | null
  note?: string | null
  headerColor?: string | null
  fields: DbField[]
  indexes: DbIndex[]
  token?: Tok
}
interface DbEndpoint {
  schemaName: string | null
  tableName: string
  fieldNames: string[]
  relation: string
}
interface DbRef {
  name?: string | null
  onDelete?: string | null
  onUpdate?: string | null
  endpoints: DbEndpoint[]
  token?: Tok
}
interface DbEnumValue {
  name: string
  note?: string | null
}
interface DbEnum {
  name: string
  note?: string | null
  values: DbEnumValue[]
}
interface DbSchema {
  name: string
  tables: DbTable[]
  refs: DbRef[]
  enums: DbEnum[]
  tableGroups: { token?: Tok }[]
}
interface DbDatabase {
  schemas: DbSchema[]
  notes?: { token?: Tok }[]
  name?: string | null
  note?: string | null
  token?: Tok | null
}

interface CompilerDiag {
  message: string
  location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
}

export interface ParseResult {
  /** Present only when there are zero error-severity diagnostics. */
  schema?: Schema
  diagnostics: Diagnostic[]
}

const DEFAULT_SCHEMA = 'public'

/** `undefined` for the default schema so unqualified and `public.`-qualified names collapse together. */
export function normalizeSchemaName(name: string | null | undefined): string | undefined {
  return !name || name === DEFAULT_SCHEMA ? undefined : name
}

const tableKey = (schema: string | null | undefined, name: string): string =>
  `${normalizeSchemaName(schema) ?? ''}.${name}`

const ONE_SIDE = new Set(['1', '0..1', '1..1'])
const isOneSide = (relation: string): boolean => ONE_SIDE.has(relation)

/** `*→1` = `>`, `1→*` = `<`, `1→1` = `-`, `*→*` = `<>` (endpoint order as written). */
export function relationsToKind(from: string, to: string): RefKind {
  const fromOne = isOneSide(from)
  const toOne = isOneSide(to)
  if (!fromOne && toOne) return '>'
  if (fromOne && !toOne) return '<'
  if (fromOne && toOne) return '-'
  return '<>'
}

const ACTIONS: RefAction[] = ['cascade', 'restrict', 'set null', 'set default', 'no action']
function toAction(value: string | null | undefined): RefAction | undefined {
  if (!value) return undefined
  const v = value.toLowerCase().trim()
  return ACTIONS.find((a) => a === v)
}

/** Escape a string for a single-quoted DBML literal body. */
export function escapeDbmlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')
}

export function quoteDbmlString(s: string): string {
  return `'${escapeDbmlString(s)}'`
}

/** Raw DBML default expression from the model's `{type, value}` default. */
export function defaultToDbml(d: DbDefault): string {
  switch (d.type) {
    case 'string':
      return quoteDbmlString(String(d.value))
    case 'expression':
      return `\`${String(d.value)}\``
    default:
      // number, boolean (also carries `null`)
      return String(d.value)
  }
}

function columnTypeToString(t: DbColumnType): string {
  const schema = normalizeSchemaName(t.schemaName)
  return schema ? `${schema}.${t.type_name}` : t.type_name
}

function optional<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined || v === '' ? undefined : v
}

function compilerDiagnostics(err: unknown, source: Diagnostic['source']): Diagnostic[] {
  if (err instanceof CompilerError || (typeof err === 'object' && err !== null && Array.isArray((err as { diags?: unknown }).diags))) {
    const diags = (err as { diags: CompilerDiag[] }).diags
    if (diags.length > 0) {
      return diags.map((d) =>
        diag({
          severity: 'error',
          source,
          message: d.message,
          line: d.location?.start?.line,
          col: d.location?.start?.column,
          endLine: d.location?.end?.line,
          endCol: d.location?.end?.column,
        }),
      )
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return [diag({ severity: 'error', source, message })]
}

/** Map a thrown @dbml/core error to diagnostics for the given source. Shared with the SQL importer. */
export { compilerDiagnostics }

function slice(src: string, tok: Tok | null | undefined): string | undefined {
  if (!tok?.start || !tok.end) return undefined
  if (typeof tok.start.offset !== 'number' || typeof tok.end.offset !== 'number') return undefined
  const text = src.slice(tok.start.offset, tok.end.offset).trim()
  return text.length > 0 ? text : undefined
}

// ---------- main ----------

/**
 * Parse DBML text into the IR. Never throws: syntax/semantic errors come back as diagnostics with
 * 1-based line/column and `schema` is omitted.
 */
export function parseDbml(text: string): ParseResult {
  let db: DbDatabase
  try {
    db = new Parser().parse(text, 'dbmlv2') as unknown as DbDatabase
  } catch (err) {
    return { diagnostics: compilerDiagnostics(err, 'dbml') }
  }

  const diagnostics: Diagnostic[] = []
  const schema = emptySchema()

  // Project block: keep name/note for other views and the whole block verbatim for re-emission.
  schema.project.name = optional(db.name)
  schema.project.note = optional(db.note)
  const passthrough: { offset: number; text: string }[] = []
  const projectText = slice(text, db.token)
  if (projectText && /^Project\b/i.test(projectText)) {
    passthrough.push({ offset: db.token!.start.offset, text: projectText })
  }
  for (const n of db.notes ?? []) {
    const t = slice(text, n.token)
    if (t) passthrough.push({ offset: n.token!.start.offset, text: t })
  }

  const tablesByKey = new Map<string, Table>()

  for (const s of db.schemas) {
    const schemaName = normalizeSchemaName(s.name)

    for (const e of s.enums) {
      const en: Enum = {
        id: newId(),
        name: e.name,
        values: e.values.map((v) => ({ id: newId(), name: v.name, note: optional(v.note) })),
      }
      if (schemaName) en.schema = schemaName
      const note = optional(e.note)
      if (note) en.note = note
      schema.enums.push(en)
    }

    for (const t of s.tables) {
      const table: Table = { id: newId(), name: t.name, columns: [], indexes: [] }
      if (schemaName) table.schema = schemaName
      const alias = optional(t.alias)
      if (alias) table.alias = alias
      const note = optional(t.note)
      if (note) table.note = note
      const color = optional(t.headerColor)
      if (color) table.headerColor = color

      for (const f of t.fields) {
        const col: Column = {
          id: newId(),
          name: f.name,
          type: columnTypeToString(f.type),
          pk: Boolean(f.pk),
          unique: Boolean(f.unique),
          notNull: Boolean(f.not_null),
          increment: Boolean(f.increment),
        }
        if (f.dbdefault) col.default = defaultToDbml(f.dbdefault)
        const cnote = optional(f.note)
        if (cnote) col.note = cnote
        table.columns.push(col)
      }

      for (const i of t.indexes) {
        const expr = i.columns.filter((c) => c.type !== 'column')
        if (expr.length > 0) {
          diagnostics.push(
            diag({
              severity: 'warning',
              source: 'dbml',
              lossy: true,
              message: `Index on expression ${expr.map((c) => `\`${c.value}\``).join(', ')} in table "${t.name}" is not representable and was dropped`,
              line: i.token?.start.line,
              col: i.token?.start.column,
              tableId: table.id,
            }),
          )
          continue
        }
        const columnIds: string[] = []
        for (const c of i.columns) {
          const col = table.columns.find((x) => x.name === c.value)
          if (col) columnIds.push(col.id)
        }
        if (columnIds.length === 0) continue
        const idx: Index = { id: newId(), columnIds, unique: Boolean(i.unique), pk: Boolean(i.pk) }
        const iname = optional(i.name)
        if (iname) idx.name = iname
        const itype = optional(i.type)
        if (itype) idx.type = itype
        const inote = optional(i.note)
        if (inote) idx.note = inote
        table.indexes.push(idx)
      }

      schema.tables.push(table)
      tablesByKey.set(tableKey(s.name, t.name), table)
    }

    for (const g of s.tableGroups) {
      const t = slice(text, g.token)
      if (t) passthrough.push({ offset: g.token!.start.offset, text: t })
    }
  }

  for (const s of db.schemas) {
    for (const r of s.refs) {
      if (r.endpoints.length !== 2) continue
      const [a, b] = r.endpoints
      const from = resolveEndpoint(a, tablesByKey)
      const to = resolveEndpoint(b, tablesByKey)
      if (!from || !to) {
        diagnostics.push(
          diag({
            severity: 'error',
            source: 'dbml',
            message: `Unresolved reference ${a.tableName}.${a.fieldNames.join(',')} -> ${b.tableName}.${b.fieldNames.join(',')}`,
            line: r.token?.start.line,
            col: r.token?.start.column,
          }),
        )
        continue
      }
      const ref: Ref = { id: newId(), from, to, kind: relationsToKind(a.relation, b.relation) }
      const name = optional(r.name)
      if (name) ref.name = name
      const onDelete = toAction(r.onDelete)
      if (onDelete) ref.onDelete = onDelete
      const onUpdate = toAction(r.onUpdate)
      if (onUpdate) ref.onUpdate = onUpdate
      schema.refs.push(ref)
    }
  }

  if (passthrough.length > 0) {
    passthrough.sort((x, y) => x.offset - y.offset)
    schema.project.passthrough = passthrough.map((p) => p.text)
  }

  if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics }
  return { schema, diagnostics }
}

function resolveEndpoint(
  e: DbEndpoint,
  tables: Map<string, Table>,
): { tableId: string; columnIds: string[] } | undefined {
  const table = tables.get(tableKey(e.schemaName, e.tableName))
  if (!table) return undefined
  const columnIds: string[] = []
  for (const name of e.fieldNames) {
    const col = table.columns.find((c) => c.name === name)
    if (!col) return undefined
    columnIds.push(col.id)
  }
  return { tableId: table.id, columnIds }
}

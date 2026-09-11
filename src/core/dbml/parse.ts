/**
 * DBML text -> Schema IR via @dbml/parse (the `dbmlv2` compiler that dbdiagram.io ships and that
 * @dbml/core wraps). We use the compiler directly instead of @dbml/core's `Parser` so the DBML
 * editing path does not load @dbml/core's 15 MB bundle of ANTLR SQL grammars; that bundle is only
 * dynamically imported by `src/core/sql` for SQL import/export.
 *
 * The compiler already resolves table aliases in refs, hoists inline `[ref: ...]` settings into
 * `rawDb.refs`, unescapes strings and validates semantics ("A Table must have at least one column",
 * unknown columns in refs, ...). Errors carry character offsets; we map them to 1-based line/col.
 */
import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from '@dbml/parse'
import type {
  Column as RawColumn,
  Database as RawDatabase,
  Enum as RawEnum,
  Index as RawIndex,
  Ref as RawRef,
  RefEndpoint as RawEndpoint,
  Table as RawTable,
  TokenPosition,
} from '@dbml/parse'
import type { Column, Diagnostic, Enum, Index, Ref, RefAction, RefKind, Schema, Table } from '../schema'
import { diag, emptySchema, newId } from '../schema'
import { quoteDbmlString } from './strings'

export { escapeDbmlString, quoteDbmlString } from './strings'

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

/** One side of a relationship: `1`, `1..1`, `0..1` (the compiler's spellings of "one"). */
const isOneSide = (relation: string): boolean => /^(0|1)?(\.\.)?1$/.test(relation) || relation === '1'

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

/** Raw DBML default expression from the compiler's `{type, value}` default. */
export function defaultToDbml(d: { type: string; value: unknown }): string {
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

function columnTypeToString(t: RawColumn['type']): string {
  const schema = normalizeSchemaName(t.schemaName)
  return schema ? `${schema}.${t.type_name}` : t.type_name
}

function optional<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined || v === '' ? undefined : v
}

// ---------- positions ----------

/** Maps character offsets to 1-based line/column. */
class LineIndex {
  private readonly starts: number[] = [0]
  constructor(text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1)
  }
  at(offset: number): { line: number; col: number } {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, col: offset - this.starts[lo] + 1 }
  }
}

interface CompileDiag {
  diagnostic?: string
  message?: string
  start?: number
  end?: number
}

/**
 * Map a thrown error carrying `diags[]` (e.g. @dbml/core's `CompilerError`, or anything shaped like
 * it) to diagnostics for the given source. Positions are taken as-is when present. Shared with the
 * SQL importer/exporter, which is why this does not import @dbml/core.
 */
export function compilerDiagnostics(err: unknown, source: Diagnostic['source']): Diagnostic[] {
  const diags = (err as { diags?: unknown } | null)?.diags
  if (Array.isArray(diags) && diags.length > 0) {
    return (diags as { message?: string; location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } } }[]).map((d) =>
      diag({
        severity: 'error',
        source,
        message: d.message ?? 'unknown error',
        line: d.location?.start?.line,
        col: d.location?.start?.column,
        endLine: d.location?.end?.line,
        endCol: d.location?.end?.column,
      }),
    )
  }
  const message = err instanceof Error ? err.message : String(err)
  return [diag({ severity: 'error', source, message })]
}

function slice(src: string, tok: TokenPosition | null | undefined): string | undefined {
  if (!tok?.start || !tok.end) return undefined
  const text = src.slice(tok.start.offset, tok.end.offset).trim()
  return text.length > 0 ? text : undefined
}

const pos = (tok: TokenPosition | undefined): { line?: number; col?: number } =>
  tok?.start ? { line: tok.start.line, col: tok.start.column } : {}

// ---------- main ----------

/**
 * Parse DBML text into the IR. Never throws: syntax/semantic errors come back as diagnostics with
 * 1-based line/column and `schema` is omitted.
 */
export function parseDbml(text: string): ParseResult {
  let raw: Readonly<RawDatabase> | undefined
  let errors: readonly CompileDiag[]
  try {
    const compiler = new Compiler(new MemoryProjectLayout({ [DEFAULT_ENTRY.absolute]: text }))
    errors = compiler.parse.errors()
    raw = errors.length === 0 ? compiler.parse.rawDb() : undefined
  } catch (err) {
    return { diagnostics: compilerDiagnostics(err, 'dbml') }
  }

  if (errors.length > 0) {
    const index = new LineIndex(text)
    return {
      diagnostics: errors.map((e) => {
        const start = typeof e.start === 'number' ? index.at(e.start) : undefined
        const end = typeof e.end === 'number' ? index.at(e.end) : undefined
        return diag({
          severity: 'error',
          source: 'dbml',
          message: e.diagnostic ?? e.message ?? 'Syntax error',
          line: start?.line,
          col: start?.col,
          endLine: end?.line,
          endCol: end?.col,
        })
      }),
    }
  }

  const diagnostics: Diagnostic[] = []
  const schema = emptySchema()
  if (!raw) return { schema, diagnostics }

  // Project block: keep name/note for other views and the whole block verbatim for re-emission.
  const project = raw.project && 'name' in raw.project ? raw.project : undefined
  schema.project.name = optional(project?.name)
  schema.project.note = optional(project?.note?.value)
  const passthrough: { offset: number; text: string }[] = []
  const projectText = project ? slice(text, project.token) : undefined
  if (projectText && /^Project\b/i.test(projectText)) {
    passthrough.push({ offset: project!.token.start.offset, text: projectText })
  }
  for (const n of raw.notes) {
    const t = slice(text, n.token)
    if (t) passthrough.push({ offset: n.token.start.offset, text: t })
  }
  for (const g of raw.tableGroups) {
    const t = slice(text, g.token)
    if (t) passthrough.push({ offset: g.token.start.offset, text: t })
  }

  for (const e of raw.enums) schema.enums.push(convertEnum(e))

  const tablesByKey = new Map<string, Table>()
  for (const t of raw.tables) {
    const table = convertTable(t, diagnostics)
    schema.tables.push(table)
    tablesByKey.set(tableKey(t.schemaName, t.name), table)
  }

  for (const r of raw.refs) {
    const ref = convertRef(r, tablesByKey, diagnostics)
    if (ref) schema.refs.push(ref)
  }

  if (passthrough.length > 0) {
    passthrough.sort((x, y) => x.offset - y.offset)
    schema.project.passthrough = passthrough.map((p) => p.text)
  }

  if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics }
  return { schema, diagnostics }
}

function convertEnum(e: RawEnum): Enum {
  const en: Enum = {
    id: newId(),
    name: e.name,
    values: e.values.map((v) => {
      const value: Enum['values'][number] = { id: newId(), name: v.name }
      const note = optional(v.note?.value)
      if (note) value.note = note
      return value
    }),
  }
  const schemaName = normalizeSchemaName(e.schemaName)
  if (schemaName) en.schema = schemaName
  return en
}

function convertTable(t: RawTable, diagnostics: Diagnostic[]): Table {
  const table: Table = { id: newId(), name: t.name, columns: [], indexes: [] }
  const schemaName = normalizeSchemaName(t.schemaName)
  if (schemaName) table.schema = schemaName
  const alias = optional(t.alias)
  if (alias) table.alias = alias
  const note = optional(t.note?.value)
  if (note) table.note = note
  const color = optional(t.headerColor)
  if (color && color !== 'none') table.headerColor = color

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
    const cnote = optional(f.note?.value)
    if (cnote) col.note = cnote
    table.columns.push(col)
  }

  for (const i of t.indexes) {
    const idx = convertIndex(i, t, table, diagnostics)
    if (idx) table.indexes.push(idx)
  }
  return table
}

function convertIndex(i: RawIndex, t: RawTable, table: Table, diagnostics: Diagnostic[]): Index | undefined {
  const expr = i.columns.filter((c) => c.type !== 'column')
  if (expr.length > 0) {
    diagnostics.push(
      diag({
        severity: 'warning',
        source: 'dbml',
        lossy: true,
        message: `Index on expression ${expr.map((c) => `\`${c.value}\``).join(', ')} in table "${t.name}" is not representable and was dropped`,
        ...pos(i.token),
        tableId: table.id,
      }),
    )
    return undefined
  }
  const columnIds: string[] = []
  for (const c of i.columns) {
    const col = table.columns.find((x) => x.name === c.value)
    if (col) columnIds.push(col.id)
  }
  if (columnIds.length === 0) return undefined
  const idx: Index = { id: newId(), columnIds, unique: Boolean(i.unique), pk: Boolean(i.pk) }
  const iname = optional(i.name)
  if (iname) idx.name = iname
  const itype = optional(i.type)
  if (itype) idx.type = itype
  const inote = optional(i.note?.value)
  if (inote) idx.note = inote
  return idx
}

function convertRef(r: RawRef, tables: Map<string, Table>, diagnostics: Diagnostic[]): Ref | undefined {
  if (r.endpoints.length !== 2) return undefined
  const [a, b] = r.endpoints
  const from = resolveEndpoint(a, tables)
  const to = resolveEndpoint(b, tables)
  if (!from || !to) {
    diagnostics.push(
      diag({
        severity: 'error',
        source: 'dbml',
        message: `Unresolved reference ${a.tableName}.${a.fieldNames.join(',')} -> ${b.tableName}.${b.fieldNames.join(',')}`,
        ...pos(r.token),
      }),
    )
    return undefined
  }
  const ref: Ref = { id: newId(), from, to, kind: relationsToKind(a.relation, b.relation) }
  const name = optional(r.name)
  if (name) ref.name = name
  const onDelete = toAction(r.onDelete)
  if (onDelete) ref.onDelete = onDelete
  const onUpdate = toAction(r.onUpdate)
  if (onUpdate) ref.onUpdate = onUpdate
  return ref
}

function resolveEndpoint(e: RawEndpoint, tables: Map<string, Table>): { tableId: string; columnIds: string[] } | undefined {
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

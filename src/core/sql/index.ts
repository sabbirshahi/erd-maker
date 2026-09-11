/**
 * SQL DDL <-> IR via @dbml/core. OWNER: worker-1 (core-dbml).
 *  - `importSql(sql, dialect | 'auto')`: pre-cleans vendor noise, runs the @dbml/core importer, then
 *    validates the result through our own DBML parser so callers get canonical DBML (+ the Schema).
 *  - `exportSql(schema, dialect)`: postgres/mysql via `ModelExporter`, sqlite via our own generator
 *    (SQLite cannot add foreign keys after the fact). Never throws; diagnostics instead.
 *
 * Both are async: @dbml/core (15 MB of ANTLR SQL grammars) is loaded with a dynamic `import()` on
 * first use, so the DBML editing path (which only needs @dbml/parse) never pays for it.
 */
import type { Diagnostic, Schema } from '../schema'
import { diag } from '../schema'
import { generateDbml, parseDbml } from '../dbml'
import { compilerDiagnostics } from '../dbml/parse'
import { cleanSql, detectDialect } from './clean'
import { normalizeForSql } from './normalize'
import { generateSqlite } from './sqlite'

type DbmlCore = typeof import('@dbml/core')
let corePromise: Promise<DbmlCore> | undefined

/** Load @dbml/core once (dynamic import keeps it out of the DBML editor's chunk graph). */
export function loadSqlEngine(): Promise<DbmlCore> {
  corePromise ??= import('@dbml/core')
  return corePromise
}

export type SqlImportDialect = 'postgres' | 'mysql' | 'mssql'
export type SqlExportDialect = 'postgres' | 'mysql' | 'sqlite'

export { cleanSql, detectDialect, splitStatements } from './clean'
export { normalizeForSql } from './normalize'
export { generateSqlite, sqliteType, sqliteDefault, SQLITE_TYPES } from './sqlite'

export interface SqlImportResult {
  /** Canonical DBML (our generator's formatting) when the import succeeded. */
  dbml?: string
  /** Parsed Schema of `dbml`; saves callers a second parse. */
  schema?: Schema
  /** The dialect actually used (resolved when `'auto'` was requested). */
  dialect: SqlImportDialect
  diagnostics: Diagnostic[]
}

export const SQL_DIALECT_LABELS: Record<SqlImportDialect | SqlExportDialect, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mssql: 'SQL Server',
  sqlite: 'SQLite',
}

interface SqlDiag {
  message?: string
  location?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
}

/** Map an importer failure to diagnostics. ANTLR reports 0-based columns; we expose 1-based. */
function importErrorDiagnostics(err: unknown, dialect: SqlImportDialect): Diagnostic[] {
  const label = SQL_DIALECT_LABELS[dialect]
  const diags = (err as { diags?: unknown } | null)?.diags
  if (Array.isArray(diags) && diags.length > 0) {
    return (diags as SqlDiag[]).map((d) => {
      const start = d.location?.start
      const end = d.location?.end
      const hasPos = typeof start?.line === 'number'
      return diag({
        severity: 'error',
        source: 'sql',
        message: hasPos ? `${label}: ${d.message ?? 'syntax error'}` : `${label} import failed: ${d.message ?? 'unknown error'}`,
        line: hasPos ? start!.line : undefined,
        col: hasPos && typeof start?.column === 'number' ? start.column + 1 : undefined,
        endLine: typeof end?.line === 'number' ? end.line : undefined,
        endCol: typeof end?.column === 'number' ? end.column + 1 : undefined,
      })
    })
  }
  const message = err instanceof Error ? err.message : String(err)
  return [diag({ severity: 'error', source: 'sql', message: `${label} import failed: ${message}` })]
}

/** SQL DDL -> canonical DBML text (+ Schema). Returns diagnostics instead of throwing. */
export async function importSql(sql: string, dialect: SqlImportDialect | 'auto'): Promise<SqlImportResult> {
  const resolved: SqlImportDialect = dialect === 'auto' ? detectDialect(sql) : dialect
  if (sql.trim().length === 0) {
    return {
      dialect: resolved,
      diagnostics: [diag({ severity: 'error', source: 'sql', message: 'Nothing to import: the SQL text is empty' })],
    }
  }
  const cleaned = cleanSql(sql, resolved)
  let rawDbml: string
  try {
    const { importer } = await loadSqlEngine()
    rawDbml = importer.import(cleaned, resolved)
  } catch (err) {
    return { dialect: resolved, diagnostics: importErrorDiagnostics(err, resolved) }
  }
  if (rawDbml.trim().length === 0) {
    return {
      dialect: resolved,
      diagnostics: [
        diag({
          severity: 'error',
          source: 'sql',
          message: `No CREATE TABLE statements found in the ${SQL_DIALECT_LABELS[resolved]} DDL${dialect === 'auto' ? ' (dialect was auto-detected; try choosing it explicitly)' : ''}`,
        }),
      ],
    }
  }
  const parsed = parseDbml(rawDbml)
  // Positions in these diagnostics refer to the intermediate DBML, not the user's SQL: strip them.
  const diagnostics = parsed.diagnostics.map((d) => {
    const { line: _l, col: _c, endLine: _el, endCol: _ec, ...rest } = d
    void _l
    void _c
    void _el
    void _ec
    return { ...rest, source: 'sql' as const, message: parsed.schema ? rest.message : `Imported DDL produced DBML we could not parse: ${rest.message}` }
  })
  if (!parsed.schema) return { dialect: resolved, diagnostics }
  return { dialect: resolved, dbml: generateDbml(parsed.schema), schema: parsed.schema, diagnostics }
}

/** Types Postgres users write that MySQL does not have; the exporter passes them through verbatim. */
const MYSQL_UNSUPPORTED: Record<string, string> = {
  timestamptz: 'timestamp',
  uuid: 'char(36)',
  jsonb: 'json',
  bytea: 'blob',
  serial: 'int auto_increment',
  bigserial: 'bigint auto_increment',
  inet: 'varchar(45)',
  citext: 'text',
}

function mysqlTypeDiagnostics(schema: Schema): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const t of schema.tables) {
    for (const c of t.columns) {
      const base = c.type.replace(/\(.*$/, '').trim().toLowerCase()
      const hint = c.type.trim().endsWith('[]') ? 'json' : MYSQL_UNSUPPORTED[base]
      if (!hint) continue
      out.push(
        diag({
          severity: 'warning',
          source: 'sql',
          lossy: true,
          tableId: t.id,
          columnId: c.id,
          message: `${t.name}.${c.name}: MySQL has no \`${c.type}\` type; consider \`${hint}\``,
        }),
      )
    }
  }
  return out
}

export interface SqlExportResult {
  text: string
  diagnostics: Diagnostic[]
}

/** Schema -> SQL DDL. sqlite is generated directly; postgres/mysql go through @dbml/core's exporter. */
export async function exportSql(schema: Schema, dialect: SqlExportDialect): Promise<SqlExportResult> {
  const normalized = normalizeForSql(schema)
  const diagnostics = [...normalized.diagnostics]
  if (dialect === 'sqlite') {
    const r = generateSqlite(normalized.schema)
    return { text: r.text, diagnostics: [...diagnostics, ...r.diagnostics] }
  }
  if (dialect === 'mysql') diagnostics.push(...mysqlTypeDiagnostics(normalized.schema))
  // Diagram-only blocks (Project/TableGroup/Note) carry nothing for DDL.
  const forExport: Schema = { ...normalized.schema, project: { appLabel: normalized.schema.project.appLabel } }
  const dbml = generateDbml(forExport)
  if (dbml.trim().length === 0) return { text: '', diagnostics }
  try {
    const { ModelExporter, Parser } = await loadSqlEngine()
    const db = new Parser().parse(dbml, 'dbmlv2')
    const text = ModelExporter.export(db, dialect, false)
    return { text: text.endsWith('\n') ? text : `${text}\n`, diagnostics }
  } catch (err) {
    const mapped = compilerDiagnostics(err, 'sql').map((d) => ({ ...d, line: undefined, col: undefined, endLine: undefined, endCol: undefined }))
    return { text: '', diagnostics: [...diagnostics, ...mapped] }
  }
}

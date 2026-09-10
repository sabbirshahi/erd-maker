import type { Diagnostic, Schema } from '../schema'

export type SqlImportDialect = 'postgres' | 'mysql' | 'mssql'
export type SqlExportDialect = 'postgres' | 'mysql' | 'sqlite'

/** SQL DDL -> DBML text using @dbml/core importer, with pre-cleaning of vendor noise. OWNER: worker-1. Stub. */
export function importSql(sql: string, dialect: SqlImportDialect | 'auto'): { dbml?: string; diagnostics: Diagnostic[] } {
  void sql; void dialect
  return { diagnostics: [{ id: 'stub', severity: 'error', source: 'sql', message: 'importSql not implemented' }] }
}

/** Schema -> SQL DDL. sqlite is derived from the postgres export via a type-rewrite table. OWNER: worker-1. Stub. */
export function exportSql(schema: Schema, dialect: SqlExportDialect): { text: string; diagnostics: Diagnostic[] } {
  void schema; void dialect
  return { text: '-- exportSql not implemented\n', diagnostics: [] }
}

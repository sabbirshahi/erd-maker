import type { Diagnostic, Schema } from '../schema'

export interface ParseResult {
  /** Present only when there are zero error-severity diagnostics. */
  schema?: Schema
  diagnostics: Diagnostic[]
}

/**
 * Parse DBML text with @dbml/core into the IR. Never throws.
 * OWNER: worker-1 (core-dbml). Stub.
 */
export function parseDbml(text: string): ParseResult {
  void text
  return { diagnostics: [{ id: 'stub', severity: 'error', source: 'dbml', message: 'parseDbml not implemented' }] }
}

/**
 * Deterministic DBML generation from the IR. Must be idempotent: generate(parse(generate(s))) === generate(s).
 * OWNER: worker-1 (core-dbml). Stub.
 */
export function generateDbml(schema: Schema): string {
  void schema
  return '// generateDbml not implemented\n'
}

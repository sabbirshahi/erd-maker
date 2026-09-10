import type { Diagnostic, Schema } from '../schema'

export interface GenerateResult {
  text: string
  diagnostics: Diagnostic[]
}

export interface DjangoParseResult {
  schema?: Schema
  diagnostics: Diagnostic[]
}

/**
 * Schema -> models.py (Django 5.2+ syntax). Emits lossy-mapping diagnostics (source 'typemap').
 * OWNER: worker-4 (core-django). Stub.
 */
export function generateDjango(schema: Schema): GenerateResult {
  void schema
  return { text: '# generateDjango not implemented\n', diagnostics: [] }
}

/** Loads tree-sitter + python grammar (idempotent). OWNER: worker-4. Stub. */
export async function initDjangoParser(): Promise<void> {}

/**
 * models.py -> Schema via tree-sitter CST. Unrecognised class-body statements go to table.django.passthrough.
 * Never throws. OWNER: worker-4 (core-django). Stub.
 */
export async function parseDjango(text: string): Promise<DjangoParseResult> {
  void text
  return { diagnostics: [{ id: 'stub', severity: 'error', source: 'django', message: 'parseDjango not implemented' }] }
}

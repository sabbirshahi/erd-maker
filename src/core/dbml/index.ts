/**
 * DBML <-> IR. OWNER: worker-1 (core-dbml).
 *  - `parseDbml(text)`: @dbml/core compiler -> Schema, never throws (diagnostics instead).
 *  - `generateDbml(schema)`: deterministic, idempotent text generation.
 */
export { parseDbml, type ParseResult } from './parse'
export { generateDbml } from './generate'

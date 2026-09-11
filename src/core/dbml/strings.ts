/** DBML string-literal helpers shared by the parser and the generator (no @dbml/core dependency). */

/** Escape a string for a single-quoted DBML literal body. */
export function escapeDbmlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')
}

export function quoteDbmlString(s: string): string {
  return `'${escapeDbmlString(s)}'`
}

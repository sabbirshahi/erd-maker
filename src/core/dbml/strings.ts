/** DBML string-literal helpers shared by the parser and the generator (no @dbml/core dependency). */

/** Escape a string for a single-quoted DBML literal body. */
export function escapeDbmlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')
}

export function quoteDbmlString(s: string): string {
  return `'${escapeDbmlString(s)}'`
}

/**
 * Normalise a default value into a valid DBML literal.
 *
 * Defaults reach the IR from two directions: the parser stores them already in DBML literal form
 * (strings quoted, expressions in backticks), while the inspector stores exactly what the user
 * typed. Emitting the latter verbatim produced invalid DBML like `[default: hello]`, so anything
 * that is not already a literal is quoted here.
 */
export function formatDbmlDefault(raw: string): string {
  const v = raw.trim()
  if (v === '') return v
  // Already a literal: quoted string, backtick expression, number, boolean or null.
  if (/^'[\s\S]*'$/.test(v) || /^`[\s\S]*`$/.test(v)) return v
  if (/^"[\s\S]*"$/.test(v)) return quoteDbmlString(v.slice(1, -1))
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (/^(true|false|null)$/i.test(v)) return v.toLowerCase()
  return quoteDbmlString(v)
}

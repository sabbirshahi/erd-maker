/**
 * Canvas-sourced diagnostics, recomputed from the whole schema on every change so that
 * they disappear as soon as the user fixes the cause.
 */
import { diag, type Diagnostic, type Schema } from '@/core/schema'
import { typeMismatchWarning } from './connection'

export function canvasDiagnostics(schema: Schema): Diagnostic[] {
  const out: Diagnostic[] = []

  const seenTables = new Map<string, string>()
  for (const t of schema.tables) {
    const key = `${t.schema ?? ''}.${t.name}`
    if (!t.name.trim()) {
      out.push(diag({ severity: 'error', source: 'canvas', message: 'Table has an empty name', tableId: t.id }))
    } else if (seenTables.has(key)) {
      out.push(
        diag({ severity: 'error', source: 'canvas', message: `Duplicate table name \`${t.name}\``, tableId: t.id }),
      )
    } else {
      seenTables.set(key, t.id)
    }

    const seenCols = new Set<string>()
    for (const c of t.columns) {
      if (!c.name.trim()) {
        out.push(
          diag({
            severity: 'error',
            source: 'canvas',
            message: `Column in \`${t.name}\` has an empty name`,
            tableId: t.id,
            columnId: c.id,
          }),
        )
      } else if (seenCols.has(c.name)) {
        out.push(
          diag({
            severity: 'error',
            source: 'canvas',
            message: `Duplicate column name \`${c.name}\` in \`${t.name}\``,
            tableId: t.id,
            columnId: c.id,
          }),
        )
      } else {
        seenCols.add(c.name)
      }
      if (!c.type.trim()) {
        out.push(
          diag({
            severity: 'error',
            source: 'canvas',
            message: `Column \`${t.name}.${c.name}\` has no type`,
            tableId: t.id,
            columnId: c.id,
          }),
        )
      }
    }
  }

  for (const r of schema.refs) {
    const w = typeMismatchWarning(schema, r)
    if (w) out.push(w)
  }
  return out
}

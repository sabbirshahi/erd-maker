/**
 * Canvas-sourced diagnostics, recomputed from the whole schema on every change so that
 * they disappear as soon as the user fixes the cause.
 */
import { diag, findEnumByName, primaryKeyColumnIds, type Diagnostic, type Schema } from '@/core/schema'
import { typeMismatchWarning } from './connection'

/**
 * Short rule name, used to group rows in the Problems panel the way a compiler groups by check
 * rather than listing every message flat.
 */
export const RULES = {
  emptyName: 'Missing name',
  duplicateName: 'Duplicate name',
  missingType: 'Missing type',
  typeMismatch: 'Mismatched ref types',
  noPrimaryKey: 'No primary key',
  unusedEnum: 'Unused enum',
  unknownEnum: 'Unknown type',
} as const

export function canvasDiagnostics(schema: Schema): Diagnostic[] {
  const out: Diagnostic[] = []

  const seenTables = new Map<string, string>()
  for (const t of schema.tables) {
    const key = `${t.schema ?? ''}.${t.name}`
    if (!t.name.trim()) {
      out.push(diag({ severity: 'error', source: 'canvas', message: 'Table has an empty name', rule: RULES.emptyName, tableId: t.id }))
    } else if (seenTables.has(key)) {
      out.push(
        diag({ severity: 'error', source: 'canvas', rule: RULES.duplicateName, message: `Duplicate table name \`${t.name}\``, tableId: t.id }),
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
            rule: RULES.emptyName,
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
            rule: RULES.duplicateName,
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
            rule: RULES.missingType,
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

  // A table with no primary key is legal DBML, but it cannot be addressed by a relation and Django
  // will invent an `id` for it, so it is worth pointing out.
  for (const t of schema.tables) {
    if (t.columns.length > 0 && primaryKeyColumnIds(t).length === 0) {
      out.push(
        diag({
          severity: 'warning',
          source: 'canvas',
          rule: RULES.noPrimaryKey,
          message: `Table \`${t.name}\` has no primary key`,
          tableId: t.id,
        }),
      )
    }
  }

  // A column typed with an enum that does not exist: the type silently becomes text downstream.
  const enumNames = new Set(schema.enums.map((e) => e.name))
  const usedEnums = new Set<string>()
  for (const t of schema.tables) {
    for (const c of t.columns) {
      const bare = c.type.replace(/^.*\./, '').replace(/\(.*\)$/, '').trim()
      if (enumNames.has(bare)) usedEnums.add(bare)
    }
  }
  for (const e of schema.enums) {
    if (!usedEnums.has(e.name)) {
      out.push(
        diag({
          severity: 'info',
          source: 'canvas',
          rule: RULES.unusedEnum,
          message: `Enum \`${e.name}\` is not used by any column`,
        }),
      )
    }
  }

  void findEnumByName
  return out
}

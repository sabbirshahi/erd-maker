/**
 * Pure connection logic for drag-to-connect: validation, Ref construction and
 * the type-mismatch warning. No React, no DOM.
 */
import {
  diag,
  findColumn,
  findTable,
  fkSide,
  newId,
  type Diagnostic,
  type Ref,
  type RefKind,
  type Schema,
} from '@/core/schema'
import { parseHandleId } from './handles'

/** Shape shared by React Flow's `Connection` and `Edge`. */
export interface ConnectionLike {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ColumnRef {
  tableId: string
  columnId: string
}

export interface Endpoints {
  from: ColumnRef
  to: ColumnRef
}

export type ConnectionVerdict = { ok: true; warnings: Diagnostic[] } | { ok: false; reason: string }

/** Resolve both handles to existing (table, column) pairs. Null when either side is not a single column. */
export function resolveEndpoints(schema: Schema, conn: ConnectionLike): Endpoints | null {
  const s = parseHandleId(conn.sourceHandle)
  const t = parseHandleId(conn.targetHandle)
  if (!s || !t) return null
  if (conn.source && conn.source !== s.tableId) return null
  if (conn.target && conn.target !== t.tableId) return null
  if (!findColumn(schema, s.tableId, s.columnId) || !findColumn(schema, t.tableId, t.columnId)) return null
  return {
    from: { tableId: s.tableId, columnId: s.columnId },
    to: { tableId: t.tableId, columnId: t.columnId },
  }
}

const sameColumn = (a: ColumnRef, b: ColumnRef): boolean =>
  a.tableId === b.tableId && a.columnId === b.columnId

/** A single-column ref already links the two columns (in either direction). */
export function isDuplicateRef(schema: Schema, a: ColumnRef, b: ColumnRef): boolean {
  return schema.refs.some((r) => {
    if (r.from.columnIds.length !== 1 || r.to.columnIds.length !== 1) return false
    const f: ColumnRef = { tableId: r.from.tableId, columnId: r.from.columnIds[0] }
    const t: ColumnRef = { tableId: r.to.tableId, columnId: r.to.columnIds[0] }
    return (sameColumn(f, a) && sameColumn(t, b)) || (sameColumn(f, b) && sameColumn(t, a))
  })
}

/** Normalise a DBML type for comparison: case- and whitespace-insensitive. */
export const normaliseType = (t: string): string => t.trim().toLowerCase().replace(/\s+/g, '')

/** Warning when the FK column type differs from the referenced column type. */
export function typeMismatchWarning(schema: Schema, ref: Ref): Diagnostic | null {
  if (ref.kind === '<>') return null
  const { fk, target } = fkSide(ref)
  if (fk.columnIds.length !== 1 || target.columnIds.length !== 1) return null
  const fkCol = findColumn(schema, fk.tableId, fk.columnIds[0])
  const pkCol = findColumn(schema, target.tableId, target.columnIds[0])
  if (!fkCol || !pkCol) return null
  if (normaliseType(fkCol.type) === normaliseType(pkCol.type)) return null
  const fkTable = findTable(schema, fk.tableId)
  const pkTable = findTable(schema, target.tableId)
  return diag({
    severity: 'warning',
    source: 'canvas',
    message: `Type mismatch: ${fkTable?.name}.${fkCol.name} is \`${fkCol.type}\` but references ${pkTable?.name}.${pkCol.name} (\`${pkCol.type}\`)`,
    tableId: fk.tableId,
    columnId: fkCol.id,
    refId: ref.id,
  })
}

/** Decide whether a drag-to-connect may complete. Pure; safe to call on every pointer move. */
export function validateConnection(schema: Schema, conn: ConnectionLike): ConnectionVerdict {
  const ep = resolveEndpoints(schema, conn)
  if (!ep) return { ok: false, reason: 'Both ends must be a single existing column' }
  if (sameColumn(ep.from, ep.to)) return { ok: false, reason: 'Cannot reference the same column' }
  if (isDuplicateRef(schema, ep.from, ep.to)) return { ok: false, reason: 'These columns are already linked' }
  const ref = buildRef(schema, conn)
  const warnings: Diagnostic[] = []
  if (ref) {
    const w = typeMismatchWarning(schema, ref)
    if (w) warnings.push(w)
  }
  return { ok: true, warnings }
}

/** Build the Ref a completed connection represents. FK lives on the drag source (`kind: '>'`). */
export function buildRef(schema: Schema, conn: ConnectionLike, kind: RefKind = '>'): Ref | null {
  const ep = resolveEndpoints(schema, conn)
  if (!ep) return null
  return {
    id: newId(),
    kind,
    from: { tableId: ep.from.tableId, columnIds: [ep.from.columnId] },
    to: { tableId: ep.to.tableId, columnIds: [ep.to.columnId] },
  }
}

export const REF_KINDS: readonly RefKind[] = ['>', '<', '-', '<>']

/** Cardinality label shown on the edge, read from `from` to `to`. */
export function refKindLabel(kind: RefKind): string {
  switch (kind) {
    case '>':
      return '*..1'
    case '<':
      return '1..*'
    case '-':
      return '1..1'
    case '<>':
      return '*..*'
  }
}

export function refKindName(kind: RefKind): string {
  switch (kind) {
    case '>':
      return 'many-to-one'
    case '<':
      return 'one-to-many'
    case '-':
      return 'one-to-one'
    case '<>':
      return 'many-to-many'
  }
}

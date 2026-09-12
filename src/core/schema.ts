/**
 * Canonical schema IR. Every view (canvas, DBML editor, Django editor, demo) is a
 * projection of this. Identity is the `id` (nanoid) — never the name.
 * See .omc/plans/erd-maker-plan.md §2 for the design.
 */
import { nanoid } from 'nanoid'

export type RefKind = '>' | '<' | '-' | '<>'
export type RefAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action'

export interface Project {
  /** Django app label used for generated models (default "app"). */
  appLabel: string
  name?: string
  note?: string
  /** DBML-only blocks (Project/TableGroup/Note) preserved verbatim, re-emitted by the DBML generator. */
  passthrough?: string[]
}

export interface Column {
  id: string
  name: string
  /** DBML type as written, e.g. "int", "varchar(255)", "decimal(10,2)", or an enum name. */
  type: string
  pk: boolean
  unique: boolean
  notNull: boolean
  increment: boolean
  /** Raw DBML default expression, e.g. "'x'", "1", "`now()`", "true". */
  default?: string
  note?: string
  /** Django-only metadata that has no DBML home; survives DBML/canvas edits. */
  django?: {
    relatedName?: string
    verboseName?: string
    blank?: boolean
    /** Unrecognised field kwargs, re-emitted verbatim (name -> python literal source). */
    extraKwargs?: Record<string, string>
    /** Explicit Django field type override (e.g. "EmailField"). */
    fieldType?: string
    /**
     * Django attribute name when it differs from the one the generator derives from `name`
     * (e.g. `editor = ForeignKey(db_column='editor_ref')`). Keeps passthrough code that references
     * `self.editor` valid across a round trip.
     */
    fieldName?: string
  }
}

export interface Index {
  id: string
  columnIds: string[]
  unique: boolean
  pk: boolean
  name?: string
  type?: string
  note?: string
}

export interface Table {
  id: string
  name: string
  /** Optional DBML schema qualifier, e.g. "public". */
  schema?: string
  alias?: string
  note?: string
  headerColor?: string
  columns: Column[]
  indexes: Index[]
  django?: {
    /** Django class name; generator derives PascalCase singular of `name` when absent. */
    className?: string
    /** Unrecognised class-body statements (methods, managers) re-emitted verbatim at the end of the class. */
    passthrough?: string[]
    verboseName?: string
    ordering?: string[]
  }
}

export interface RefEndpoint {
  tableId: string
  columnIds: string[]
}

export interface Ref {
  id: string
  name?: string
  /** For kind ">" the FK lives on `from`; for "<" the FK lives on `to`; "-" one-to-one (FK on from); "<>" many-to-many. */
  from: RefEndpoint
  to: RefEndpoint
  kind: RefKind
  onDelete?: RefAction
  onUpdate?: RefAction
  /** Django-only. */
  django?: { relatedName?: string; through?: string }
}

export interface EnumValue {
  id: string
  name: string
  note?: string
}

export interface Enum {
  id: string
  name: string
  schema?: string
  values: EnumValue[]
  note?: string
}

export interface Schema {
  project: Project
  tables: Table[]
  refs: Ref[]
  enums: Enum[]
}

/** Node positions — sidecar, never serialised into DBML. Keyed by table id. */
export type Layout = Record<string, { x: number; y: number }>

export type DiagnosticSeverity = 'error' | 'warning' | 'info'
export type DiagnosticSource = 'dbml' | 'django' | 'sql' | 'canvas' | 'demo' | 'typemap'

export interface Diagnostic {
  id: string
  severity: DiagnosticSeverity
  source: DiagnosticSource
  /** Plain-language message, e.g. "`timestamptz` loses its timezone flavour: Django DateTimeField has no equivalent". */
  message: string
  /** 1-based position in the source text when applicable. */
  line?: number
  col?: number
  endLine?: number
  endCol?: number
  tableId?: string
  columnId?: string
  refId?: string
  /** True when this describes an inherently lossy mapping rather than a user error. */
  lossy?: boolean
  /** Short name of the check that produced this, used to group rows in the Problems panel. */
  rule?: string
}

// ---------- constructors ----------

export const newId = (): string => nanoid(10)

export function emptySchema(appLabel = 'app'): Schema {
  return { project: { appLabel }, tables: [], refs: [], enums: [] }
}

export function newColumn(partial: Partial<Column> & { name: string }): Column {
  return {
    id: newId(),
    type: 'varchar(255)',
    pk: false,
    unique: false,
    notNull: false,
    increment: false,
    ...partial,
  }
}

export function newTable(partial: Partial<Table> & { name: string }): Table {
  return { id: newId(), columns: [], indexes: [], ...partial }
}

export function newIdColumn(): Column {
  return newColumn({ name: 'id', type: 'int', pk: true, increment: true, notNull: true })
}

export function diag(partial: Omit<Diagnostic, 'id'>): Diagnostic {
  return { id: newId(), ...partial }
}

// ---------- lookups ----------

export const findTable = (s: Schema, tableId: string): Table | undefined =>
  s.tables.find((t) => t.id === tableId)

export const findTableByName = (s: Schema, name: string, schema?: string): Table | undefined =>
  s.tables.find((t) => t.name === name && (schema === undefined || t.schema === schema))

export function findColumn(s: Schema, tableId: string, columnId: string): Column | undefined {
  return findTable(s, tableId)?.columns.find((c) => c.id === columnId)
}

export const findColumnByName = (t: Table, name: string): Column | undefined =>
  t.columns.find((c) => c.name === name)

export const findEnumByName = (s: Schema, name: string): Enum | undefined =>
  s.enums.find((e) => e.name === name)

/** Refs where the given table is either endpoint. */
export const refsForTable = (s: Schema, tableId: string): Ref[] =>
  s.refs.filter((r) => r.from.tableId === tableId || r.to.tableId === tableId)

/** Returns the endpoint that carries the FK column(s) and the endpoint it points to. */
export function fkSide(ref: Ref): { fk: RefEndpoint; target: RefEndpoint } {
  return ref.kind === '<' ? { fk: ref.to, target: ref.from } : { fk: ref.from, target: ref.to }
}

/** Primary-key column ids of a table (single pk flag or composite pk index). */
export function primaryKeyColumnIds(t: Table): string[] {
  const composite = t.indexes.find((i) => i.pk)
  if (composite) return composite.columnIds
  return t.columns.filter((c) => c.pk).map((c) => c.id)
}

/**
 * Tables sorted so that referenced (parent) tables come before tables holding FKs to them.
 * Cycles are broken arbitrarily (remaining tables appended in original order).
 */
export function topologicalTables(s: Schema): Table[] {
  const deps = new Map<string, Set<string>>()
  for (const t of s.tables) deps.set(t.id, new Set())
  for (const r of s.refs) {
    if (r.kind === '<>') continue
    const { fk, target } = fkSide(r)
    if (fk.tableId !== target.tableId) deps.get(fk.tableId)?.add(target.tableId)
  }
  const out: Table[] = []
  const done = new Set<string>()
  let progress = true
  while (progress) {
    progress = false
    for (const t of s.tables) {
      if (done.has(t.id)) continue
      const d = deps.get(t.id)!
      if ([...d].every((x) => done.has(x))) {
        out.push(t)
        done.add(t.id)
        progress = true
      }
    }
  }
  for (const t of s.tables) if (!done.has(t.id)) out.push(t)
  return out
}

export function cloneSchema(s: Schema): Schema {
  return structuredClone(s)
}

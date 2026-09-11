/**
 * Schema -> Django 5.2+ models.py. Deterministic; emits lossy-mapping diagnostics.
 * OWNER: worker-4 (core-django). Plan §2 mapping table, §3 Phase 4a, D12–D16.
 */
import {
  diag,
  findTable,
  fkSide,
  primaryKeyColumnIds,
  topologicalTables,
  type Column,
  type Diagnostic,
  type Enum,
  type Ref,
  type RefAction,
  type Schema,
  type Table,
} from '../schema'
import { tableNameToClassName } from '../naming'
import { autoFieldFor, mapDbmlType, PARSE_ONLY_FIELDS } from './typemap'
import {
  dbmlDefaultToPython,
  enumClassName,
  enumLabel,
  enumMemberName,
  indent,
  dedent,
  pyDocstring,
  pyStr,
} from './python'

export interface GenerateResult {
  text: string
  diagnostics: Diagnostic[]
}

export const ON_DELETE: Record<RefAction, string> = {
  cascade: 'CASCADE',
  restrict: 'PROTECT',
  'set null': 'SET_NULL',
  'set default': 'SET_DEFAULT',
  'no action': 'DO_NOTHING',
}

const IND = '    '

type Kwargs = Array<[string, string]>

interface Ctx {
  schema: Schema
  diagnostics: Diagnostic[]
  classNames: Map<string, string>
  enumClasses: Map<string, string>
}

interface TableCtx {
  table: Table
  /** columnId -> single-column FK ref carried by that column. */
  fkByColumn: Map<string, Ref>
  /** columnId -> Django field name. */
  fieldNames: Map<string, string>
  compositePk?: string[]
}

export function generateDjango(schema: Schema): GenerateResult {
  const ctx: Ctx = { schema, diagnostics: [], classNames: new Map(), enumClasses: new Map() }
  assignClassNames(ctx)

  const blocks: string[] = ['from django.db import models']
  for (const e of schema.enums) blocks.push(emitEnum(e, ctx))
  for (const t of topologicalTables(schema)) blocks.push(emitTable(t, ctx))

  return { text: blocks.join('\n\n\n') + '\n', diagnostics: ctx.diagnostics }
}

// ---------- naming ----------

function assignClassNames(ctx: Ctx): void {
  const used = new Set<string>()
  const unique = (base: string): string => {
    let name = base
    let n = 2
    while (used.has(name)) name = `${base}${n++}`
    used.add(name)
    return name
  }
  for (const e of ctx.schema.enums) ctx.enumClasses.set(e.name, unique(enumClassName(e.name)))
  for (const t of ctx.schema.tables)
    ctx.classNames.set(t.id, unique(t.django?.className ?? tableNameToClassName(t.name)))
}

// ---------- enums ----------

function emitEnum(e: Enum, ctx: Ctx): string {
  const lines = [`class ${ctx.enumClasses.get(e.name)}(models.TextChoices):`]
  if (e.note) lines.push(IND + pyDocstring(e.note))
  if (e.values.length === 0) lines.push(IND + 'pass')
  for (const v of e.values) {
    lines.push(`${IND}${enumMemberName(v.name)} = ${pyStr(v.name)}, ${pyStr(enumLabel(v.name))}`)
    if (v.note)
      ctx.diagnostics.push(
        diag({
          severity: 'info',
          source: 'typemap',
          lossy: true,
          message: `Enum value note on \`${e.name}.${v.name}\` has no Django equivalent`,
        }),
      )
  }
  return lines.join('\n')
}

// ---------- tables ----------

function emitTable(t: Table, ctx: Ctx): string {
  const tc = prepareTable(t, ctx)
  const body: string[][] = []

  if (t.note) body.push([IND + docstring(t.note)])

  const fields: string[] = []
  if (tc.compositePk) fields.push(`${IND}pk = models.CompositePrimaryKey(${tc.compositePk.map(pyStr).join(', ')})`)
  for (const col of t.columns) fields.push(...emitColumn(col, tc, ctx))
  for (const ref of ctx.schema.refs) {
    if (ref.kind === '<>' && ref.from.tableId === t.id) {
      const line = emitManyToMany(ref, tc, ctx)
      if (line) fields.push(line)
    }
  }
  if (fields.length) body.push(fields)

  body.push(emitMeta(tc, ctx))

  for (const p of t.django?.passthrough ?? []) body.push([indent(dedent(p.replace(/\s+$/, '')))])

  if (t.schema)
    ctx.diagnostics.push(
      diag({
        severity: 'info',
        source: 'typemap',
        lossy: true,
        tableId: t.id,
        message: `Schema qualifier \`${t.schema}.\` on table \`${t.name}\` is dropped: the Django model uses db_table='${t.name}'`,
      }),
    )

  return [`class ${ctx.classNames.get(t.id)}(models.Model):`, ...body.map((b) => b.join('\n'))].join('\n\n')
}

function docstring(note: string): string {
  if (!note.includes('\n')) return pyDocstring(note)
  const inner = note.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')
  return `"""\n${indent(inner)}\n${IND}"""`
}

function prepareTable(t: Table, ctx: Ctx): TableCtx {
  const tc: TableCtx = { table: t, fkByColumn: new Map(), fieldNames: new Map() }
  const pkIndex = t.indexes.find((i) => i.pk)
  if (pkIndex) tc.compositePk = []

  for (const ref of ctx.schema.refs) {
    if (ref.kind === '<>') continue
    const { fk, target } = fkSide(ref)
    if (fk.tableId !== t.id) continue
    const targetTable = findTable(ctx.schema, target.tableId)
    if (fk.columnIds.length !== 1 || target.columnIds.length !== 1) {
      ctx.diagnostics.push(
        diag({
          severity: 'error',
          source: 'django',
          tableId: t.id,
          refId: ref.id,
          message: `Multi-column foreign key on \`${t.name}\` (${columnNames(t, fk.columnIds).join(', ')}) cannot be expressed as a Django ForeignKey; plain columns are emitted`,
        }),
      )
      continue
    }
    if (!targetTable || !targetTable.columns.some((c) => c.id === target.columnIds[0])) {
      ctx.diagnostics.push(
        diag({
          severity: 'error',
          source: 'django',
          tableId: t.id,
          columnId: fk.columnIds[0],
          refId: ref.id,
          message: `Foreign key on \`${t.name}.${columnNames(t, fk.columnIds)[0]}\` points at a missing table or column`,
        }),
      )
      continue
    }
    if (targetTable.indexes.some((i) => i.pk)) {
      ctx.diagnostics.push(
        diag({
          severity: 'error',
          source: 'django',
          tableId: t.id,
          columnId: fk.columnIds[0],
          refId: ref.id,
          message: `Foreign key on \`${t.name}.${columnNames(t, fk.columnIds)[0]}\` targets \`${targetTable.name}\`, which has a composite primary key; Django cannot reference it`,
        }),
      )
      continue
    }
    tc.fkByColumn.set(fk.columnIds[0], ref)
    if (ref.onUpdate)
      ctx.diagnostics.push(
        diag({
          severity: 'info',
          source: 'typemap',
          lossy: true,
          tableId: t.id,
          refId: ref.id,
          message: `\`update: ${ref.onUpdate}\` on the ref from \`${t.name}\` is dropped: Django has no on_update`,
        }),
      )
  }

  tc.fieldNames = deriveFieldNames(t, (col) => tc.fkByColumn.has(col.id))
  if (pkIndex) tc.compositePk = pkIndex.columnIds.map((id) => tc.fieldNames.get(id)).filter((n): n is string => !!n)
  return tc
}

/**
 * Django attribute name for every column (columnId -> name). Explicit `django.fieldName` wins;
 * otherwise the column name is made a valid identifier and FK columns lose a trailing `_id`
 * (unless a plain column already owns that name). Names are de-duplicated and never `pk` when
 * the table has a composite primary key. Shared with the parser so both sides agree.
 */
export function deriveFieldNames(t: Table, isFk: (col: Column) => boolean): Map<string, string> {
  const out = new Map<string, string>()
  const compositePk = t.indexes.some((i) => i.pk)
  const plain = new Set(t.columns.map((c) => fieldIdentifier(c.name)))
  const used = new Set<string>()
  for (const col of t.columns) {
    let name = col.django?.fieldName ? fieldIdentifier(col.django.fieldName) : fieldIdentifier(col.name)
    if (!col.django?.fieldName && isFk(col) && /_id$/.test(name) && name.length > 3) {
      const stripped = name.slice(0, -3)
      if (!plain.has(stripped)) name = stripped
    }
    while (used.has(name) || (compositePk && name === 'pk')) name = `${name}_`
    used.add(name)
    out.set(col.id, name)
  }
  return out
}

/** Enum whose `name` or `schema.name` equals the column type. */
export function findEnumForType(schema: Schema, type: string): Enum | undefined {
  const t = type.trim()
  return schema.enums.find((e) => e.name === t || (e.schema && `${e.schema}.${e.name}` === t) || t.split('.').pop() === e.name)
}

const PY_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'.split(' '),
)

/** Django field name for a column: a valid, non-keyword identifier (`note text` -> `note_text`, `from` -> `from_`). */
export function fieldIdentifier(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
  if (/^[0-9]/.test(id)) id = `_${id}`
  if (PY_KEYWORDS.has(id)) id = `${id}_`
  return id
}

const columnNames = (t: Table, ids: string[]): string[] =>
  ids.map((id) => t.columns.find((c) => c.id === id)?.name ?? '?')

const isIntType = (type: string): boolean => /^(int|integer|int4)$/i.test(type.trim())

// ---------- columns ----------

function emitColumn(col: Column, tc: TableCtx, ctx: Ctx): string[] {
  const t = tc.table
  const inCompositePk = !!tc.compositePk && t.indexes.find((i) => i.pk)!.columnIds.includes(col.id)
  const isPk = col.pk && !tc.compositePk

  // D14: `id int [pk, increment]` is Django's implicit primary key.
  if (isPk && col.increment && col.name === 'id' && isIntType(col.type) && !col.django?.fieldType) return []

  const lines: string[] = []
  let field: string
  let kwargs: Kwargs = []
  const ref = tc.fkByColumn.get(col.id)
  const enumDef = findEnumForType(ctx.schema, col.type)

  if (ref) {
    const { target } = fkSide(ref)
    const targetTable = findTable(ctx.schema, target.tableId)!
    const targetCol = targetTable.columns.find((c) => c.id === target.columnIds[0])!
    field = ref.kind === '-' ? 'OneToOneField' : 'ForeignKey'
    const targetName = targetTable.id === t.id ? 'self' : ctx.classNames.get(targetTable.id)!
    kwargs.push(['', pyStr(targetName)])
    kwargs.push(['on_delete', `models.${ON_DELETE[ref.onDelete ?? 'cascade']}`])
    kwargs.push(['db_column', pyStr(col.name)])
    const targetPk = primaryKeyColumnIds(targetTable)
    if (!(targetPk.length === 1 && targetPk[0] === targetCol.id)) kwargs.push(['to_field', pyStr(targetCol.name)])
    const related = col.django?.relatedName ?? ref.django?.relatedName
    if (related) kwargs.push(['related_name', pyStr(related)])
  } else if (isPk && col.increment) {
    field = autoFieldFor(col.type)
  } else if (enumDef) {
    field = 'CharField'
    const maxLen = Math.max(1, ...enumDef.values.map((v) => v.name.length))
    kwargs.push(['max_length', String(maxLen)], ['choices', `${ctx.enumClasses.get(enumDef.name)}.choices`])
  } else {
    const mapped = mapDbmlType(col.type, col)
    field = mapped.field
    kwargs.push(...Object.entries(mapped.kwargs))
    if (mapped.unknown && !col.django?.fieldType)
      ctx.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'typemap',
          tableId: t.id,
          columnId: col.id,
          message: `Unknown type \`${col.type}\` on \`${t.name}.${col.name}\`: emitted as TextField`,
        }),
      )
    if (mapped.lossy)
      ctx.diagnostics.push(
        diag({
          severity: 'info',
          source: 'typemap',
          lossy: true,
          tableId: t.id,
          columnId: col.id,
          message: `\`${t.name}.${col.name}\`: ${mapped.lossy}`,
        }),
      )
  }

  if (col.django?.fieldType && !ref) {
    field = col.django.fieldType
    const defaults = PARSE_ONLY_FIELDS[field]?.defaults ?? {}
    kwargs = kwargs.filter(([k, v]) => defaults[k] !== v)
  }
  if (!ref && tc.fieldNames.get(col.id) !== col.name) kwargs.push(['db_column', pyStr(col.name)])

  if (isPk) kwargs.push(['primary_key', 'True'])
  if (col.unique && !isPk) kwargs.push(['unique', 'True'])
  const nullable = !col.notNull && !isPk && !inCompositePk
  if (nullable) {
    kwargs.push(['null', 'True'])
    if (col.django?.blank !== false) kwargs.push(['blank', 'True'])
  } else if (col.django?.blank) kwargs.push(['blank', 'True'])

  if (col.default !== undefined && !(isPk && col.increment)) {
    const d = col.default.trim()
    const py = dbmlDefaultToPython(d)
    if (py === undefined) {
      if (/^`\s*(now\(\)|current_timestamp)\s*`$/i.test(d) && /^(DateTimeField|DateField|TimeField)$/.test(field))
        kwargs.push(['auto_now_add', 'True'])
      else {
        lines.push(`${IND}# default: ${d}`)
        ctx.diagnostics.push(
          diag({
            severity: 'warning',
            source: 'django',
            tableId: t.id,
            columnId: col.id,
            message: `SQL default ${d} on \`${t.name}.${col.name}\` has no Django equivalent; emitted as a comment`,
          }),
        )
      }
    } else if (enumDef) {
      const raw = py.slice(1, -1)
      const member = enumDef.values.find((v) => v.name === raw)
      kwargs.push(['default', member ? `${ctx.enumClasses.get(enumDef.name)}.${enumMemberName(member.name)}` : py])
    } else if (py !== 'None') kwargs.push(['default', py])
  }

  if (col.note) kwargs.push(['help_text', pyStr(col.note)])
  if (col.django?.verboseName) kwargs.push(['verbose_name', pyStr(col.django.verboseName)])
  for (const [k, v] of Object.entries(col.django?.extraKwargs ?? {})) {
    const i = kwargs.findIndex(([kk]) => kk === k)
    if (i >= 0) kwargs[i] = [k, v]
    else kwargs.push([k, v])
  }

  lines.push(`${IND}${tc.fieldNames.get(col.id)} = models.${field}(${renderKwargs(kwargs)})`)
  return lines
}

function renderKwargs(kwargs: Kwargs): string {
  return kwargs.map(([k, v]) => (k ? `${k}=${v}` : v)).join(', ')
}

function emitManyToMany(ref: Ref, tc: TableCtx, ctx: Ctx): string | undefined {
  const target = findTable(ctx.schema, ref.to.tableId)
  if (!target) {
    ctx.diagnostics.push(
      diag({
        severity: 'error',
        source: 'django',
        tableId: tc.table.id,
        refId: ref.id,
        message: `Many-to-many ref from \`${tc.table.name}\` points at a missing table`,
      }),
    )
    return undefined
  }
  const kwargs: Kwargs = [['', pyStr(target.id === tc.table.id ? 'self' : ctx.classNames.get(target.id)!)]]
  if (ref.django?.relatedName) kwargs.push(['related_name', pyStr(ref.django.relatedName)])
  if (ref.django?.through) kwargs.push(['through', pyStr(ref.django.through)])
  const name = ref.name ?? (target.name.split('.').pop() ?? target.name)
  return `${IND}${name} = models.ManyToManyField(${renderKwargs(kwargs)})`
}

// ---------- Meta ----------

function emitMeta(tc: TableCtx, ctx: Ctx): string[] {
  const t = tc.table
  const I2 = IND + IND
  const I3 = I2 + IND
  const lines = [`${IND}class Meta:`, `${I2}db_table = ${pyStr(t.name)}`]
  const indexes: string[] = []
  const constraints: string[] = []

  for (const idx of t.indexes) {
    if (idx.pk) continue
    const fields = idx.columnIds.map((id) => tc.fieldNames.get(id)).filter((n): n is string => !!n)
    if (fields.length === 0) {
      ctx.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          tableId: t.id,
          message: `Index on \`${t.name}\` references no existing columns and was skipped`,
        }),
      )
      continue
    }
    const fieldList = `fields=[${fields.map(pyStr).join(', ')}]`
    if (idx.unique) {
      const name = idx.name ?? uniqueConstraintName(t.name, columnNames(t, idx.columnIds))
      constraints.push(`${I3}models.UniqueConstraint(${fieldList}, name=${pyStr(name)}),`)
    } else {
      indexes.push(`${I3}models.Index(${fieldList}${idx.name ? `, name=${pyStr(idx.name)}` : ''}),`)
    }
    if (idx.type || idx.note)
      ctx.diagnostics.push(
        diag({
          severity: 'info',
          source: 'typemap',
          lossy: true,
          tableId: t.id,
          message: `Index ${idx.type ? `type \`${idx.type}\`` : 'note'} on \`${t.name}\` (${columnNames(t, idx.columnIds).join(', ')}) has no Django equivalent`,
        }),
      )
  }

  if (indexes.length) lines.push(`${I2}indexes = [`, ...indexes, `${I2}]`)
  if (constraints.length) lines.push(`${I2}constraints = [`, ...constraints, `${I2}]`)
  if (t.django?.ordering?.length) lines.push(`${I2}ordering = [${t.django.ordering.map(pyStr).join(', ')}]`)
  if (t.django?.verboseName) lines.push(`${I2}verbose_name = ${pyStr(t.django.verboseName)}`)
  return lines
}

/** Deterministic name for unnamed unique indexes; the parser recognises and drops it. */
export function uniqueConstraintName(tableName: string, columns: string[]): string {
  return `${tableName.split('.').pop()}_${columns.join('_')}_uniq`
}

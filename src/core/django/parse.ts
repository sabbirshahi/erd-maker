/**
 * models.py -> Schema via the tree-sitter Python CST (D7: real grammar, not regex).
 * Unrecognised class-body statements become `table.django.passthrough`; unknown field kwargs
 * become `column.django.extraKwargs`. Syntax errors yield diagnostics and no schema.
 * OWNER: worker-4 (core-django). Plan §3 Phase 4b, D13–D16.
 */
import { Language, Parser, type Node } from 'web-tree-sitter'
import {
  diag,
  fkSide,
  newColumn,
  newId,
  newIdColumn,
  newTable,
  primaryKeyColumnIds,
  type Column,
  type Diagnostic,
  type Enum,
  type Index,
  type Ref,
  type RefAction,
  type Schema,
  type Table,
} from '../schema'
import { classNameToTableName, tableNameToClassName, toSnakeCase } from '../naming'
import { AUTO_FIELDS, mapDjangoField, PARSE_ONLY_FIELDS, RELATION_FIELDS, TYPE_MAP } from './typemap'
import { deriveFieldNames, uniqueConstraintName } from './generate'
import { dedent, pythonLiteralToDbmlDefault, unquotePyStr } from './python'

export interface DjangoParseResult {
  /** Present only when there are zero error-severity diagnostics. */
  schema?: Schema
  diagnostics: Diagnostic[]
}

export interface DjangoParserOptions {
  /** URL (browser) or wasm bytes (tests) for the tree-sitter runtime. Default `/tree-sitter/tree-sitter.wasm`. */
  runtimeWasm?: string | Uint8Array
  /** URL or wasm bytes for the Python grammar. Default `/tree-sitter/tree-sitter-python.wasm`. */
  languageWasm?: string | Uint8Array
}

let initPromise: Promise<void> | null = null
let parser: Parser | null = null

/** Loads tree-sitter + the Python grammar once (idempotent; a failed load can be retried). */
export function initDjangoParser(opts?: DjangoParserOptions): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const runtime = opts?.runtimeWasm ?? '/tree-sitter/tree-sitter.wasm'
    await Parser.init(
      typeof runtime === 'string' ? { locateFile: () => runtime } : { wasmBinary: runtime },
    )
    const language = await Language.load(opts?.languageWasm ?? '/tree-sitter/tree-sitter-python.wasm')
    parser = new Parser().setLanguage(language)
  })()
  initPromise.catch(() => {
    initPromise = null
  })
  return initPromise
}

/** models.py -> Schema. Never throws. */
export async function parseDjango(text: string): Promise<DjangoParseResult> {
  const diagnostics: Diagnostic[] = []
  try {
    await initDjangoParser()
    const tree = parser!.parse(text)
    if (!tree) {
      diagnostics.push(diag({ severity: 'error', source: 'django', message: 'Python parser returned no tree' }))
      return { diagnostics }
    }
    try {
      collectSyntaxErrors(tree.rootNode, diagnostics)
      if (diagnostics.length) return { diagnostics }
      const schema = buildSchema(tree.rootNode, diagnostics)
      return diagnostics.some((d) => d.severity === 'error') ? { diagnostics } : { schema, diagnostics }
    } finally {
      tree.delete()
    }
  } catch (e) {
    diagnostics.push(
      diag({ severity: 'error', source: 'django', message: `Django parser failed: ${(e as Error).message ?? e}` }),
    )
    return { diagnostics }
  }
}

// ---------- syntax errors ----------

function collectSyntaxErrors(root: Node, out: Diagnostic[]): void {
  if (!root.hasError) return
  const visit = (n: Node): void => {
    if (out.length >= 20) return
    if (n.isError || n.isMissing) {
      const snippet = n.text.trim().split('\n')[0].slice(0, 40)
      out.push(
        diag({
          severity: 'error',
          source: 'django',
          message: n.isMissing
            ? `Python syntax error: missing ${JSON.stringify(n.type)}`
            : `Python syntax error near ${JSON.stringify(snippet || n.type)}`,
          ...pos(n),
        }),
      )
      return
    }
    if (!n.hasError) return
    for (const c of n.children) if (c) visit(c)
  }
  visit(root)
  if (out.length === 0)
    out.push(diag({ severity: 'error', source: 'django', message: 'Python syntax error', line: 1, col: 1 }))
}

function pos(n: Node): Pick<Diagnostic, 'line' | 'col' | 'endLine' | 'endCol'> {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column + 1,
    endLine: n.endPosition.row + 1,
    endCol: n.endPosition.column + 1,
  }
}

// ---------- CST helpers ----------

const named = (n: Node | null | undefined): Node[] => (n ? n.namedChildren.filter((c): c is Node => !!c) : [])

/** `models.CharField` -> `CharField`; `CharField` -> `CharField`; anything else -> undefined. */
function calleeName(callee: Node): string | undefined {
  if (callee.type === 'identifier') return callee.text
  if (callee.type === 'attribute') return callee.childForFieldName('attribute')?.text
  return undefined
}

interface CallArgs {
  positional: Node[]
  kwargs: Map<string, Node>
}

function callArgs(call: Node): CallArgs {
  const out: CallArgs = { positional: [], kwargs: new Map() }
  for (const a of named(call.childForFieldName('arguments'))) {
    if (a.type === 'comment') continue
    if (a.type === 'keyword_argument') {
      const k = a.childForFieldName('name')?.text
      const v = a.childForFieldName('value')
      if (k && v) out.kwargs.set(k, v)
    } else out.positional.push(a)
  }
  return out
}

const isTrue = (n: Node | undefined): boolean => n?.type === 'true'

function pyString(n: Node | undefined): string | undefined {
  if (!n || (n.type !== 'string' && n.type !== 'concatenated_string')) return undefined
  return unquotePyStr(n.text)
}

/** `['a', 'b']` / `('a', 'b')` / `'a'` -> ['a', 'b'] (only string items). */
function pyStringList(n: Node | undefined): string[] | undefined {
  if (!n) return undefined
  if (n.type === 'string') return [unquotePyStr(n.text) ?? n.text]
  if (n.type === 'list' || n.type === 'tuple' || n.type === 'set' || n.type === 'expression_list')
    return named(n)
      .map((c) => pyString(c))
      .filter((s): s is string => s !== undefined)
  if (n.type === 'parenthesized_expression') return pyStringList(named(n)[0])
  return undefined
}

const FIELD_NAMES = new Set<string>([
  ...TYPE_MAP.flatMap((r) => r.djangoFields),
  ...Object.keys(PARSE_ONLY_FIELDS),
  ...Object.keys(AUTO_FIELDS),
  ...RELATION_FIELDS,
  'CompositePrimaryKey',
])

const ON_DELETE_REVERSE: Record<string, RefAction | undefined> = {
  CASCADE: undefined, // D15: the DBML default
  PROTECT: 'restrict',
  RESTRICT: 'restrict',
  SET_NULL: 'set null',
  SET_DEFAULT: 'set default',
  DO_NOTHING: 'no action',
}

// ---------- schema building ----------

interface ClassInfo {
  node: Node
  name: string
  bases: string[]
  body: Node | null
}

interface PendingRef {
  table: Table
  column: Column
  fieldName: string
  targetClass: string
  toField?: string
  kind: '>' | '-'
  onDelete?: RefAction
  node: Node
}

interface PendingM2M {
  table: Table
  fieldName: string
  targetClass: string
  relatedName?: string
  through?: string
  node: Node
}

interface PendingIndex {
  table: Table
  fieldNames: string[]
  unique: boolean
  pk: boolean
  name?: string
  node: Node
}

interface Builder {
  schema: Schema
  diagnostics: Diagnostic[]
  classes: ClassInfo[]
  enumsByClass: Map<string, Enum>
  /** Choices class name -> member name -> value (`Status.DRAFT` -> `'draft'`). */
  enumMembers: Map<string, Map<string, string>>
  tablesByClass: Map<string, Table>
  /** tableId -> Django field name -> column */
  fieldColumns: Map<string, Map<string, Column>>
  refs: PendingRef[]
  m2m: PendingM2M[]
  indexes: PendingIndex[]
}

function buildSchema(root: Node, diagnostics: Diagnostic[]): Schema {
  const b: Builder = {
    schema: { project: { appLabel: 'app' }, tables: [], refs: [], enums: [] },
    diagnostics,
    classes: [],
    enumsByClass: new Map(),
    enumMembers: new Map(),
    tablesByClass: new Map(),
    fieldColumns: new Map(),
    refs: [],
    m2m: [],
    indexes: [],
  }

  for (const stmt of named(root)) collectTopLevel(stmt, b)

  const modelClasses = classifyModels(b)
  for (const c of b.classes) if (isChoicesClass(c)) parseEnum(c, b)
  for (const c of modelClasses) parseModel(c, b)
  resolveIndexes(b)
  for (const t of b.schema.tables) ensurePrimaryKey(t)
  resolveRefs(b)
  resolveManyToMany(b)
  recordFieldNames(b)
  return b.schema
}

/**
 * Verbatim source of a class-body statement, re-based to column 0. `node.text` starts at the
 * statement's first token, so its first line lacks the indentation the following lines carry.
 */
const statementSource = (stmt: Node): string => dedent(' '.repeat(stmt.startPosition.column) + stmt.text)

function collectTopLevel(stmt: Node, b: Builder): void {
  switch (stmt.type) {
    case 'class_definition': {
      const name = stmt.childForFieldName('name')?.text ?? ''
      const bases = named(stmt.childForFieldName('superclasses'))
        .filter((n) => n.type !== 'keyword_argument')
        .map((n) => n.text)
      b.classes.push({ node: stmt, name, bases, body: stmt.childForFieldName('body') })
      return
    }
    case 'import_statement':
    case 'import_from_statement':
    case 'future_import_statement': {
      if (/^from\s+django\.db\s+import\s+models\b/.test(stmt.text) || stmt.type === 'future_import_statement') return
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          message: `\`${stmt.text.trim()}\` is not preserved: the regenerated models.py only imports django.db.models`,
          ...pos(stmt),
        }),
      )
      return
    }
    case 'comment':
    case 'pass_statement':
      return
    default:
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          message: `Top-level ${stmt.type.replace(/_/g, ' ')} at line ${stmt.startPosition.row + 1} is not part of the schema and will be lost on regeneration`,
          ...pos(stmt),
        }),
      )
  }
}

const lastSegment = (s: string): string => s.split('.').pop() ?? s

const isChoicesClass = (c: ClassInfo): boolean =>
  c.bases.some((base) => /^(TextChoices|IntegerChoices|Choices)$/.test(lastSegment(base)))

/** Classes deriving (transitively) from models.Model, in file order. */
function classifyModels(b: Builder): ClassInfo[] {
  const modelNames = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const c of b.classes) {
      if (modelNames.has(c.name) || isChoicesClass(c)) continue
      if (c.bases.some((base) => lastSegment(base) === 'Model' || modelNames.has(base))) {
        modelNames.add(c.name)
        changed = true
      }
    }
  }
  const out: ClassInfo[] = []
  for (const c of b.classes) {
    if (modelNames.has(c.name)) out.push(c)
    else if (!isChoicesClass(c))
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          message: `class ${c.name} is not a Django model and will be lost on regeneration`,
          ...pos(c.node),
        }),
      )
  }
  return out
}

// ---------- enums ----------

function parseEnum(c: ClassInfo, b: Builder): void {
  const e: Enum = { id: newId(), name: toSnakeCase(c.name), values: [] }
  const members = new Map<string, string>()
  const stmts = named(c.body)
  stmts.forEach((stmt, i) => {
    if (stmt.type !== 'expression_statement') return
    const inner = named(stmt)[0]
    if (!inner) return
    if (i === 0 && inner.type === 'string') {
      e.note = dedent(unquotePyStr(inner.text) ?? '').trim()
      return
    }
    if (inner.type !== 'assignment') return
    const left = inner.childForFieldName('left')
    const right = inner.childForFieldName('right')
    if (!left || !right || left.type !== 'identifier') return
    const first = right.type === 'expression_list' || right.type === 'tuple' ? named(right)[0] : right
    if (!first) return
    const value = pyString(first) ?? (/^(integer|float)$/.test(first.type) ? first.text : undefined)
    if (value === undefined) return
    e.values.push({ id: newId(), name: value })
    members.set(left.text, value)
  })
  b.schema.enums.push(e)
  b.enumsByClass.set(c.name, e)
  b.enumMembers.set(c.name, members)
}

// ---------- models ----------

function parseModel(c: ClassInfo, b: Builder): void {
  const table = newTable({ name: classNameToTableName(c.name) })
  const fields = new Map<string, Column>()
  b.fieldColumns.set(table.id, fields)
  const passthrough: string[] = []
  let abstract = false
  let explicitDbTable: string | undefined

  const stmts = named(c.body)
  stmts.forEach((stmt, i) => {
    if (stmt.type === 'comment' || stmt.type === 'pass_statement') return
    if (stmt.type === 'expression_statement') {
      const inner = named(stmt)[0]
      if (inner && i === 0 && inner.type === 'string') {
        table.note = dedent(unquotePyStr(inner.text) ?? '').trim()
        return
      }
      if (inner?.type === 'assignment') {
        const left = inner.childForFieldName('left')
        const right = inner.childForFieldName('right')
        if (left?.type === 'identifier' && right?.type === 'call') {
          const fieldType = calleeName(right.childForFieldName('function')!)
          if (fieldType && (FIELD_NAMES.has(fieldType) || /Field$/.test(fieldType))) {
            parseField(left.text, fieldType, right, table, fields, b)
            return
          }
        }
      }
      passthrough.push(statementSource(stmt))
      return
    }
    if (stmt.type === 'class_definition' && stmt.childForFieldName('name')?.text === 'Meta') {
      const meta = parseMeta(stmt, table, b)
      abstract = meta.abstract
      explicitDbTable = meta.dbTable
      return
    }
    passthrough.push(statementSource(stmt))
  })

  if (abstract) {
    b.diagnostics.push(
      diag({
        severity: 'info',
        source: 'django',
        message: `Abstract model ${c.name} has no table and is not shown`,
        ...pos(c.node),
      }),
    )
    b.fieldColumns.delete(table.id)
    b.refs = b.refs.filter((r) => r.table !== table)
    b.m2m = b.m2m.filter((r) => r.table !== table)
    b.indexes = b.indexes.filter((r) => r.table !== table)
    return
  }

  if (explicitDbTable) table.name = explicitDbTable
  if (tableNameToClassName(table.name) !== c.name) table.django = { ...table.django, className: c.name }
  if (passthrough.length) table.django = { ...table.django, passthrough }
  b.schema.tables.push(table)
  b.tablesByClass.set(c.name, table)
}

function parseField(
  fieldName: string,
  fieldType: string,
  call: Node,
  table: Table,
  fields: Map<string, Column>,
  b: Builder,
): void {
  const { positional, kwargs } = callArgs(call)

  if (fieldType === 'CompositePrimaryKey') {
    const names = positional.map((p) => pyString(p)).filter((s): s is string => s !== undefined)
    b.indexes.push({ table, fieldNames: names, unique: false, pk: true, node: call })
    return
  }

  if (fieldType === 'ManyToManyField') {
    const target = relationTarget(positional[0] ?? kwargs.get('to'), b, call)
    if (!target) return
    b.m2m.push({
      table,
      fieldName,
      targetClass: target,
      relatedName: pyString(kwargs.get('related_name')),
      through: pyString(kwargs.get('through')),
      node: call,
    })
    return
  }

  const consumed = new Set<string>(['primary_key', 'unique', 'null', 'blank', 'help_text', 'verbose_name'])
  const col = newColumn({ name: fieldName, type: 'int', notNull: true })
  const isRelation = fieldType === 'ForeignKey' || fieldType === 'OneToOneField'

  if (isRelation) {
    const target = relationTarget(positional[0] ?? kwargs.get('to'), b, call)
    col.name = pyString(kwargs.get('db_column')) ?? `${fieldName}_id`
    consumed.add('to').add('db_column').add('to_field').add('related_name').add('on_delete')
    const onDeleteNode = kwargs.get('on_delete')
    let onDelete: RefAction | undefined
    if (onDeleteNode) {
      const key = lastSegment(onDeleteNode.text)
      if (key in ON_DELETE_REVERSE) onDelete = ON_DELETE_REVERSE[key]
      else consumed.delete('on_delete')
    }
    const relatedName = pyString(kwargs.get('related_name'))
    if (relatedName) col.django = { ...col.django, relatedName }
    if (target)
      b.refs.push({
        table,
        column: col,
        fieldName,
        targetClass: target,
        toField: pyString(kwargs.get('to_field')),
        kind: fieldType === 'OneToOneField' ? '-' : '>',
        onDelete,
        node: call,
      })
  } else {
    const kwText = Object.fromEntries([...kwargs].map(([k, v]) => [k, v.text]))
    const mapped = mapDjangoField(fieldType, kwText)
    col.type = mapped.type
    for (const k of mapped.consumed) consumed.add(k)
    if (mapped.fieldType) col.django = { ...col.django, fieldType: mapped.fieldType }
    if (mapped.unknown)
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          tableId: table.id,
          columnId: col.id,
          message: `Unknown Django field ${fieldType} on ${fieldName}: treated as text (the field is re-emitted verbatim)`,
          ...pos(call),
        }),
      )
    if (mapped.auto) {
      col.pk = true
      col.increment = true
    }
    const choices = kwargs.get('choices')
    if (choices?.type === 'attribute' && choices.childForFieldName('attribute')?.text === 'choices') {
      const enumCls = choices.childForFieldName('object')?.text ?? ''
      const e = b.enumsByClass.get(lastSegment(enumCls))
      if (e) {
        col.type = e.name
        consumed.add('choices').add('max_length')
      }
    }
    if (positional[0]) {
      const verbose = pyString(positional[0])
      if (verbose !== undefined) col.django = { ...col.django, verboseName: verbose }
    }
    const dbColumn = pyString(kwargs.get('db_column'))
    if (dbColumn !== undefined) {
      col.name = dbColumn
      consumed.add('db_column')
    }
  }

  if (isTrue(kwargs.get('primary_key'))) col.pk = true
  if (isTrue(kwargs.get('unique'))) col.unique = true
  const nullable = isTrue(kwargs.get('null')) && !col.pk
  col.notNull = !nullable
  const blank = isTrue(kwargs.get('blank'))
  if (nullable && !blank) col.django = { ...col.django, blank: false }
  if (!nullable && blank) col.django = { ...col.django, blank: true }

  if (isTrue(kwargs.get('auto_now_add'))) {
    col.default = '`now()`'
    consumed.add('auto_now_add')
  }
  const def = kwargs.get('default')
  if (def) {
    const enumDefault = enumMemberValue(def, b)
    const literal = enumDefault !== undefined ? `'${enumDefault}'` : pythonLiteralToDbmlDefault(def.text)
    if (literal !== undefined) {
      col.default = literal
      consumed.add('default')
    } else if (def.type === 'none') consumed.add('default')
  }

  const help = pyString(kwargs.get('help_text'))
  if (help !== undefined) col.note = help
  const verbose = pyString(kwargs.get('verbose_name'))
  if (verbose !== undefined) col.django = { ...col.django, verboseName: verbose }

  if (isTrue(kwargs.get('db_index'))) {
    b.indexes.push({ table, fieldNames: [fieldName], unique: false, pk: false, node: call })
    consumed.add('db_index')
  }

  const extra: Record<string, string> = {}
  for (const [k, v] of kwargs) if (!consumed.has(k)) extra[k] = v.text
  if (Object.keys(extra).length) col.django = { ...col.django, extraKwargs: extra }

  table.columns.push(col)
  fields.set(fieldName, col)
}

/** `'User'` / `User` / `'app.User'` / `'self'` -> class name; unresolvable expressions -> undefined + warning. */
function relationTarget(n: Node | undefined, b: Builder, call: Node): string | undefined {
  if (!n) {
    b.diagnostics.push(
      diag({ severity: 'warning', source: 'django', message: 'Relation field without a target model', ...pos(call) }),
    )
    return undefined
  }
  const str = pyString(n)
  if (str !== undefined) return str === 'self' ? '__self__' : lastSegment(str)
  if (n.type === 'identifier') return n.text
  b.diagnostics.push(
    diag({
      severity: 'warning',
      source: 'django',
      message: `Relation target \`${n.text}\` cannot be resolved to a model in this file; the field is kept as a plain column`,
      ...pos(call),
    }),
  )
  return undefined
}

function enumMemberValue(n: Node, b: Builder): string | undefined {
  if (n.type !== 'attribute') return undefined
  const cls = n.childForFieldName('object')?.text ?? ''
  const member = n.childForFieldName('attribute')?.text ?? ''
  const e = b.enumsByClass.get(lastSegment(cls))
  if (!e) return undefined
  const direct = b.enumMembers.get(lastSegment(cls))?.get(member)
  if (direct !== undefined) return direct
  const hit = e.values.find(
    (v) => v.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() === member.replace(/^_/, ''),
  )
  return hit?.name
}

// ---------- Meta ----------

function parseMeta(meta: Node, table: Table, b: Builder): { abstract: boolean; dbTable?: string } {
  let abstract = false
  let dbTable: string | undefined
  for (const stmt of named(meta.childForFieldName('body'))) {
    if (stmt.type === 'comment' || stmt.type === 'pass_statement') continue
    const inner = stmt.type === 'expression_statement' ? named(stmt)[0] : undefined
    const left = inner?.type === 'assignment' ? inner.childForFieldName('left') : null
    const right = inner?.type === 'assignment' ? inner.childForFieldName('right') : null
    const key = left?.type === 'identifier' ? left.text : undefined
    if (!key || !right) {
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          tableId: table.id,
          message: `Unsupported statement in class Meta is not preserved`,
          ...pos(stmt),
        }),
      )
      continue
    }
    switch (key) {
      case 'db_table':
        dbTable = pyString(right)
        break
      case 'abstract':
        abstract = isTrue(right)
        break
      case 'ordering':
        table.django = { ...table.django, ordering: pyStringList(right) ?? [] }
        break
      case 'verbose_name':
        table.django = { ...table.django, verboseName: pyString(right) }
        break
      case 'indexes':
      case 'constraints':
        for (const item of named(right)) parseMetaConstraint(item, table, b)
        break
      case 'unique_together':
      case 'index_together': {
        const groups = tupleGroups(right)
        for (const g of groups)
          b.indexes.push({ table, fieldNames: g, unique: key === 'unique_together', pk: false, node: right })
        break
      }
      default:
        b.diagnostics.push(
          diag({
            severity: 'warning',
            source: 'django',
            tableId: table.id,
            message: `Meta.${key} is not preserved`,
            ...pos(stmt),
          }),
        )
    }
  }
  return { abstract, dbTable }
}

/** `(('a','b'), ('c',))` or `('a','b')` or `[['a','b']]` -> [['a','b'], ['c']] */
function tupleGroups(n: Node): string[][] {
  const items = named(n)
  if (items.length && items.every((i) => i.type === 'string')) return [pyStringList(n) ?? []]
  return items.map((i) => pyStringList(i) ?? []).filter((g) => g.length)
}

function parseMetaConstraint(item: Node, table: Table, b: Builder): void {
  if (item.type === 'comment') return
  const callee = item.type === 'call' ? calleeName(item.childForFieldName('function')!) : undefined
  if (callee !== 'Index' && callee !== 'UniqueConstraint') {
    b.diagnostics.push(
      diag({
        severity: 'warning',
        source: 'django',
        tableId: table.id,
        message: `Meta entry \`${item.text.split('\n')[0].slice(0, 60)}\` is not preserved (only Index and UniqueConstraint are)`,
        ...pos(item),
      }),
    )
    return
  }
  const { positional, kwargs } = callArgs(item)
  const fieldNames =
    pyStringList(kwargs.get('fields')) ??
    positional.map((p) => pyString(p)).filter((s): s is string => s !== undefined)
  b.indexes.push({
    table,
    fieldNames,
    unique: callee === 'UniqueConstraint',
    pk: false,
    name: pyString(kwargs.get('name')),
    node: item,
  })
}

// ---------- resolution ----------

function resolveIndexes(b: Builder): void {
  for (const p of b.indexes) {
    const fields = b.fieldColumns.get(p.table.id)
    if (!fields) continue
    const cols: Column[] = []
    for (const f of p.fieldNames) {
      const col = fields.get(f.replace(/^-/, ''))
      if (!col) {
        b.diagnostics.push(
          diag({
            severity: 'warning',
            source: 'django',
            tableId: p.table.id,
            message: `Index on ${p.table.name} references unknown field \`${f}\``,
            ...pos(p.node),
          }),
        )
        continue
      }
      cols.push(col)
    }
    if (!cols.length) continue
    const idx: Index = { id: newId(), columnIds: cols.map((c) => c.id), unique: p.unique, pk: p.pk }
    if (p.name && !(p.unique && p.name === uniqueConstraintName(p.table.name, cols.map((c) => c.name)))) idx.name = p.name
    if (p.pk) {
      for (const c of cols) {
        c.pk = false
        c.notNull = true
      }
    }
    p.table.indexes.push(idx)
  }
}

/** D14: a model without an explicit pk gets Django's implicit `id` back. */
function ensurePrimaryKey(t: Table): void {
  if (t.columns.some((c) => c.pk) || t.indexes.some((i) => i.pk)) return
  t.columns.unshift(newIdColumn())
}

function resolveRefs(b: Builder): void {
  for (const p of b.refs) {
    const target = p.targetClass === '__self__' ? p.table : b.tablesByClass.get(p.targetClass)
    if (!target) {
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          tableId: p.table.id,
          columnId: p.column.id,
          message: `${p.table.name}.${p.fieldName} points at model ${p.targetClass}, which is not defined in this file; kept as a plain column`,
          ...pos(p.node),
        }),
      )
      continue
    }
    let targetCol: Column | undefined
    if (p.toField) targetCol = target.columns.find((c) => c.name === p.toField)
    else {
      const pk = primaryKeyColumnIds(target)
      if (pk.length === 1) targetCol = target.columns.find((c) => c.id === pk[0])
    }
    if (!targetCol) {
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          tableId: p.table.id,
          columnId: p.column.id,
          message: p.toField
            ? `${p.table.name}.${p.fieldName}: to_field '${p.toField}' does not exist on ${target.name}`
            : `${p.table.name}.${p.fieldName}: ${target.name} has a composite primary key, which Django cannot reference`,
          ...pos(p.node),
        }),
      )
      continue
    }
    p.column.type = targetCol.type
    const ref: Ref = {
      id: newId(),
      from: { tableId: p.table.id, columnIds: [p.column.id] },
      to: { tableId: target.id, columnIds: [targetCol.id] },
      kind: p.kind,
    }
    if (p.onDelete) ref.onDelete = p.onDelete
    b.schema.refs.push(ref)
  }
}

function resolveManyToMany(b: Builder): void {
  for (const p of b.m2m) {
    const target = p.targetClass === '__self__' ? p.table : b.tablesByClass.get(p.targetClass)
    if (!target) {
      b.diagnostics.push(
        diag({
          severity: 'warning',
          source: 'django',
          tableId: p.table.id,
          message: `${p.table.name}.${p.fieldName}: many-to-many target ${p.targetClass} is not defined in this file; dropped`,
          ...pos(p.node),
        }),
      )
      continue
    }
    const fromPk = primaryKeyColumnIds(p.table)
    const toPk = primaryKeyColumnIds(target)
    const ref: Ref = {
      id: newId(),
      from: { tableId: p.table.id, columnIds: fromPk },
      to: { tableId: target.id, columnIds: toPk },
      kind: '<>',
    }
    if (p.fieldName !== lastSegment(target.name)) ref.name = p.fieldName
    if (p.relatedName || p.through) {
      ref.django = {}
      if (p.relatedName) ref.django.relatedName = p.relatedName
      if (p.through) ref.django.through = p.through
    }
    b.schema.refs.push(ref)
  }
}

/**
 * Remember Django attribute names the generator would not derive from the column name
 * (`editor = ForeignKey(db_column='editor_ref')`, `n = CharField(db_column='n col')`), so
 * regenerated code and any passthrough methods that reference them keep working.
 */
function recordFieldNames(b: Builder): void {
  const fkColumns = new Set<string>()
  for (const r of b.schema.refs) {
    if (r.kind === '<>') continue
    const { fk } = fkSide(r)
    if (fk.columnIds.length === 1) fkColumns.add(fk.columnIds[0])
  }
  for (const t of b.schema.tables) {
    const parsed = b.fieldColumns.get(t.id)
    if (!parsed) continue
    const derived = deriveFieldNames(t, (c) => fkColumns.has(c.id))
    for (const [fieldName, col] of parsed)
      if (derived.get(col.id) !== fieldName) col.django = { ...col.django, fieldName }
  }
}

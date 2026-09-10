import { describe, it, expect } from 'vitest'
import { parseDbml, generateDbml } from '@/core/dbml'
import type { Schema } from '@/core/schema'
import { emptySchema, newTable, newColumn, primaryKeyColumnIds } from '@/core/schema'
import blog from '../fixtures/blog.dbml?raw'
import ecommerce from '../fixtures/ecommerce.dbml?raw'
import kitchenSink from '../fixtures/kitchen_sink.dbml?raw'
import { stripIds } from './dbml-helpers'

const fixtures: Record<string, string> = { blog, ecommerce, kitchen_sink: kitchenSink }

function parseOk(text: string): Schema {
  const r = parseDbml(text)
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(r.schema).toBeDefined()
  return r.schema!
}

describe('parseDbml / generateDbml round trip', () => {
  for (const [name, text] of Object.entries(fixtures)) {
    describe(name, () => {
      it('parse(generate(parse(t))) deep-equals parse(t) ignoring ids', () => {
        const first = parseOk(text)
        const generated = generateDbml(first)
        const second = parseOk(generated)
        expect(stripIds(second)).toEqual(stripIds(first))
      })

      it('generate is idempotent: generate(parse(g)) === g', () => {
        const g = generateDbml(parseOk(text))
        expect(generateDbml(parseOk(g))).toBe(g)
      })

      it('generate is deterministic for the same schema', () => {
        const s = parseOk(text)
        expect(generateDbml(s)).toBe(generateDbml(s))
      })
    })
  }
})

describe('parseDbml diagnostics', () => {
  it('reports a syntax error with the right line', () => {
    const r = parseDbml('Table x {\n  id int\n  name\n}\n')
    expect(r.schema).toBeUndefined()
    expect(r.diagnostics.length).toBeGreaterThanOrEqual(1)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', source: 'dbml', line: 3, col: 3 })
    expect(r.diagnostics[0].message).toMatch(/must have a type/i)

    const r2 = parseDbml('Table x {\n  id int\n  name varchar [pk,, unique]\n}\n')
    expect(r2.schema).toBeUndefined()
    expect(r2.diagnostics[0]).toMatchObject({ severity: 'error', line: 3, col: 20 })
  })

  it('reports a semantic error (unknown column in ref) with a line', () => {
    const r = parseDbml('Table a {\n  id int\n}\nTable b {\n  x int [ref: > a.nope]\n}\n')
    expect(r.schema).toBeUndefined()
    expect(r.diagnostics.some((d) => d.line === 5)).toBe(true)
  })

  it('rejects an empty table without throwing', () => {
    const r = parseDbml('Table t {\n}\n')
    expect(r.schema).toBeUndefined()
    expect(r.diagnostics[0].message).toMatch(/at least one column/i)
  })

  it('warns (lossy) and drops indexes on expressions', () => {
    const r = parseDbml('Table t {\n  a int\n  indexes {\n    `lower(a)`\n    a\n  }\n}\n')
    expect(r.schema).toBeDefined()
    expect(r.schema!.tables[0].indexes).toHaveLength(1)
    const w = r.diagnostics.find((d) => d.severity === 'warning')
    expect(w?.lossy).toBe(true)
    expect(w?.line).toBe(4)
  })

  it('parses an empty document to an empty schema', () => {
    const r = parseDbml('')
    expect(r.schema).toEqual(emptySchema())
    expect(r.diagnostics).toEqual([])
  })
})

describe('parseDbml semantics', () => {
  const ks = parseOk(kitchenSink)
  const table = (n: string) => ks.tables.find((t) => t.name === n)!
  const colId = (t: string, c: string) => table(t).columns.find((x) => x.name === c)!.id

  it('keeps enums with schema, notes and quoted values; enum name is the column type', () => {
    const status = ks.enums.find((e) => e.name === 'order_status')!
    expect(status.values.map((v) => v.name)).toEqual(['pending', 'paid', 'on hold', 'cancelled'])
    expect(status.values[0].note).toBe('Awaiting payment')
    const role = ks.enums.find((e) => e.name === 'role')!
    expect(role.schema).toBe('auth')
    expect(table('users').columns.find((c) => c.name === 'role')!.type).toBe('auth.role')
    expect(table('orders').columns.find((c) => c.name === 'status')!.type).toBe('order_status')
  })

  it('normalises the default schema away and keeps other schemas, aliases and header colours', () => {
    expect(table('users').schema).toBeUndefined()
    expect(table('users').alias).toBe('U')
    expect(table('users').headerColor).toBe('#3498db')
    expect(table('sessions').schema).toBe('auth')
  })

  it('keeps column types as written and defaults as raw DBML', () => {
    const cols = Object.fromEntries(table('users').columns.map((c) => [c.name, c]))
    expect(cols.email.type).toBe('varchar(254)')
    expect(cols.balance.type).toBe('decimal(10,2)')
    expect(cols.display_name.default).toBe("'anonymous'")
    expect(cols.balance.default).toBe('0')
    expect(cols.is_active.default).toBe('true')
    expect(cols.created_at.default).toBe('`now()`')
    expect(cols.deleted_at.default).toBe('null')
    expect(cols.id).toMatchObject({ pk: true, increment: true, notNull: false, unique: false })
    expect(cols.email).toMatchObject({ notNull: true, unique: true, note: 'Login identifier' })
    expect(cols.bio.note).toBe("Multi-line\nbio with 'quotes' and a back\\slash")
    expect(table('users').note).toBe('People who can log in')
  })

  it('maps composite pk via indexes and index settings', () => {
    const ol = table('order_lines')
    expect(primaryKeyColumnIds(ol)).toEqual([colId('order_lines', 'order_id'), colId('order_lines', 'line_no')])
    expect(ol.indexes[0]).toMatchObject({ pk: true, unique: false })
    expect(ol.indexes[1]).toMatchObject({ name: 'order_lines_sku_idx', pk: false, unique: false })
    const sess = table('sessions').indexes[0]
    expect(sess).toMatchObject({ name: 'sessions_user_expiry', type: 'btree' })
    const ord = table('orders').indexes[1]
    expect(ord).toMatchObject({ unique: true, note: 'One order per instant per user' })
  })

  it('maps all four ref kinds, inline refs, names, actions and composite endpoints', () => {
    const byKind = (k: string) => ks.refs.filter((r) => r.kind === k)
    expect(byKind('-')).toHaveLength(1)
    expect(byKind('<')).toHaveLength(2) // explicit `<` plus the inline `[ref: > U.id]` (target listed first)
    expect(byKind('<>')).toHaveLength(1)
    expect(byKind('>')).toHaveLength(2)

    const inline = ks.refs.find((r) => r.to.tableId === table('sessions').id)!
    expect(inline.kind).toBe('<')
    expect(inline.from).toEqual({ tableId: table('users').id, columnIds: [colId('users', 'id')] })
    expect(inline.to.columnIds).toEqual([colId('sessions', 'user_id')])

    const named = ks.refs.find((r) => r.name === 'fk_orders_user')!
    expect(named).toMatchObject({ kind: '>', onDelete: 'restrict', onUpdate: 'cascade' })

    const composite = ks.refs.find((r) => r.from.columnIds.length === 2)!
    expect(composite.from.tableId).toBe(table('order line notes').id)
    expect(composite.to.columnIds).toEqual([colId('order_lines', 'order_id'), colId('order_lines', 'line_no')])
    expect(composite).toMatchObject({ kind: '>', onDelete: 'cascade', onUpdate: 'no action' })
  })

  it('preserves Project, TableGroup and sticky Note blocks verbatim as passthrough', () => {
    expect(ks.project.name).toBe('kitchen_sink')
    expect(ks.project.note).toMatch(/^Exercises/)
    expect(ks.project.passthrough).toHaveLength(3)
    expect(ks.project.passthrough![0]).toMatch(/^Project kitchen_sink \{/)
    expect(ks.project.passthrough![1]).toMatch(/^TableGroup commerce \[color: #27ae60\] \{/)
    expect(ks.project.passthrough![2]).toBe("Note release_notes {\n  'Sticky note kept verbatim by the generator'\n}")
  })

  it('never writes node positions or ids into DBML', () => {
    const g = generateDbml(ks)
    for (const t of ks.tables) expect(g).not.toContain(t.id)
    expect(g).not.toMatch(/\bx:|\by:/)
  })
})

describe('generateDbml formatting', () => {
  it('emits settings in the documented order and quotes awkward names', () => {
    const s = emptySchema()
    const t = newTable({
      name: 'my table',
      columns: [
        newColumn({ name: 'id', type: 'int', pk: true, increment: true, notNull: true, unique: true, default: '1', note: "it's" }),
        newColumn({ name: 'kind', type: 'character varying(20)' }),
      ],
    })
    s.tables.push(t)
    const g = generateDbml(s)
    expect(g).toBe(
      'Table "my table" {\n' +
        "  id int [pk, increment, not null, unique, default: 1, note: 'it\\'s']\n" +
        '  kind "character varying"(20)\n' +
        '}\n',
    )
    const back = parseDbml(g)
    expect(back.schema?.tables[0].columns[1].type).toBe('character varying(20)')
    expect(generateDbml(back.schema!)).toBe(g)
  })

  it('synthesises a Project block from name/note when no passthrough exists', () => {
    const s = emptySchema()
    s.project.name = 'shop'
    s.project.note = 'hello'
    const g = generateDbml(s)
    expect(g).toBe("Project shop {\n  Note: 'hello'\n}\n")
    const back = parseDbml(g).schema!
    expect(back.project).toMatchObject({ name: 'shop', note: 'hello' })
    expect(generateDbml(back)).toBe(g)
  })

  it('skips refs and indexes with dangling ids instead of emitting broken text', () => {
    const s = emptySchema()
    const t = newTable({ name: 't', columns: [newColumn({ name: 'a', type: 'int' })] })
    t.indexes.push({ id: 'i', columnIds: ['missing'], unique: false, pk: false })
    s.tables.push(t)
    s.refs.push({ id: 'r', kind: '>', from: { tableId: t.id, columnIds: ['missing'] }, to: { tableId: 'nope', columnIds: [] } })
    expect(generateDbml(s)).toBe('Table t {\n  a int\n}\n')
  })

  it('returns an empty string for an empty schema', () => {
    expect(generateDbml(emptySchema())).toBe('')
  })
})

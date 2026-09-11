import { describe, it, expect } from 'vitest'
import { parseDbml } from '@/core/dbml'
import { reconcile } from '@/core/reconcile'
import type { Schema, Table } from '@/core/schema'
import kitchenSink from '../fixtures/kitchen_sink.dbml?raw'

const parse = (text: string): Schema => {
  const r = parseDbml(text)
  if (!r.schema) throw new Error(r.diagnostics.map((d) => d.message).join('; '))
  return r.schema
}
const table = (s: Schema, name: string): Table => s.tables.find((t) => t.name === name)!
const colId = (s: Schema, t: string, c: string): string => table(s, t).columns.find((x) => x.name === c)!.id

const BASE = `
Table users {
  id int [pk, increment]
  email varchar [not null, unique]
  name varchar
}

Table posts {
  id int [pk, increment]
  user_id int [not null]
  title varchar
  indexes {
    (user_id, title) [unique]
  }
}

Enum status {
  draft
  live
}

Ref: posts.user_id > users.id
`

describe('reconcile: identity preservation', () => {
  it('returns next unchanged in content and does not mutate its inputs', () => {
    const prev = parse(BASE)
    const next = parse(BASE)
    const prevJson = JSON.stringify(prev)
    const nextJson = JSON.stringify(next)
    const out = reconcile(prev, next)
    expect(JSON.stringify(prev)).toBe(prevJson)
    expect(JSON.stringify(next)).toBe(nextJson)
    expect(out).not.toBe(next)
    expect(out.tables.map((t) => t.name)).toEqual(next.tables.map((t) => t.name))
  })

  it('keeps table, column, index, ref and enum ids when names are unchanged', () => {
    const prev = parse(BASE)
    const out = reconcile(prev, parse(BASE))
    expect(out.tables.map((t) => t.id)).toEqual(prev.tables.map((t) => t.id))
    for (const t of prev.tables) {
      const o = table(out, t.name)
      expect(o.columns.map((c) => c.id)).toEqual(t.columns.map((c) => c.id))
      expect(o.indexes.map((i) => i.id)).toEqual(t.indexes.map((i) => i.id))
      expect(o.indexes.map((i) => i.columnIds)).toEqual(t.indexes.map((i) => i.columnIds))
    }
    expect(out.refs[0].id).toBe(prev.refs[0].id)
    expect(out.refs[0].from).toEqual(prev.refs[0].from)
    expect(out.refs[0].to).toEqual(prev.refs[0].to)
    expect(out.enums[0].id).toBe(prev.enums[0].id)
    expect(out.enums[0].values.map((v) => v.id)).toEqual(prev.enums[0].values.map((v) => v.id))
  })

  it('keeps ids when next already carries prev ids (id match wins over name)', () => {
    const prev = parse(BASE)
    const next = structuredClone(prev)
    // Rename two columns AND swap their positions: id match must still pair them correctly.
    const users = table(next, 'users')
    users.columns[1].name = 'mail'
    users.columns[2].name = 'full_name'
    ;[users.columns[1], users.columns[2]] = [users.columns[2], users.columns[1]]
    const out = reconcile(prev, next)
    expect(table(out, 'users').columns.find((c) => c.name === 'mail')!.id).toBe(colId(prev, 'users', 'email'))
    expect(table(out, 'users').columns.find((c) => c.name === 'full_name')!.id).toBe(colId(prev, 'users', 'name'))
  })

  it('handles the full kitchen-sink fixture without losing a single id', () => {
    const prev = parse(kitchenSink)
    const out = reconcile(prev, parse(kitchenSink))
    expect(JSON.stringify(out)).toBe(JSON.stringify(prev))
  })

  it('matches schema-qualified tables by schema + name, not by name alone', () => {
    const prev = parse('Table a.users {\n  id int\n}\nTable b.users {\n  id int\n  x int\n}\n')
    const next = parse('Table b.users {\n  id int\n  x int\n}\nTable a.users {\n  id int\n}\n')
    const out = reconcile(prev, next)
    expect(out.tables.find((t) => t.schema === 'a')!.id).toBe(prev.tables.find((t) => t.schema === 'a')!.id)
    expect(out.tables.find((t) => t.schema === 'b')!.id).toBe(prev.tables.find((t) => t.schema === 'b')!.id)
  })
})

describe('reconcile: rename heuristics', () => {
  it('a single renamed column keeps its id (and refs/indexes follow it)', () => {
    const prev = parse(BASE)
    const next = parse(BASE.replace('user_id int [not null]', 'author_id int [not null]').replace('(user_id, title)', '(author_id, title)').replace('posts.user_id >', 'posts.author_id >'))
    const out = reconcile(prev, next)
    const renamed = table(out, 'posts').columns.find((c) => c.name === 'author_id')!
    expect(renamed.id).toBe(colId(prev, 'posts', 'user_id'))
    expect(out.refs[0].id).toBe(prev.refs[0].id)
    expect(out.refs[0].from.columnIds).toEqual([colId(prev, 'posts', 'user_id')])
    expect(table(out, 'posts').indexes[0].id).toBe(table(prev, 'posts').indexes[0].id)
  })

  it('does not guess when two columns changed at once', () => {
    const prev = parse(BASE)
    const next = parse(BASE.replace('email varchar', 'mail varchar').replace('name varchar', 'full_name varchar'))
    const out = reconcile(prev, next)
    const ids = new Set(table(prev, 'users').columns.map((c) => c.id))
    const mail = table(out, 'users').columns.find((c) => c.name === 'mail')!
    const full = table(out, 'users').columns.find((c) => c.name === 'full_name')!
    expect(ids.has(mail.id)).toBe(false)
    expect(ids.has(full.id)).toBe(false)
    expect(table(out, 'users').columns[0].id).toBe(colId(prev, 'users', 'id'))
  })

  it('an added column gets a fresh id, a removed column disappears', () => {
    const prev = parse(BASE)
    const next = parse(BASE.replace('  name varchar\n', '  name varchar\n  age int\n'))
    const out = reconcile(prev, next)
    const ids = new Set(table(prev, 'users').columns.map((c) => c.id))
    expect(ids.has(table(out, 'users').columns.find((c) => c.name === 'age')!.id)).toBe(false)
    const removed = reconcile(prev, parse(BASE.replace('  name varchar\n', '')))
    expect(table(removed, 'users').columns.map((c) => c.id)).toEqual(table(prev, 'users').columns.slice(0, 2).map((c) => c.id))
  })

  it('a renamed table with identical columns keeps its id (layout survives); a new table gets a new id', () => {
    const prev = parse(BASE)
    const next = parse(BASE.replace('Table posts {', 'Table articles {').replace('posts.user_id', 'articles.user_id'))
    const out = reconcile(prev, next)
    expect(table(out, 'articles').id).toBe(table(prev, 'posts').id)
    expect(table(out, 'articles').columns.map((c) => c.id)).toEqual(table(prev, 'posts').columns.map((c) => c.id))
    expect(out.refs[0].id).toBe(prev.refs[0].id)

    const added = reconcile(prev, parse(`${BASE}\nTable comments {\n  id int [pk]\n  body text\n}\n`))
    const prevIds = new Set(prev.tables.map((t) => t.id))
    expect(prevIds.has(table(added, 'comments').id)).toBe(false)
    expect(table(added, 'users').id).toBe(table(prev, 'users').id)
  })

  it('does not treat a table as renamed when its columns differ', () => {
    const prev = parse(BASE)
    const next = parse(BASE.replace('Table posts {', 'Table articles {').replace('title varchar', 'headline varchar').replace('(user_id, title)', '(user_id, headline)').replace('posts.user_id', 'articles.user_id'))
    const out = reconcile(prev, next)
    expect(table(out, 'articles').id).not.toBe(table(prev, 'posts').id)
  })

  it('renames a table even when its column order changed, but not when two candidates tie', () => {
    const single = parse('Table a {\n  x int\n  y int\n}\n')
    const renamed = reconcile(single, parse('Table z {\n  y int\n  x int\n}\n'))
    expect(renamed.tables[0].id).toBe(single.tables[0].id)

    const two = parse('Table a {\n  x int\n  y int\n}\nTable b {\n  x int\n  y int\n}\n')
    const tie = reconcile(two, parse('Table c {\n  x int\n  y int\n}\n'))
    expect(two.tables.map((t) => t.id)).not.toContain(tie.tables[0].id)
  })

  it('matches a ref written from the other side and keeps its id', () => {
    const prev = parse(BASE)
    const next = parse(BASE.replace('Ref: posts.user_id > users.id', 'Ref: users.id < posts.user_id'))
    const out = reconcile(prev, next)
    expect(out.refs[0].id).toBe(prev.refs[0].id)
    expect(out.refs[0].kind).toBe('<')
  })

  it('a changed ref target gets a new id', () => {
    const prev = parse(`${BASE}\nTable orgs {\n  id int [pk]\n}\n`)
    const next = parse(`${BASE.replace('Ref: posts.user_id > users.id', 'Ref: posts.user_id > orgs.id')}\nTable orgs {\n  id int [pk]\n}\n`)
    const out = reconcile(prev, next)
    expect(out.refs[0].id).not.toBe(prev.refs[0].id)
  })

  it('renames a single enum value and an enum with identical values', () => {
    const prev = parse(BASE)
    const out = reconcile(prev, parse(BASE.replace('  live\n', '  published\n')))
    expect(out.enums[0].id).toBe(prev.enums[0].id)
    expect(out.enums[0].values[1].id).toBe(prev.enums[0].values[1].id)

    const renamedEnum = reconcile(prev, parse(BASE.replace('Enum status {', 'Enum post_status {')))
    expect(renamedEnum.enums[0].id).toBe(prev.enums[0].id)
    expect(renamedEnum.enums[0].values.map((v) => v.id)).toEqual(prev.enums[0].values.map((v) => v.id))
  })
})

describe('reconcile: django metadata', () => {
  it('carries django bags from prev onto matched entities that lack one', () => {
    const prev = parse(BASE)
    table(prev, 'users').django = { className: 'Account' }
    table(prev, 'users').columns[1].django = { fieldType: 'EmailField' }
    prev.refs[0].django = { relatedName: 'posts' }
    const out = reconcile(prev, parse(BASE))
    expect(table(out, 'users').django).toEqual({ className: 'Account' })
    expect(table(out, 'users').columns[1].django).toEqual({ fieldType: 'EmailField' })
    expect(out.refs[0].django).toEqual({ relatedName: 'posts' })
    // Copies, not shared references.
    expect(table(out, 'users').django).not.toBe(table(prev, 'users').django)
  })

  it('does not overwrite bags next already has, and can be disabled', () => {
    const prev = parse(BASE)
    table(prev, 'users').django = { className: 'Account' }
    const next = parse(BASE)
    table(next, 'users').django = { className: 'Member' }
    expect(table(reconcile(prev, next), 'users').django).toEqual({ className: 'Member' })
    expect(table(reconcile(prev, parse(BASE), { preserveDjango: false }), 'users').django).toBeUndefined()
  })
})

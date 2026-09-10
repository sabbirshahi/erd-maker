import { describe, expect, it } from 'vitest'
import { parseDbml } from '@/core/dbml'
import { examples, findExample, loadExample } from './index'
import { sketchDbml } from './sketch'

describe('examples registry', () => {
  it('has the five required examples with unique ids', () => {
    const ids = examples.map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['blog', 'ecommerce', 'school', 'saas_multitenant', 'django_auth']))
    expect(new Set(ids).size).toBe(ids.length)
    expect(findExample('blog')?.title).toBe('Blog')
  })

  it.each(examples.map((e) => [e.id, e] as const))('%s parses with zero error diagnostics', (_id, ex) => {
    const res = parseDbml(ex.dbml)
    const errors = res.diagnostics.filter((d) => d.severity === 'error')
    expect(errors).toEqual([])
    expect(res.schema?.tables.length ?? 0).toBeGreaterThan(0)
  })

  it('loadExample maps a name-keyed layout onto table ids', () => {
    const ex = { ...findExample('blog')!, layout: { users: { x: 10, y: 20 } } }
    const res = loadExample(ex)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const users = res.doc.schema.tables.find((t) => t.name === 'users')!
    expect(res.doc.layout[users.id]).toEqual({ x: 10, y: 20 })
    expect(res.doc.dbmlText).toBe(ex.dbml)
  })
})

describe('sketchDbml', () => {
  it('counts tables, columns and refs from the blog example', () => {
    const sk = sketchDbml(findExample('blog')!.dbml)
    expect(sk.tables.map((t) => t.name)).toEqual(['users', 'posts', 'tags', 'comments'])
    expect(sk.tables[0].columns).toBe(5) // Note line excluded
    expect(sk.tables[1].columns).toBe(6) // indexes block excluded
    // 1 inline ref + 3 Ref lines
    expect(sk.refs).toHaveLength(4)
    expect(sk.refs).toContainEqual([1, 0])
    expect(sk.refs).toContainEqual([3, 1])
  })

  it('handles schema-qualified, quoted and aliased tables and never throws on junk', () => {
    const sk = sketchDbml('Table public.orders as O {\n  id int\n}\nTable "order items" {\n  id int\n  order_id int [ref: > O.id]\n}\n')
    expect(sk.tables.map((t) => t.name)).toEqual(['orders', 'order items'])
    expect(sk.refs).toEqual([[1, 0]])
    expect(() => sketchDbml('{{{ garbage ]]] Table')).not.toThrow()
    expect(sketchDbml('').tables).toEqual([])
  })
})

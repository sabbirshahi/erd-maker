import { describe, expect, it } from 'vitest'
import { emptySchema, newColumn, newIdColumn, newTable, type Ref, type Schema } from '@/core/schema'
import {
  buildElkGraph,
  elkLayout,
  elkResultToLayout,
  estimateTableSize,
  gridLayout,
  layoutBounds,
  placeUnpositioned,
  type ElkLike,
} from './layout'

function fixture(): Schema {
  const s = emptySchema()
  const users = newTable({ name: 'users', columns: [newIdColumn()] })
  const posts = newTable({ name: 'posts', columns: [newIdColumn(), newColumn({ name: 'author_id', type: 'int' })] })
  const tags = newTable({ name: 'tags', columns: [newIdColumn()] })
  s.tables.push(users, posts, tags)
  const ref: Ref = {
    id: 'r1',
    kind: '>',
    from: { tableId: posts.id, columnIds: [posts.columns[1].id] },
    to: { tableId: users.id, columnIds: [users.columns[0].id] },
  }
  const m2m: Ref = {
    id: 'r2',
    kind: '<>',
    from: { tableId: posts.id, columnIds: [posts.columns[0].id] },
    to: { tableId: tags.id, columnIds: [tags.columns[0].id] },
  }
  const self: Ref = {
    id: 'r3',
    kind: '>',
    from: { tableId: users.id, columnIds: [users.columns[0].id] },
    to: { tableId: users.id, columnIds: [users.columns[0].id] },
  }
  s.refs.push(ref, m2m, self)
  return s
}

describe('estimateTableSize', () => {
  it('grows with the number of columns and never shrinks below the base width', () => {
    const small = newTable({ name: 't', columns: [newIdColumn()] })
    const big = newTable({ name: 't', columns: Array.from({ length: 10 }, (_, i) => newColumn({ name: `c${i}` })) })
    expect(estimateTableSize(big).height).toBeGreaterThan(estimateTableSize(small).height)
    expect(estimateTableSize(small).width).toBeGreaterThanOrEqual(240)
  })
})

describe('gridLayout / placeUnpositioned', () => {
  it('places tables without overlap in rows', () => {
    const s = fixture()
    const layout = gridLayout(s.tables, () => ({ width: 100, height: 50 }), { columns: 2, gapX: 10, gapY: 10 })
    expect(layout[s.tables[0].id]).toEqual({ x: 0, y: 0 })
    expect(layout[s.tables[1].id]).toEqual({ x: 110, y: 0 })
    expect(layout[s.tables[2].id]).toEqual({ x: 0, y: 60 })
  })

  it('only positions the missing tables, below the existing diagram', () => {
    const s = fixture()
    const existing = { [s.tables[0].id]: { x: 100, y: 100 } }
    const patch = placeUnpositioned(s, existing, () => ({ width: 100, height: 50 }))
    expect(Object.keys(patch).sort()).toEqual([s.tables[1].id, s.tables[2].id].sort())
    for (const p of Object.values(patch)) {
      expect(p.x).toBeGreaterThanOrEqual(100)
      expect(p.y).toBeGreaterThan(150)
    }
    expect(placeUnpositioned(s, { ...existing, ...patch })).toEqual({})
    expect(layoutBounds(s, {})).toBeUndefined()
  })
})

describe('elk adapter', () => {
  it('builds a layered graph with FK -> target edges, skipping self refs', () => {
    const s = fixture()
    const g = buildElkGraph(s, () => ({ width: 200, height: 80 }))
    expect(g.layoutOptions?.['elk.algorithm']).toBe('layered')
    expect(g.children?.map((c) => c.id)).toEqual(s.tables.map((t) => t.id))
    expect(g.children?.[0]).toMatchObject({ width: 200, height: 80 })
    expect(g.edges?.map((e) => e.id)).toEqual(['r1', 'r2'])
    expect(g.edges?.[0]).toMatchObject({ sources: [s.tables[1].id], targets: [s.tables[0].id] })
  })

  it('converts elk output to a rounded Layout', () => {
    expect(elkResultToLayout({ id: 'root', children: [{ id: 'a', x: 12.4, y: 7.6 }, { id: 'b' }] })).toEqual({
      a: { x: 12, y: 8 },
      b: { x: 0, y: 0 },
    })
  })

  it('uses the injected engine and fills in nodes the engine dropped', async () => {
    const s = fixture()
    const fake: ElkLike = {
      layout: async (g) => ({ ...g, children: [{ id: s.tables[0].id, x: 5, y: 5 }] }),
    }
    const layout = await elkLayout(s, undefined, fake)
    expect(layout[s.tables[0].id]).toEqual({ x: 5, y: 5 })
    expect(layout[s.tables[1].id]).toBeDefined()
    expect(layout[s.tables[2].id]).toBeDefined()
  })

  it('falls back to a grid when the engine throws', async () => {
    const s = fixture()
    const broken: ElkLike = { layout: async () => Promise.reject(new Error('boom')) }
    const layout = await elkLayout(s, undefined, broken)
    expect(Object.keys(layout)).toHaveLength(3)
    expect(await elkLayout(emptySchema(), undefined, broken)).toEqual({})
  })

  it('runs the real elk engine and places the referenced table to the right of the FK table', async () => {
    const s = fixture()
    const layout = await elkLayout(s)
    expect(Object.keys(layout)).toHaveLength(3)
    const users = layout[s.tables[0].id]
    const posts = layout[s.tables[1].id]
    expect(users.x).toBeGreaterThan(posts.x)
  }, 20_000)
})

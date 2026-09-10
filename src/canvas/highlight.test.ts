import { describe, expect, it } from 'vitest'
import { emptySchema, newIdColumn, newTable, type Ref } from '@/core/schema'
import { computeHighlight, neighbourTableIds, sameAnchor } from './highlight'
import { canvasDiagnostics } from './diagnostics'
import { newColumn } from '@/core/schema'

function fixture() {
  const s = emptySchema()
  const a = newTable({ name: 'a', columns: [newIdColumn()] })
  const b = newTable({ name: 'b', columns: [newIdColumn(), newColumn({ name: 'a_id', type: 'int' })] })
  const c = newTable({ name: 'c', columns: [newIdColumn(), newColumn({ name: 'b_id', type: 'int' })] })
  const d = newTable({ name: 'd', columns: [newIdColumn()] })
  s.tables.push(a, b, c, d)
  const ab: Ref = { id: 'ab', kind: '>', from: { tableId: b.id, columnIds: [b.columns[1].id] }, to: { tableId: a.id, columnIds: [a.columns[0].id] } }
  const bc: Ref = { id: 'bc', kind: '>', from: { tableId: c.id, columnIds: [c.columns[1].id] }, to: { tableId: b.id, columnIds: [b.columns[0].id] } }
  s.refs.push(ab, bc)
  return { s, a, b, c, d }
}

describe('computeHighlight', () => {
  it('returns nothing without an anchor', () => {
    const { s } = fixture()
    const h = computeHighlight(s, null)
    expect(h.tables.size).toBe(0)
    expect(h.refs.size).toBe(0)
  })

  it('table anchor: itself, its neighbours and exactly its refs', () => {
    const { s, a, b, c, d } = fixture()
    const h = computeHighlight(s, { kind: 'table', id: a.id })
    expect([...h.tables].sort()).toEqual([a.id, b.id].sort())
    expect([...h.refs]).toEqual(['ab'])
    expect(h.tables.has(c.id)).toBe(false)
    expect(h.tables.has(d.id)).toBe(false)
    expect(neighbourTableIds(s, b.id).sort()).toEqual([a.id, b.id, c.id].sort())
  })

  it('ref anchor: the ref and its two tables', () => {
    const { s, b, c } = fixture()
    const h = computeHighlight(s, { kind: 'ref', id: 'bc' })
    expect([...h.tables].sort()).toEqual([b.id, c.id].sort())
    expect([...h.refs]).toEqual(['bc'])
    expect(computeHighlight(s, { kind: 'ref', id: 'missing' }).tables.size).toBe(0)
  })

  it('compares anchors structurally', () => {
    expect(sameAnchor(null, null)).toBe(true)
    expect(sameAnchor({ kind: 'table', id: 'x' }, { kind: 'table', id: 'x' })).toBe(true)
    expect(sameAnchor({ kind: 'table', id: 'x' }, { kind: 'ref', id: 'x' })).toBe(false)
    expect(sameAnchor({ kind: 'table', id: 'x' }, null)).toBe(false)
  })
})

describe('canvasDiagnostics', () => {
  it('is empty for a clean schema', () => {
    expect(canvasDiagnostics(fixture().s)).toEqual([])
  })

  it('reports duplicate and empty names, missing types and type mismatches', () => {
    const { s, a, b } = fixture()
    s.tables.push(newTable({ name: 'a', columns: [newIdColumn()] }))
    s.tables.push(newTable({ name: '', columns: [] }))
    b.columns.push(newColumn({ name: 'id' }))
    b.columns.push(newColumn({ name: '', type: '' }))
    a.columns[0].type = 'bigint' // b.a_id is int -> mismatch
    const diags = canvasDiagnostics(s)
    const messages = diags.map((d) => d.message)
    expect(messages).toContainEqual(expect.stringMatching(/Duplicate table name `a`/))
    expect(messages).toContainEqual(expect.stringMatching(/Table has an empty name/))
    expect(messages).toContainEqual(expect.stringMatching(/Duplicate column name `id` in `b`/))
    expect(messages).toContainEqual(expect.stringMatching(/has an empty name/))
    expect(messages).toContainEqual(expect.stringMatching(/has no type/))
    expect(messages).toContainEqual(expect.stringMatching(/Type mismatch/))
    expect(diags.every((d) => d.source === 'canvas')).toBe(true)
  })
})

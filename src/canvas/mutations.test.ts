import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { emptySchema, newColumn, newIdColumn, newTable, type Ref, type Schema } from '@/core/schema'
import {
  addColumn,
  addTable,
  isBlankColumn,
  moveColumn,
  removeColumn,
  removeRef,
  removeTable,
  uniqueColumnName,
  uniqueName,
  uniqueTableName,
} from './mutations'

function fixture(): Schema {
  const s = emptySchema()
  const users = newTable({ name: 'users', columns: [newIdColumn()] })
  const posts = newTable({
    name: 'posts',
    columns: [newIdColumn(), newColumn({ name: 'author_id', type: 'int' }), newColumn({ name: 'title' })],
    indexes: [],
  })
  posts.indexes.push({ id: 'i1', columnIds: [posts.columns[1].id, posts.columns[2].id], unique: false, pk: false })
  s.tables.push(users, posts)
  const ref: Ref = {
    id: 'r1',
    kind: '>',
    from: { tableId: posts.id, columnIds: [posts.columns[1].id] },
    to: { tableId: users.id, columnIds: [users.columns[0].id] },
  }
  s.refs.push(ref)
  return s
}

describe('naming', () => {
  it('picks the first free numbered name', () => {
    expect(uniqueName(['table_1', 'table_3'], 'table')).toBe('table_2')
    expect(uniqueTableName(fixture())).toBe('table_1')
    const t = newTable({ name: 't', columns: [newColumn({ name: 'column_1' })] })
    expect(uniqueColumnName(t)).toBe('column_2')
  })
})

describe('mutators', () => {
  it('addTable adds an id column', () => {
    const s = produce(fixture(), (d) => {
      const t = addTable(d)
      expect(t.name).toBe('table_1')
    })
    expect(s.tables).toHaveLength(3)
    expect(s.tables[2].columns[0]).toMatchObject({ name: 'id', pk: true, increment: true })
  })

  it('addColumn appends with a unique name and honours overrides', () => {
    const base = fixture()
    const s = produce(base, (d) => {
      addColumn(d, base.tables[0].id, { type: 'text' })
      expect(addColumn(d, 'missing')).toBeUndefined()
    })
    expect(s.tables[0].columns[1]).toMatchObject({ name: 'column_1', type: 'text' })
  })

  it('removeColumn drops dependent refs and prunes indexes', () => {
    const base = fixture()
    const posts = base.tables[1]
    const s = produce(base, (d) => removeColumn(d, posts.id, posts.columns[1].id))
    expect(s.tables[1].columns.map((c) => c.name)).toEqual(['id', 'title'])
    expect(s.refs).toHaveLength(0)
    expect(s.tables[1].indexes[0].columnIds).toEqual([posts.columns[2].id])
    // removing the last column of an index removes the index
    const s2 = produce(s, (d) => removeColumn(d, posts.id, posts.columns[2].id))
    expect(s2.tables[1].indexes).toHaveLength(0)
  })

  it('removeTable drops its refs; removeRef drops one ref', () => {
    const base = fixture()
    const s = produce(base, (d) => removeTable(d, base.tables[0].id))
    expect(s.tables.map((t) => t.name)).toEqual(['posts'])
    expect(s.refs).toHaveLength(0)
    expect(produce(base, (d) => removeRef(d, 'r1')).refs).toHaveLength(0)
    expect(produce(base, (d) => removeRef(d, 'nope')).refs).toHaveLength(1)
  })

  it('moveColumn reorders and clamps', () => {
    const base = fixture()
    const posts = base.tables[1]
    const names = (s: Schema) => s.tables[1].columns.map((c) => c.name)
    expect(names(produce(base, (d) => moveColumn(d, posts.id, 2, 0)))).toEqual(['title', 'id', 'author_id'])
    expect(names(produce(base, (d) => moveColumn(d, posts.id, 0, 99)))).toEqual(['author_id', 'title', 'id'])
    expect(names(produce(base, (d) => moveColumn(d, posts.id, 1, 1)))).toEqual(['id', 'author_id', 'title'])
    expect(names(produce(base, (d) => moveColumn(d, posts.id, -1, 1)))).toEqual(['id', 'author_id', 'title'])
  })

  it('detects blank columns', () => {
    expect(isBlankColumn(newColumn({ name: '' }))).toBe(true)
    expect(isBlankColumn(newColumn({ name: '  ' }))).toBe(true)
    expect(isBlankColumn(newColumn({ name: '', pk: true }))).toBe(false)
    expect(isBlankColumn(newColumn({ name: 'x' }))).toBe(false)
  })
})

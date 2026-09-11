import { describe, it, expect } from 'vitest'
import { copySelection, pasteInto, describePayload } from './clipboard'
import { emptySchema, newColumn, newTable, type Layout, type Ref, type Schema } from '@/core/schema'

/** users(id) <- posts(user_id), plus an unrelated tags table. */
function fixture(): { schema: Schema; layout: Layout } {
  const schema = emptySchema()
  const users = newTable({ name: 'users', columns: [newColumn({ name: 'id', type: 'int', pk: true })] })
  const posts = newTable({
    name: 'posts',
    columns: [newColumn({ name: 'id', type: 'int', pk: true }), newColumn({ name: 'user_id', type: 'int' })],
  })
  const tags = newTable({ name: 'tags', columns: [newColumn({ name: 'id', type: 'int', pk: true })] })
  schema.tables.push(users, posts, tags)
  const ref: Ref = {
    id: 'r1',
    kind: '>',
    from: { tableId: posts.id, columnIds: [posts.columns[1].id] },
    to: { tableId: users.id, columnIds: [users.columns[0].id] },
  }
  schema.refs.push(ref)
  const layout: Layout = { [users.id]: { x: 0, y: 0 }, [posts.id]: { x: 300, y: 0 }, [tags.id]: { x: 600, y: 0 } }
  return { schema, layout }
}

describe('canvas clipboard', () => {
  it('copies a relation only when both endpoints are selected', () => {
    const { schema, layout } = fixture()
    const [users, posts] = schema.tables
    expect(copySelection(schema, layout, [posts.id])!.refs).toHaveLength(0)
    expect(copySelection(schema, layout, [users.id, posts.id])!.refs).toHaveLength(1)
    expect(copySelection(schema, layout, [])).toBeNull()
  })

  it('pastes with fresh ids, non-clashing names and remapped relations', () => {
    const { schema, layout } = fixture()
    const [users, posts] = schema.tables
    const payload = copySelection(schema, layout, [users.id, posts.id])!

    const result = pasteInto(schema, payload)

    expect(schema.tables).toHaveLength(5)
    expect(result.tableIds).toHaveLength(2)
    // Names are made unique rather than duplicated.
    const names = schema.tables.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    // Ids are new everywhere.
    expect(result.tableIds).not.toContain(users.id)
    const pastedPosts = schema.tables.find((t) => t.id === result.tableIds[1])!
    expect(pastedPosts.columns.map((c) => c.id)).not.toContain(posts.columns[0].id)
    // The copied relation points at the copies, not the originals.
    const newRef = schema.refs[1]
    expect(newRef.from.tableId).toBe(result.tableIds[1])
    expect(newRef.to.tableId).toBe(result.tableIds[0])
    expect(newRef.from.columnIds[0]).toBe(pastedPosts.columns[1].id)
    // Offset keeps the copy visible instead of hiding it under the original.
    expect(result.layout[result.tableIds[0]]).toEqual({ x: 40, y: 40 })
  })

  it('leaves the original schema untouched when copying', () => {
    const { schema, layout } = fixture()
    const payload = copySelection(schema, layout, [schema.tables[0].id])!
    payload.tables[0].name = 'mutated'
    expect(schema.tables[0].name).toBe('users')
  })

  it('describes a payload for the toast', () => {
    const { schema, layout } = fixture()
    expect(describePayload(copySelection(schema, layout, [schema.tables[2].id])!)).toBe('1 table')
    expect(describePayload(copySelection(schema, layout, [schema.tables[0].id, schema.tables[1].id])!)).toBe(
      '2 tables and 1 relation',
    )
  })
})

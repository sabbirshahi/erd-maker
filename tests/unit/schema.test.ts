import { describe, it, expect } from 'vitest'
import { emptySchema, newTable, newColumn, topologicalTables, type Ref } from '@/core/schema'
import { tableNameToClassName, classNameToTableName } from '@/core/naming'

describe('schema helpers', () => {
  it('orders tables parents-first', () => {
    const s = emptySchema()
    const users = newTable({ name: 'users', columns: [newColumn({ name: 'id', type: 'int', pk: true })] })
    const posts = newTable({ name: 'posts', columns: [newColumn({ name: 'user_id', type: 'int' })] })
    s.tables.push(posts, users)
    const ref: Ref = { id: 'r1', kind: '>', from: { tableId: posts.id, columnIds: [posts.columns[0].id] }, to: { tableId: users.id, columnIds: [users.columns[0].id] } }
    s.refs.push(ref)
    expect(topologicalTables(s).map((t) => t.name)).toEqual(['users', 'posts'])
  })

  it('maps table names to class names and back', () => {
    expect(tableNameToClassName('users')).toBe('User')
    expect(tableNameToClassName('order_items')).toBe('OrderItem')
    expect(tableNameToClassName('categories')).toBe('Category')
    expect(classNameToTableName('OrderItem')).toBe('order_items')
  })
})

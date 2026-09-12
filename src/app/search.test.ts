import { describe, it, expect } from 'vitest'
import { fuzzyScore, searchSchema } from './search'
import { emptySchema, newColumn, newTable, type Schema } from '@/core/schema'

function build(): Schema {
  const s = emptySchema()
  const users = newTable({ name: 'users' })
  users.columns = [newColumn({ name: 'id', type: 'int' }), newColumn({ name: 'email', type: 'varchar(254)' })]
  const orderItems = newTable({ name: 'order_items' })
  orderItems.columns = [newColumn({ name: 'quantity', type: 'int' })]
  const orders = newTable({ name: 'orders' })
  s.tables.push(users, orderItems, orders)
  return s
}

describe('fuzzyScore', () => {
  it('matches a subsequence and rejects a non-match', () => {
    expect(fuzzyScore('oi', 'order_items')).toBeGreaterThan(0)
    expect(fuzzyScore('zzz', 'order_items')).toBe(-1)
  })

  it('scores a contiguous run above scattered letters', () => {
    expect(fuzzyScore('order', 'order_items')).toBeGreaterThan(fuzzyScore('oitem', 'order_items'))
  })

  it('scores a prefix above a match in the middle', () => {
    expect(fuzzyScore('user', 'users')).toBeGreaterThan(fuzzyScore('user', 'app_user'))
  })
})

describe('searchSchema', () => {
  it('lists the tables when the query is empty', () => {
    const hits = searchSchema(build(), '')
    expect(hits).toHaveLength(3)
    expect(hits.every((h) => h.kind === 'table')).toBe(true)
  })

  it('finds a table by initials', () => {
    expect(searchSchema(build(), 'oi')[0].tableName).toBe('order_items')
  })

  it('finds a column and reports which table it belongs to', () => {
    const hit = searchSchema(build(), 'email').find((h) => h.kind === 'column')!
    expect(hit.columnName).toBe('email')
    expect(hit.tableName).toBe('users')
    expect(hit.detail).toBe('varchar(254)')
  })

  it('accepts a qualified name', () => {
    const hit = searchSchema(build(), 'users.email')[0]
    expect(hit.kind).toBe('column')
    expect(hit.columnName).toBe('email')
  })

  it('puts the exact table above its own columns', () => {
    expect(searchSchema(build(), 'users')[0]).toMatchObject({ kind: 'table', tableName: 'users' })
  })
})

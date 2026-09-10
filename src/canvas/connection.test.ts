import { describe, expect, it } from 'vitest'
import { emptySchema, newColumn, newIdColumn, newTable, type Schema } from '@/core/schema'
import { handleId, parseHandleId } from './handles'
import {
  buildRef,
  isDuplicateRef,
  normaliseType,
  refKindLabel,
  resolveEndpoints,
  typeMismatchWarning,
  validateConnection,
} from './connection'

function fixture(): { schema: Schema; users: ReturnType<typeof newTable>; posts: ReturnType<typeof newTable> } {
  const schema = emptySchema()
  const users = newTable({ name: 'users', columns: [newIdColumn(), newColumn({ name: 'email' })] })
  const posts = newTable({
    name: 'posts',
    columns: [newIdColumn(), newColumn({ name: 'author_id', type: 'int' }), newColumn({ name: 'slug' })],
  })
  schema.tables.push(users, posts)
  return { schema, users, posts }
}

const conn = (
  from: { id: string; columns: { id: string }[] },
  fi: number,
  to: { id: string; columns: { id: string }[] },
  ti: number,
) => ({
  source: from.id,
  sourceHandle: handleId(from.id, from.columns[fi].id, 'R'),
  target: to.id,
  targetHandle: handleId(to.id, to.columns[ti].id, 'L'),
})

describe('handle ids', () => {
  it('round-trips', () => {
    expect(parseHandleId(handleId('t1', 'c1', 'L'))).toEqual({ tableId: 't1', columnId: 'c1', side: 'L' })
    expect(parseHandleId(null)).toBeNull()
    expect(parseHandleId('t1:c1')).toBeNull()
    expect(parseHandleId('t1:c1:X')).toBeNull()
    expect(parseHandleId('t1::R')).toBeNull()
  })
})

describe('validateConnection', () => {
  it('accepts a plain FK connection and builds a ">" ref with the FK on the source', () => {
    const { schema, users, posts } = fixture()
    const c = conn(posts, 1, users, 0)
    const verdict = validateConnection(schema, c)
    expect(verdict).toEqual({ ok: true, warnings: [] })
    const ref = buildRef(schema, c)!
    expect(ref.kind).toBe('>')
    expect(ref.from).toEqual({ tableId: posts.id, columnIds: [posts.columns[1].id] })
    expect(ref.to).toEqual({ tableId: users.id, columnIds: [users.columns[0].id] })
  })

  it('rejects connecting a column to itself', () => {
    const { schema, users } = fixture()
    const v = validateConnection(schema, conn(users, 0, users, 0))
    expect(v.ok).toBe(false)
  })

  it('allows a self-referencing table on different columns', () => {
    const { schema, users } = fixture()
    expect(validateConnection(schema, conn(users, 1, users, 0)).ok).toBe(true)
  })

  it('rejects duplicates in either direction', () => {
    const { schema, users, posts } = fixture()
    schema.refs.push(buildRef(schema, conn(posts, 1, users, 0))!)
    expect(validateConnection(schema, conn(posts, 1, users, 0)).ok).toBe(false)
    expect(validateConnection(schema, conn(users, 0, posts, 1)).ok).toBe(false)
    expect(isDuplicateRef(schema, { tableId: users.id, columnId: users.columns[0].id }, { tableId: posts.id, columnId: posts.columns[1].id })).toBe(true)
    // a different column pair is fine
    expect(validateConnection(schema, conn(posts, 2, users, 0)).ok).toBe(true)
  })

  it('rejects handles that do not resolve to a single existing column', () => {
    const { schema, users, posts } = fixture()
    expect(validateConnection(schema, { source: posts.id, target: users.id, sourceHandle: null, targetHandle: null }).ok).toBe(false)
    expect(
      validateConnection(schema, {
        source: posts.id,
        target: users.id,
        sourceHandle: handleId(posts.id, 'nope', 'R'),
        targetHandle: handleId(users.id, users.columns[0].id, 'L'),
      }).ok,
    ).toBe(false)
    // handle claims a table other than the node it sits on
    expect(
      validateConnection(schema, {
        source: users.id,
        target: users.id,
        sourceHandle: handleId(posts.id, posts.columns[1].id, 'R'),
        targetHandle: handleId(users.id, users.columns[0].id, 'L'),
      }).ok,
    ).toBe(false)
    expect(resolveEndpoints(schema, { source: null, target: null })).toBeNull()
  })

  it('allows but warns on a type mismatch', () => {
    const { schema, users, posts } = fixture()
    const v = validateConnection(schema, conn(posts, 2, users, 0)) // slug varchar(255) -> id int
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.warnings).toHaveLength(1)
      expect(v.warnings[0].severity).toBe('warning')
      expect(v.warnings[0].source).toBe('canvas')
      expect(v.warnings[0].message).toMatch(/Type mismatch/)
      expect(v.warnings[0].tableId).toBe(posts.id)
      expect(v.warnings[0].columnId).toBe(posts.columns[2].id)
    }
  })

  it('type comparison ignores case and whitespace; M2M refs never warn', () => {
    expect(normaliseType(' VARCHAR (255) ')).toBe('varchar(255)')
    const { schema, users, posts } = fixture()
    const ref = buildRef(schema, conn(posts, 2, users, 0), '<>')!
    expect(typeMismatchWarning(schema, ref)).toBeNull()
    const ref2 = buildRef(schema, conn(posts, 2, users, 0), '<')!
    // kind "<": FK on `to` (users.id int) referencing posts.slug varchar -> mismatch reported on users side
    const w = typeMismatchWarning(schema, ref2)
    expect(w?.tableId).toBe(users.id)
  })

  it('labels kinds', () => {
    expect(refKindLabel('>')).toBe('*..1')
    expect(refKindLabel('<')).toBe('1..*')
    expect(refKindLabel('-')).toBe('1..1')
    expect(refKindLabel('<>')).toBe('*..*')
  })
})

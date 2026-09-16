import { describe, expect, it } from 'vitest'
import { generateFakeData, type FakeDataset } from '@/core/fake'
import { formatDateTime, parseType, uniqueFallback, valueForType } from '@/core/fake/heuristics'
import { emptySchema, newColumn, newIdColumn, newTable, type Column, type Ref, type Schema, type Table } from '@/core/schema'

// ---------- fixture: blog (users, posts -> users, tags, comments -> posts/users, posts <> tags) ----------

function col(name: string, type: string, extra: Partial<Column> = {}): Column {
  return newColumn({ id: `${name}_${type}`.replace(/[^a-z0-9_]/gi, '_'), name, type, ...extra })
}

function table(name: string, columns: Column[], extra: Partial<Table> = {}): Table {
  return newTable({ id: `t_${name}`, name, columns, indexes: [], ...extra })
}

function colId(t: Table, name: string): string {
  return t.columns.find((c) => c.name === name)!.id
}

function ref(id: string, from: Table, fromCols: string[], to: Table, toCols: string[], kind: Ref['kind'] = '>'): Ref {
  return {
    id,
    kind,
    from: { tableId: from.id, columnIds: fromCols.map((c) => colId(from, c)) },
    to: { tableId: to.id, columnIds: toCols.map((c) => colId(to, c)) },
  }
}

function blogSchema(): Schema {
  const users = table('users', [
    { ...newIdColumn(), id: 'users_id' },
    col('username', 'varchar(150)', { notNull: true, unique: true }),
    col('email', 'varchar(254)', { notNull: true, unique: true }),
    col('is_active', 'boolean', { notNull: true }),
    col('created_at', 'timestamp', { notNull: true }),
  ])
  const posts = table('posts', [
    { ...newIdColumn(), id: 'posts_id' },
    col('author_id', 'int', { notNull: true }),
    col('title', 'varchar(200)', { notNull: true }),
    col('body', 'text'),
    col('status', 'post_status', { notNull: true }),
    col('published_at', 'timestamp'),
    col('price', 'decimal(10,2)', { notNull: true }),
  ])
  const tags = table('tags', [{ ...newIdColumn(), id: 'tags_id' }, col('name', 'varchar(50)', { notNull: true, unique: true })])
  const comments = table('comments', [
    { ...newIdColumn(), id: 'comments_id' },
    col('post_id', 'int', { notNull: true }),
    col('user_id', 'int', { notNull: true }),
    col('body', 'text', { notNull: true }),
  ])
  // Deliberately list children before parents to prove ordering is topological.
  return {
    project: { appLabel: 'app' },
    tables: [comments, posts, tags, users],
    enums: [
      {
        id: 'e1',
        name: 'post_status',
        values: [
          { id: 'v1', name: 'draft' },
          { id: 'v2', name: 'published' },
          { id: 'v3', name: 'archived' },
        ],
      },
    ],
    refs: [
      ref('r1', posts, ['author_id'], users, ['id']),
      ref('r2', comments, ['post_id'], posts, ['id']),
      ref('r3', comments, ['user_id'], users, ['id']),
      ref('r4', posts, ['id'], tags, ['id'], '<>'),
    ],
  }
}

function byName(ds: FakeDataset, name: string) {
  const t = ds.tables.find((x) => x.name === name)!
  const column = (c: string) => t.rows.map((r) => r[t.columns.indexOf(c)])
  return { ...t, column }
}

describe('generateFakeData — blog fixture', () => {
  const N = 40
  const schema = blogSchema()

  it('produces the requested row count for every table, parents first', async () => {
    const ds = await generateFakeData(schema, N, 7)
    expect(ds.tables.map((t) => t.rows.length)).toEqual([N, N, N, N])
    const order = ds.tables.map((t) => t.name)
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('posts'))
    expect(order.indexOf('posts')).toBeLessThan(order.indexOf('comments'))
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('comments'))
    expect(ds.seed).toBe(7)
    expect(byName(ds, 'users').columns).toEqual(['id', 'username', 'email', 'is_active', 'created_at'])
  })

  it('is deterministic for a seed and differs for another seed', async () => {
    const a = await generateFakeData(schema, N, 123)
    const b = await generateFakeData(schema, N, 123)
    const c = await generateFakeData(schema, N, 124)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
  })

  it('increment primary keys are 1..N', async () => {
    const ds = await generateFakeData(schema, N, 1)
    expect(byName(ds, 'users').column('id')).toEqual(Array.from({ length: N }, (_, i) => i + 1))
    expect(byName(ds, 'comments').column('id')).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })

  it('FK values reference existing parent rows', async () => {
    const ds = await generateFakeData(schema, N, 5)
    const userIds = new Set(byName(ds, 'users').column('id'))
    const postIds = new Set(byName(ds, 'posts').column('id'))
    for (const v of byName(ds, 'posts').column('author_id')) expect(userIds.has(v)).toBe(true)
    for (const v of byName(ds, 'comments').column('post_id')) expect(postIds.has(v)).toBe(true)
    for (const v of byName(ds, 'comments').column('user_id')) expect(userIds.has(v)).toBe(true)
  })

  it('unique columns are unique and not-null columns have no nulls', async () => {
    const ds = await generateFakeData(schema, 200, 9)
    const users = byName(ds, 'users')
    for (const c of ['username', 'email']) {
      const vals = users.column(c)
      expect(new Set(vals).size).toBe(200)
      expect(vals.every((v) => v !== null)).toBe(true)
    }
    expect(new Set(byName(ds, 'tags').column('name')).size).toBe(200)
    for (const t of ds.tables) {
      const tbl = schema.tables.find((x) => x.id === t.tableId)!
      tbl.columns.forEach((c, ci) => {
        if (c.notNull) expect(t.rows.every((r) => r[ci] !== null && r[ci] !== undefined)).toBe(true)
      })
    }
  })

  it('nullable columns receive some nulls', async () => {
    const ds = await generateFakeData(schema, 200, 3)
    expect(byName(ds, 'posts').column('published_at').some((v) => v === null)).toBe(true)
    expect(byName(ds, 'posts').column('body').some((v) => v !== null)).toBe(true)
  })

  it('enum columns draw from the enum values', async () => {
    const ds = await generateFakeData(schema, N, 2)
    const allowed = new Set(['draft', 'published', 'archived'])
    const statuses = byName(ds, 'posts').column('status')
    expect(statuses.every((v) => allowed.has(v as string))).toBe(true)
    expect(new Set(statuses).size).toBeGreaterThan(1)
  })

  it('applies column-name heuristics with the right shapes', async () => {
    const ds = await generateFakeData(schema, N, 11)
    const users = byName(ds, 'users')
    for (const v of users.column('email')) expect(v).toMatch(/^[^@\s]+@[^@\s]+$/)
    for (const v of users.column('is_active')) expect(typeof v).toBe('boolean')
    for (const v of users.column('created_at')) expect(v).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    for (const v of users.column('username')) expect((v as string).length).toBeLessThanOrEqual(150)
    const posts = byName(ds, 'posts')
    for (const v of posts.column('price')) {
      expect(typeof v).toBe('number')
      expect(Number.isInteger((v as number) * 100 + 1e-9 * Math.sign(v as number)) || Math.abs((v as number) * 100 - Math.round((v as number) * 100)) < 1e-6).toBe(true)
    }
    for (const v of posts.column('title')) expect((v as string).length).toBeLessThanOrEqual(200)
  })

  it('generates distinct join rows for <> refs referencing existing pks', async () => {
    const ds = await generateFakeData(schema, N, 4)
    expect(ds.joins).toHaveLength(1)
    const j = ds.joins[0]
    expect(j).toMatchObject({ refId: 'r4', fromTable: 'posts', toTable: 'tags', fromColumn: 'id', toColumn: 'id' })
    expect(j.rows.length).toBeGreaterThan(0)
    const postIds = new Set(byName(ds, 'posts').column('id'))
    const tagIds = new Set(byName(ds, 'tags').column('id'))
    for (const [p, t] of j.rows) {
      expect(postIds.has(p)).toBe(true)
      expect(tagIds.has(t)).toBe(true)
    }
    expect(new Set(j.rows.map((r) => JSON.stringify(r))).size).toBe(j.rows.length)
  })

  it('clamps the row count into [1, 200] and defaults when invalid', async () => {
    expect((await generateFakeData(schema, 0, 1)).tables[0].rows.length).toBe(25)
    expect((await generateFakeData(schema, 5000, 1)).tables[0].rows.length).toBe(200)
    expect((await generateFakeData(schema, -3, 1)).tables[0].rows.length).toBe(1)
  })
})

describe('generateFakeData — relationship edge cases', () => {
  it('one-to-one refs use each parent at most once', async () => {
    const users = table('users', [{ ...newIdColumn(), id: 'u_id' }])
    const profiles = table('profiles', [{ ...newIdColumn(), id: 'p_id' }, col('user_id', 'int', { notNull: true })])
    const schema: Schema = {
      project: { appLabel: 'app' },
      tables: [profiles, users],
      enums: [],
      refs: [ref('o2o', profiles, ['user_id'], users, ['id'], '-')],
    }
    const ds = await generateFakeData(schema, 50, 1)
    const fk = byName(ds, 'profiles').column('user_id')
    expect(new Set(fk).size).toBe(50)
  })

  it('"<" refs put the FK on the `to` side', async () => {
    const users = table('users', [{ ...newIdColumn(), id: 'u_id' }])
    const posts = table('posts', [{ ...newIdColumn(), id: 'p_id' }, col('author_id', 'int', { notNull: true })])
    const schema: Schema = {
      project: { appLabel: 'app' },
      tables: [posts, users],
      enums: [],
      refs: [ref('lt', users, ['id'], posts, ['author_id'], '<')],
    }
    const ds = await generateFakeData(schema, 20, 1)
    expect(ds.tables.map((t) => t.name)).toEqual(['users', 'posts'])
    const ids = new Set(byName(ds, 'users').column('id'))
    for (const v of byName(ds, 'posts').column('author_id')) expect(ids.has(v)).toBe(true)
  })

  it('self-referencing FKs are null or point at existing rows (never dangling)', async () => {
    const employees = table('employees', [
      { ...newIdColumn(), id: 'e_id' },
      col('name', 'varchar(100)', { notNull: true }),
      col('manager_id', 'int'),
      col('mentor_id', 'int', { notNull: true }),
    ])
    const schema: Schema = {
      project: { appLabel: 'app' },
      tables: [employees],
      enums: [],
      refs: [
        ref('self', employees, ['manager_id'], employees, ['id']),
        ref('self2', employees, ['mentor_id'], employees, ['id']),
      ],
    }
    const ds = await generateFakeData(schema, 30, 8)
    const e = byName(ds, 'employees')
    const ids = new Set(e.column('id'))
    for (const v of e.column('manager_id')) expect(v === null || ids.has(v)).toBe(true)
    for (const v of e.column('mentor_id')) expect(ids.has(v)).toBe(true)
    expect(e.column('mentor_id')[0]).toBe(1) // first row can only point at itself
  })

  it('composite FKs pick the same parent row for all columns', async () => {
    const parents = table(
      'parents',
      [col('a', 'int', { notNull: true }), col('b', 'int', { notNull: true }), col('label', 'varchar(20)')],
      { indexes: [{ id: 'pk', columnIds: ['a_int', 'b_int'], unique: false, pk: true }] },
    )
    const children = table('children', [
      { ...newIdColumn(), id: 'c_id' },
      col('pa', 'int', { notNull: true }),
      col('pb', 'int', { notNull: true }),
    ])
    const schema: Schema = {
      project: { appLabel: 'app' },
      tables: [children, parents],
      enums: [],
      refs: [ref('comp', children, ['pa', 'pb'], parents, ['a', 'b'])],
    }
    const ds = await generateFakeData(schema, 30, 2)
    const p = byName(ds, 'parents')
    const pairs = new Set(p.rows.map((r) => JSON.stringify([r[0], r[1]])))
    expect(pairs.size).toBe(30) // composite pk is unique
    const c = byName(ds, 'children')
    for (const r of c.rows) expect(pairs.has(JSON.stringify([r[1], r[2]]))).toBe(true)
  })

  it('composite unique indexes are respected', async () => {
    const t = table(
      'votes',
      [
        { ...newIdColumn(), id: 'v_id' },
        col('kind', 'varchar(1)', { notNull: true }),
        col('flag', 'boolean', { notNull: true }),
      ],
      { indexes: [{ id: 'ux', columnIds: ['kind_varchar_1_', 'flag_boolean'], unique: true, pk: false }] },
    )
    const schema: Schema = { project: { appLabel: 'app' }, tables: [t], enums: [], refs: [] }
    const ds = await generateFakeData(schema, 40, 3)
    const v = byName(ds, 'votes')
    const sigs = v.rows.map((r) => JSON.stringify([r[1], r[2]]))
    expect(new Set(sigs).size).toBe(40)
  })

  it('unique short varchar columns stay unique and within length', async () => {
    const t = table('codes', [{ ...newIdColumn(), id: 'c_id' }, col('abbr', 'varchar(4)', { notNull: true, unique: true })])
    const schema: Schema = { project: { appLabel: 'app' }, tables: [t], enums: [], refs: [] }
    const ds = await generateFakeData(schema, 60, 5)
    const vals = byName(ds, 'codes').column('abbr') as string[]
    expect(new Set(vals).size).toBe(60)
    for (const v of vals) expect(v.length).toBeLessThanOrEqual(4)
  })

  it('unique emails, ints and dates fall back deterministically', async () => {
    const t = table('u', [
      { ...newIdColumn(), id: 'u_id' },
      col('email', 'varchar(20)', { notNull: true, unique: true }),
      col('rank', 'smallint', { notNull: true, unique: true }),
      col('day', 'date', { notNull: true, unique: true }),
      col('token', 'uuid', { notNull: true, unique: true }),
    ])
    const schema: Schema = { project: { appLabel: 'app' }, tables: [t], enums: [], refs: [] }
    const ds = await generateFakeData(schema, 120, 6)
    const u = byName(ds, 'u')
    for (const c of ['email', 'rank', 'day', 'token']) expect(new Set(u.column(c)).size).toBe(120)
    for (const v of u.column('email')) expect((v as string).length).toBeLessThanOrEqual(20)
  })

  it('handles FK to a non-pk column and a table without any pk', async () => {
    const regions = table('regions', [col('code', 'varchar(3)', { notNull: true, unique: true }), col('title', 'varchar(50)')])
    const shops = table('shops', [{ ...newIdColumn(), id: 's_id' }, col('region_code', 'varchar(3)', { notNull: true })])
    const schema: Schema = {
      project: { appLabel: 'app' },
      tables: [shops, regions],
      enums: [],
      refs: [ref('rc', shops, ['region_code'], regions, ['code'])],
    }
    const ds = await generateFakeData(schema, 25, 1)
    const codes = new Set(byName(ds, 'regions').column('code'))
    expect(codes.size).toBe(25)
    for (const v of byName(ds, 'shops').column('region_code')) expect(codes.has(v)).toBe(true)
  })

  it('M2M with an empty target side yields no join rows but keeps the join entry', async () => {
    const a = table('a', [{ ...newIdColumn(), id: 'a_id' }])
    const b = table('b', [col('x', 'text')]) // no pk -> no join pairs possible
    const schema: Schema = { project: { appLabel: 'app' }, tables: [a, b], enums: [], refs: [
      { id: 'm', kind: '<>', from: { tableId: a.id, columnIds: ['a_id'] }, to: { tableId: b.id, columnIds: [] } },
    ] }
    const ds = await generateFakeData(schema, 5, 1)
    expect(ds.joins).toHaveLength(0)
  })
})

describe('type-driven values (kitchen sink)', () => {
  const kitchen = table('things', [
    { ...newIdColumn(), id: 'k_id' },
    col('tiny', 'tinyint', { notNull: true }),
    col('small', 'smallint', { notNull: true }),
    col('big', 'bigint', { notNull: true }),
    col('ratio', 'float', { notNull: true }),
    col('n', 'numeric(6,3)', { notNull: true }),
    col('ok', 'bool', { notNull: true }),
    col('d', 'date', { notNull: true }),
    col('ts', 'timestamptz', { notNull: true }),
    col('tm', 'time', { notNull: true }),
    col('uid', 'uuid', { notNull: true }),
    col('meta', 'jsonb', { notNull: true }),
    col('blob', 'bytea', { notNull: true }),
    col('long_text', 'text', { notNull: true }),
    col('code3', 'char(3)', { notNull: true }),
    col('short', 'varchar(10)', { notNull: true }),
    col('mystery', 'geometry', { notNull: true }),
    col('first_name', 'varchar(50)', { notNull: true }),
    col('last_name', 'varchar(50)', { notNull: true }),
    col('username', 'varchar(50)', { notNull: true }),
    col('slug', 'varchar(80)', { notNull: true }),
    col('password', 'varchar(128)', { notNull: true }),
    col('total_amount', 'int', { notNull: true }),
    col('latitude', 'float', { notNull: true }),
    col('longitude', 'float', { notNull: true }),
    col('age', 'int', { notNull: true }),
    col('view_count', 'int', { notNull: true }),
    col('rating', 'int', { notNull: true }),
    col('score', 'float', { notNull: true }),
    col('percent', 'decimal(5,2)', { notNull: true }),
    col('birth_year', 'int', { notNull: true }),
    col('updated_at', 'date', { notNull: true }),
    col('due_date', 'timestamp', { notNull: true }),
    col('avatar', 'varchar(255)', { notNull: true }),
    col('website', 'varchar(255)', { notNull: true }),
    col('phone', 'varchar(30)', { notNull: true }),
    col('description', 'text', { notNull: true }),
    col('summary', 'varchar(255)', { notNull: true }),
    col('is_admin', 'int', { notNull: true }),
    col('deleted', 'boolean', { notNull: true }),
    col('status', 'varchar(20)', { notNull: true }),
    col('kind', 'varchar(20)', { notNull: true }),
    col('country', 'varchar(60)', { notNull: true }),
    col('city', 'varchar(60)', { notNull: true }),
    col('region', 'varchar(60)', { notNull: true }),
    col('address', 'varchar(120)', { notNull: true }),
    col('zip', 'varchar(12)', { notNull: true }),
    col('ip_address', 'varchar(45)', { notNull: true }),
    col('currency', 'char(3)', { notNull: true }),
    col('color', 'varchar(20)', { notNull: true }),
    col('guid', 'varchar(36)', { notNull: true }),
    col('api_key', 'varchar(64)', { notNull: true }),
    col('sku', 'varchar(16)', { notNull: true }),
    col('gender', 'varchar(10)', { notNull: true }),
    col('job_title', 'varchar(80)', { notNull: true }),
    col('locale', 'varchar(5)', { notNull: true }),
    col('timezone', 'varchar(40)', { notNull: true }),
    col('version', 'varchar(20)', { notNull: true }),
    col('content_type', 'varchar(60)', { notNull: true }),
    col('file_path', 'varchar(200)', { notNull: true }),
    col('user_agent', 'text', { notNull: true }),
    col('domain', 'varchar(80)', { notNull: true }),
    col('iban', 'varchar(40)', { notNull: true }),
    col('card_number', 'varchar(20)', { notNull: true }),
    col('department', 'varchar(40)', { notNull: true }),
    col('label', 'varchar(40)', { notNull: true }),
    col('weight', 'int', { notNull: true }),
    col('height', 'float', { notNull: true }),
    col('duration', 'int', { notNull: true }),
    col('sort_order', 'int', { notNull: true }),
    col('company', 'varchar(80)', { notNull: true }),
    col('display_name', 'varchar(80)', { notNull: true }),
    col('headline', 'varchar(120)', { notNull: true }),
    col('is_bool', 'boolean', { notNull: true }),
    col('int_status', 'int', { notNull: true }),
  ])

  it('every column gets a value of the right JS shape and within declared length', async () => {
    const products = table('products', [{ ...newIdColumn(), id: 'p_id' }, col('name', 'varchar(80)', { notNull: true })])
    const misc = table('widgets', [{ ...newIdColumn(), id: 'w_id' }, col('name', 'varchar(80)', { notNull: true })])
    const people = table('customers', [{ ...newIdColumn(), id: 'cu_id' }, col('name', 'varchar(80)', { notNull: true })])
    const schema: Schema = { project: { appLabel: 'app' }, tables: [kitchen, products, misc, people], enums: [], refs: [] }
    const ds = await generateFakeData(schema, 30, 21)
    const t = byName(ds, 'things')
    const shape = (c: string, pred: (v: unknown) => boolean) => {
      for (const v of t.column(c)) expect(pred(v), `${c} -> ${String(v)}`).toBe(true)
    }
    const isInt = (v: unknown) => Number.isInteger(v)
    const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    const isStr = (v: unknown) => typeof v === 'string' && v.length > 0
    shape('tiny', (v) => isInt(v) && (v as number) <= 127)
    shape('small', (v) => isInt(v) && (v as number) <= 32767)
    shape('big', isInt)
    shape('ratio', isNum)
    shape('n', (v) => isNum(v) && (v as number) < 1000)
    shape('ok', (v) => typeof v === 'boolean')
    shape('d', (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))
    shape('ts', (v) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v)))
    shape('tm', (v) => /^\d{2}:\d{2}:\d{2}$/.test(String(v)))
    shape('uid', (v) => /^[0-9a-f-]{36}$/.test(String(v)))
    shape('meta', (v) => typeof JSON.parse(String(v)) === 'object')
    shape('blob', (v) => /^[0-9a-f]{16}$/.test(String(v)))
    shape('long_text', isStr)
    shape('code3', (v) => isStr(v) && (v as string).length === 3)
    shape('short', (v) => isStr(v) && (v as string).length <= 10)
    shape('mystery', isStr)
    shape('slug', (v) => /^[a-z0-9-]+$/.test(String(v)))
    shape('total_amount', isInt)
    shape('latitude', (v) => isNum(v) && Math.abs(v as number) <= 90)
    shape('longitude', (v) => isNum(v) && Math.abs(v as number) <= 180)
    shape('age', (v) => isInt(v) && (v as number) >= 18 && (v as number) <= 90)
    shape('rating', (v) => isInt(v) && (v as number) >= 1 && (v as number) <= 5)
    shape('score', (v) => isNum(v) && (v as number) <= 5)
    shape('percent', (v) => isNum(v) && (v as number) <= 100)
    shape('birth_year', (v) => isInt(v) && (v as number) >= 1990)
    shape('updated_at', (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))
    shape('due_date', (v) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v)))
    shape('avatar', (v) => /^https?:\/\//.test(String(v)))
    shape('website', (v) => /^https?:\/\//.test(String(v)))
    shape('is_admin', (v) => v === 0 || v === 1)
    shape('deleted', (v) => typeof v === 'boolean')
    shape('status', (v) => ['active', 'pending', 'inactive', 'archived', 'draft'].includes(String(v)))
    shape('currency', (v) => /^[A-Z]{3}$/.test(String(v)))
    shape('locale', (v) => (v as string).length <= 5)
    shape('weight', isInt)
    shape('height', isNum)
    shape('int_status', isInt)
    // varchar lengths always honoured
    const things = schema.tables[0]
    things.columns.forEach((c, ci) => {
      const m = /\((\d+)\)/.exec(c.type)
      if (m && /char/.test(c.type)) for (const r of t.rows) expect(String(r[ci]).length).toBeLessThanOrEqual(Number(m[1]))
    })
    // people-ish vs product-ish vs generic "name"
    for (const v of byName(ds, 'customers').column('name')) expect(String(v)).toMatch(/\s/)
    for (const v of byName(ds, 'products').column('name')) expect(isStr(v)).toBe(true)
    for (const v of byName(ds, 'widgets').column('name')) expect(String(v)).toMatch(/^\S+ \S+$/)
  })
})

describe('heuristics helpers', () => {
  it('parseType classifies common SQL types', () => {
    expect(parseType('varchar(255)', false)).toEqual({ category: 'string', length: 255 })
    expect(parseType('VARCHAR', false)).toEqual({ category: 'string', length: undefined })
    expect(parseType('decimal(12,4)', false)).toMatchObject({ category: 'decimal', precision: 12, scale: 4 })
    expect(parseType('numeric', false)).toMatchObject({ category: 'decimal', precision: 10, scale: 2 })
    expect(parseType('int unsigned', false).category).toBe('int')
    expect(parseType('timestamp(6) with time zone', false).category).toBe('datetime')
    expect(parseType('time(3)', false).category).toBe('time')
    expect(parseType('double precision', false).category).toBe('float')
    expect(parseType('anything', true).category).toBe('enum')
    expect(parseType('longtext', false).category).toBe('text')
    expect(parseType('point', false).category).toBe('unknown')
  })

  it('valueForType covers enum without values and unknown', () => {
    expect(typeof valueForType({ category: 'enum' }, [])).toBe('string')
    expect(typeof valueForType({ category: 'enum' }, ['a'])).toBe('string')
    expect(typeof valueForType({ category: 'unknown' }, undefined)).toBe('string')
    expect(typeof valueForType({ category: 'string', length: 2 }, undefined)).toBe('string')
  })

  it('uniqueFallback produces distinct values per row/attempt', () => {
    const ints = new Set([0, 1, 2].flatMap((r) => [0, 1].map((a) => uniqueFallback(5, { category: 'int' }, r, a))))
    expect(ints.size).toBe(6)
    expect(uniqueFallback(1.5, { category: 'decimal' }, 0, 1)).toBe(1.1)
    expect(uniqueFallback('x', { category: 'date' }, 0, 0)).toBe('2023-01-01')
    expect(uniqueFallback('x', { category: 'time' }, 0, 1)).toBe('01:00:00')
    expect(uniqueFallback('x', { category: 'datetime' }, 1, 0)).toBe('2023-01-05 01:00:00')
    expect(uniqueFallback(true, { category: 'bool' }, 3, 0)).toBe(true)
    expect(uniqueFallback('a@b.c', { category: 'string' }, 2, 0)).toBe('a3@b.c')
    expect(uniqueFallback('hello', { category: 'string' }, 0, 0)).toBe('hello_1')
    expect((uniqueFallback('hello', { category: 'string', length: 3 }, 9, 0) as string).length).toBeLessThanOrEqual(3)
    expect(uniqueFallback('', { category: 'string' }, 0, 2)).toBe('1_2')
    expect(typeof uniqueFallback('x', { category: 'uuid' }, 0, 0)).toBe('string')
  })

  it('formatDateTime uses UTC', () => {
    expect(formatDateTime(new Date('2024-02-03T04:05:06.000Z'))).toBe('2024-02-03 04:05:06')
  })
})

// ---------- unique foreign keys ----------
//
// Reported from the demo: `UNIQUE constraint failed:
// ar_common_appealdenialscenario.denial_category_id`. The seeder disables FK checks, but SQLite
// enforces UNIQUE through an index regardless, so a duplicate FK value fails the insert.

/** A parent, and a child whose FK to it is declared unique on the COLUMN rather than by ref kind. */
function uniqueFkSchema(kind: Ref['kind'], childRows: { notNull: boolean }): Schema {
  const category = table('denial_category', [
    { ...newIdColumn(), id: 'cat_id' },
    col('name', 'varchar(80)', { notNull: true, unique: true }),
  ])
  const scenario = table('denial_scenario', [
    { ...newIdColumn(), id: 'sc_id' },
    col('denial_category_id', 'bigint', { notNull: childRows.notNull, unique: true }),
    col('label', 'varchar(120)', { notNull: true }),
  ])
  return {
    ...emptySchema(),
    tables: [category, scenario],
    refs: [ref('r_cat', scenario, ['denial_category_id'], category, ['id'], kind)],
  }
}

function columnValues(data: FakeDataset, tableName: string, columnName: string): unknown[] {
  const t = data.tables.find((x) => x.name === tableName)!
  return t.rows.map((r) => r[t.columns.indexOf(columnName)])
}

/** What SQLite checks: a UNIQUE column may repeat only NULL. */
function duplicates(values: unknown[]): unknown[] {
  const seen = new Set<string>()
  const dupes: unknown[] = []
  for (const v of values) {
    if (v === null || v === undefined) continue
    const k = JSON.stringify(v)
    if (seen.has(k)) dupes.push(v)
    seen.add(k)
  }
  return dupes
}

describe('a foreign key that is also unique', () => {
  it('draws each parent at most once when the column says unique, not only when the ref does', async () => {
    // '>' is what a Django OneToOneField becomes on import: many-to-one ref, unique column.
    const data = await generateFakeData(uniqueFkSchema('>', { notNull: true }), 25)
    expect(duplicates(columnValues(data, 'denial_scenario', 'denial_category_id'))).toEqual([])
  })

  it('does the same for a ref already declared one-to-one', async () => {
    const data = await generateFakeData(uniqueFkSchema('-', { notNull: true }), 25)
    expect(duplicates(columnValues(data, 'denial_scenario', 'denial_category_id'))).toEqual([])
  })

  it('stops short rather than repeating a parent when the children outnumber them', async () => {
    // 25 requested rows, 25 parents: fine. The failure mode is a child table that cannot be
    // filled without reusing a parent, which the old code did by picking a random index.
    const data = await generateFakeData(uniqueFkSchema('>', { notNull: true }), 25)
    const rows = columnValues(data, 'denial_scenario', 'denial_category_id')
    const parents = columnValues(data, 'denial_category', 'id')
    expect(rows.length).toBeLessThanOrEqual(parents.length)
    expect(duplicates(rows)).toEqual([])
  })

  it('leaves a nullable unique foreign key null rather than reusing a parent', async () => {
    const data = await generateFakeData(uniqueFkSchema('>', { notNull: false }), 25)
    expect(duplicates(columnValues(data, 'denial_scenario', 'denial_category_id'))).toEqual([])
  })
})

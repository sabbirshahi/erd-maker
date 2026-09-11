import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { parseDbml, generateDbml } from '@/core/dbml'
import { importSql, exportSql, normalizeForSql, detectDialect, cleanSql, splitStatements, sqliteDefault, sqliteType } from '@/core/sql'
import type { Schema } from '@/core/schema'
import { emptySchema, newColumn, newTable } from '@/core/schema'
import blog from '../fixtures/blog.dbml?raw'
import ecommerce from '../fixtures/ecommerce.dbml?raw'
import kitchenSink from '../fixtures/kitchen_sink.dbml?raw'
import ecommercePg from '../fixtures/sql/ecommerce.postgres.sql?raw'
import blogPgDump from '../fixtures/sql/blog.pgdump.sql?raw'
import blogMysql from '../fixtures/sql/blog.mysql.sql?raw'
import { canonical } from './dbml-helpers'

const fixtures: Record<string, string> = { blog, ecommerce, kitchen_sink: kitchenSink }

function parseOk(text: string): Schema {
  const r = parseDbml(text)
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return r.schema!
}

async function importOk(sql: string, dialect: Parameters<typeof importSql>[1]): Promise<Schema> {
  const r = await importSql(sql, dialect)
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(r.schema).toBeDefined()
  expect(r.dbml).toBeDefined()
  return r.schema!
}

/** What a fixture looks like once SQL had its say (no `-`/`<>` refs). */
const sqlView = (text: string): Schema => normalizeForSql(parseOk(text)).schema

describe('importSql', () => {
  it('imports sql/ecommerce.postgres.sql to the same Schema as ecommerce.dbml (ignoring ids)', async () => {
    const fromSql = await importOk(ecommercePg, 'postgres')
    expect(canonical(fromSql)).toEqual(canonical(parseOk(ecommerce)))
  })

  it('auto-detects the dialect and reports which one it used', async () => {
    const r = await importSql(ecommercePg, 'auto')
    expect(r.dialect).toBe('postgres')
    expect(r.schema).toBeDefined()
    expect((await importSql(blogMysql, 'auto')).dialect).toBe('mysql')
  })

  it('returns canonical DBML that our parser accepts and our generator reproduces byte-for-byte', async () => {
    const r = await importSql(ecommercePg, 'postgres')
    expect(r.dbml).toBe(generateDbml(r.schema!))
    const again = parseOk(r.dbml!)
    expect(generateDbml(again)).toBe(r.dbml)
    expect(r.dbml).not.toMatch(/Indexes \{/) // importer's capitalised block is normalised
  })

  it('survives a pg_dump-style dump: sequences, ALTER TABLE ONLY, OWNER/GRANT, psql meta-commands', async () => {
    const fromSql = await importOk(blogPgDump, 'auto')
    const expected = sqlView(blog)
    expect(fromSql.tables.map((t) => t.name).sort()).toEqual(expected.tables.map((t) => t.name).sort())
    const c = canonical(fromSql)
    const e = canonical(expected)
    // `id integer NOT NULL` + `nextval()` default is how pg_dump spells `increment`; the importer
    // keeps it as a plain int column, and `character varying(n)` is Postgres' spelling of varchar(n).
    const relax = (s: ReturnType<typeof canonical>) => ({
      ...s,
      tables: (s.tables as Record<string, unknown>[]).map((t) => ({
        ...t,
        columns: (t.columns as Record<string, unknown>[]).map((col) => ({
          ...col,
          increment: undefined,
          type: String(col.type).replace('character varying', 'varchar').replace(/^integer$/, 'int'),
        })),
        indexes: (t.indexes as Record<string, unknown>[]).map((i) => ({ ...i, name: undefined })),
      })),
    })
    expect(relax(c)).toEqual(relax(e))
    expect(fromSql.tables.find((t) => t.name === 'users')!.note).toBe('Registered users')
  })

  it('survives a mysqldump-style dump: conditional comments, ENGINE/CHARSET, LOCK/INSERT, inline ENUM', async () => {
    const fromSql = await importOk(blogMysql, 'mysql')
    const expected = sqlView(blog)
    expect(fromSql.tables.map((t) => t.name).sort()).toEqual(expected.tables.map((t) => t.name).sort())
    const posts = fromSql.tables.find((t) => t.name === 'posts')!
    const status = posts.columns.find((c) => c.name === 'status')!
    const en = fromSql.enums.find((e) => e.name === status.type)
    expect(en?.values.map((v) => v.name)).toEqual(['draft', 'published', 'archived'])
    expect(fromSql.refs).toHaveLength(expected.refs.length)
    const users = fromSql.tables.find((t) => t.name === 'users')!
    expect(users.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, increment: true })
    const username = users.columns.find((c) => c.name === 'username')!
    expect(username.notNull).toBe(true)
    // mysqldump spells `unique` as a `UNIQUE KEY` index; either representation is fine.
    expect(username.unique || users.indexes.some((i) => i.unique && i.columnIds.length === 1 && i.columnIds[0] === username.id)).toBe(true)
    expect(fromSql.tables.find((t) => t.name === 'posts')!.columns.find((c) => c.name === 'status')!.default).toBe("'draft'")
  })

  it('strips pg_dump casts from defaults', async () => {
    const r = await importSql("CREATE TABLE t (\n  a varchar DEFAULT 'x'::character varying,\n  b int DEFAULT nextval('t_b_seq'::regclass),\n  c text[] DEFAULT '{}'::text[]\n);", 'postgres')
    const cols = Object.fromEntries(r.schema!.tables[0].columns.map((c) => [c.name, c.default]))
    expect(cols.a).toBe("'x'")
    expect(cols.c).toBe("'{}'")
    expect(String(cols.b)).toMatch(/nextval\('t_b_seq'\)/)
  })

  it('rejects empty input and input without tables with a single error', async () => {
    const empty = await importSql('   \n', 'postgres')
    expect(empty.schema).toBeUndefined()
    expect(empty.diagnostics).toHaveLength(1)
    expect(empty.diagnostics[0]).toMatchObject({ severity: 'error', source: 'sql' })

    const noTables = await importSql('SET x = 1;\nCREATE EXTENSION foo;\n-- just noise\n', 'auto')
    expect(noTables.schema).toBeUndefined()
    expect(noTables.diagnostics[0].message).toMatch(/No CREATE TABLE/)
    expect(noTables.diagnostics[0].message).toMatch(/auto-detected/)
  })

  it('maps syntax errors to diagnostics with 1-based line/col instead of throwing', async () => {
    const r = await importSql('CREATE TABLE `x` (\n  id int,\n  bogus\n);', 'mysql')
    expect(r.schema).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', source: 'sql', line: 4, col: 1 })
    expect(r.diagnostics[0].message).toMatch(/^MySQL: /)

    const ms = await importSql('CREATE TABLE [x] (\n  id int,\n  bogus\n);', 'mssql')
    expect(ms.diagnostics[0]).toMatchObject({ severity: 'error', line: 4 })
    expect(ms.dialect).toBe('mssql')
  })

  it('reports importer crashes (no position) as a plain error', async () => {
    const r = await importSql('CREATE TABLE x (\n  id int,\n  bogus\n);', 'postgres')
    expect(r.schema).toBeUndefined()
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0].line).toBeUndefined()
    expect(r.diagnostics[0].message).toMatch(/PostgreSQL import failed/)
  })
})

describe('exportSql: postgres / mysql', () => {
  for (const [name, text] of Object.entries(fixtures)) {
    it(`${name}: postgres export re-imports to an equal Schema`, async () => {
      const schema = parseOk(text)
      const { text: ddl, diagnostics } = await exportSql(schema, 'postgres')
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(ddl).toMatch(/CREATE TABLE/)
      const back = await importOk(ddl, 'postgres')
      expect(canonical(back)).toEqual(canonical(normalizeForSql(schema).schema))
    })
  }

  it('expands many-to-many refs into a join table and says so', async () => {
    const schema = parseOk(blog)
    const { text, diagnostics } = await exportSql(schema, 'postgres')
    expect(text).toMatch(/CREATE TABLE "posts_tags"/)
    expect(text).toMatch(/PRIMARY KEY \("posts_id", "tags_id"\)/)
    const info = diagnostics.find((d) => d.message.includes('posts <> tags'))
    expect(info).toMatchObject({ severity: 'info', lossy: true, source: 'sql' })
    expect(info?.refId).toBe(schema.refs.find((r) => r.kind === '<>')!.id)
  })

  it('exports one-to-one as a FK on the from side and warns when that column is not unique', async () => {
    const ks = parseOk(kitchenSink)
    const unique = await exportSql(ks, 'postgres')
    expect(unique.text).toMatch(/ALTER TABLE "profiles" ADD FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\)/)
    expect(unique.diagnostics.filter((d) => d.message.includes('One-to-one'))).toEqual([])

    const profiles = ks.tables.find((t) => t.name === 'profiles')!
    profiles.columns.find((c) => c.name === 'user_id')!.unique = false
    const warned = await exportSql(ks, 'postgres')
    const w = warned.diagnostics.find((d) => d.message.includes('One-to-one'))
    expect(w).toMatchObject({ severity: 'warning', lossy: true, tableId: profiles.id })
  })

  it('mysql export produces MySQL DDL and flags Postgres-only types', async () => {
    const { text, diagnostics } = await exportSql(parseOk(kitchenSink), 'mysql')
    expect(text).toMatch(/CREATE TABLE `users`/)
    expect(text).toMatch(/AUTO_INCREMENT/)
    expect(text).toMatch(/ENUM \('pending', 'paid', 'on hold', 'cancelled'\)/)
    const types = diagnostics.filter((d) => d.message.includes('MySQL has no')).map((d) => d.message)
    expect(types.some((m) => m.includes('`timestamptz`'))).toBe(true)
    expect(types.some((m) => m.includes('`uuid`'))).toBe(true)
    expect(diagnostics.every((d) => d.severity !== 'error')).toBe(true)
    expect((await exportSql(parseOk(blog), 'mysql')).diagnostics.filter((d) => d.message.includes('MySQL has no'))).toEqual([])
  })

  it('leaves diagram-only blocks and positions out of the DDL', async () => {
    const { text } = await exportSql(parseOk(kitchenSink), 'postgres')
    expect(text).not.toMatch(/TableGroup|Project|release_notes|headercolor/i)
  })

  it('returns empty text for an empty schema and never throws on broken input', async () => {
    expect(await exportSql(emptySchema(), 'postgres')).toEqual({ text: '', diagnostics: [] })
    expect((await exportSql(emptySchema(), 'mysql')).text).toBe('')
    expect((await exportSql(emptySchema(), 'sqlite')).text).toMatch(/PRAGMA foreign_keys = ON/)
    const s = emptySchema()
    s.tables.push(newTable({ name: 't', columns: [] })) // DBML rejects an empty table
    const r = await exportSql(s, 'postgres')
    expect(r.text).toBe('')
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', source: 'sql' })
    expect(r.diagnostics[0].line).toBeUndefined()
  })
})

describe('exportSql: sqlite', () => {
  for (const [name, text] of Object.entries(fixtures)) {
    it(`${name}: contains no serial / CREATE TYPE / ALTER TABLE and executes in SQLite`, async () => {
      const schema = parseOk(text)
      const { text: ddl, diagnostics } = await exportSql(schema, 'sqlite')
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(ddl).not.toMatch(/serial/i)
      expect(ddl).not.toMatch(/CREATE TYPE/i)
      expect(ddl).not.toMatch(/ALTER TABLE/i)
      expect(ddl).not.toMatch(/DEFERRABLE|USING BTREE|COMMENT ON/i)

      const db = new DatabaseSync(':memory:')
      try {
        db.exec(ddl)
        const expected = normalizeForSql(schema).schema
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
        expect(tables.map((t) => t.name).sort()).toEqual(
          expected.tables.map((t) => (t.schema ? `${t.schema}_${t.name}` : t.name)).sort(),
        )
        const fkCount = tables.reduce((n, t) => n + (db.prepare(`PRAGMA foreign_key_list("${t.name.replace(/"/g, '""')}")`).all() as unknown[]).length, 0)
        const expectedFkColumns = expected.refs.reduce((n, r) => n + r.from.columnIds.length, 0)
        expect(fkCount).toBe(expectedFkColumns)
      } finally {
        db.close()
      }
    })
  }

  it('rewrites types, inlines enums as CHECK constraints and flattens schemas', async () => {
    const { text, diagnostics } = await exportSql(parseOk(kitchenSink), 'sqlite')
    expect(text).toMatch(/"id" INTEGER PRIMARY KEY AUTOINCREMENT/)
    expect(text).toMatch(/"created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP/)
    expect(text).toMatch(/"is_active" INTEGER NOT NULL DEFAULT 1/)
    expect(text).toMatch(/"balance" NUMERIC NOT NULL DEFAULT 0/)
    expect(text).toMatch(/"status" TEXT NOT NULL DEFAULT 'pending' CHECK \("status" IN \('pending', 'paid', 'on hold', 'cancelled'\)\)/)
    expect(text).toMatch(/"role" TEXT NOT NULL DEFAULT 'member' CHECK \("role" IN \('admin', 'member'\)\)/)
    expect(text).toMatch(/CREATE TABLE "auth_sessions"/)
    expect(text).toMatch(/PRIMARY KEY \("order_id", "line_no"\)/)
    expect(text).toMatch(/CONSTRAINT "fk_orders_user" FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/)
    expect(text).toMatch(/FOREIGN KEY \("order_id", "line_no"\) REFERENCES "order_lines" \("order_id", "line_no"\) ON DELETE CASCADE ON UPDATE NO ACTION/)
    expect(text).toMatch(/CREATE INDEX "sessions_user_expiry" ON "auth_sessions" \("user_id", "expires_at"\)/)
    expect(text).toMatch(/CREATE INDEX "orders_status_idx" ON "orders" \("status"\)/)
    expect(text).toMatch(/UNIQUE \("user_id", "placed_at"\)/)
    expect(text).toMatch(/-- People who can log in\nCREATE TABLE "users"/)
    expect(text).toMatch(/  -- Login identifier\n  "email" TEXT NOT NULL UNIQUE/)
    expect(text).toMatch(/-- Multi-line\n  -- bio with 'quotes'/)
    const flat = diagnostics.find((d) => d.message.includes('SQLite has no schemas'))
    expect(flat).toMatchObject({ severity: 'info', lossy: true })
  })

  it('warns when increment cannot be honoured', async () => {
    const s = emptySchema()
    s.tables.push(
      newTable({
        name: 't',
        columns: [newColumn({ name: 'id', type: 'uuid', pk: true, increment: true }), newColumn({ name: 'n', type: 'int', increment: true })],
      }),
    )
    const { text, diagnostics } = await exportSql(s, 'sqlite')
    expect(text).toMatch(/"id" INTEGER PRIMARY KEY AUTOINCREMENT/)
    expect(text).toMatch(/"n" INTEGER\b/)
    expect(diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('requires INTEGER'), expect.stringContaining('`increment` was dropped')])
  })

  it('maps defaults and types', () => {
    expect(sqliteDefault('`now()`', 'timestamp')).toBe('CURRENT_TIMESTAMP')
    expect(sqliteDefault('`CURRENT_DATE`', 'date')).toBe('CURRENT_DATE')
    expect(sqliteDefault('`curtime()`', 'time')).toBe('CURRENT_TIME')
    expect(sqliteDefault('`gen_random_uuid()`', 'uuid')).toMatch(/^\(lower\(hex\(randomblob/)
    expect(sqliteDefault('`1 + 2`', 'int')).toBe('(1 + 2)')
    expect(sqliteDefault("'it\\'s'", 'text')).toBe("'it''s'")
    expect(sqliteDefault('"x"', 'text')).toBe("'x'")
    expect(sqliteDefault('null', 'int')).toBeUndefined()
    expect(sqliteDefault('', 'int')).toBeUndefined()
    expect(sqliteDefault('true', 'boolean')).toBe('1')
    expect(sqliteDefault('FALSE', 'boolean')).toBe('0')
    expect(sqliteDefault('1', 'boolean')).toBe('1')
    expect(sqliteDefault('0', 'bool')).toBe('0')
    expect(sqliteDefault('1.5e3', 'float')).toBe('1.5e3')
    expect(sqliteDefault('abc', 'text')).toBe('(abc)')

    expect(sqliteType('varchar(255)', false)).toBe('TEXT')
    expect(sqliteType('DECIMAL(10,2)', false)).toBe('NUMERIC')
    expect(sqliteType('double precision', false)).toBe('REAL')
    expect(sqliteType('int[]', false)).toBe('TEXT')
    expect(sqliteType('bytea', false)).toBe('BLOB')
    expect(sqliteType('geometry', false)).toBe('geometry')
    expect(sqliteType('order_status', true)).toBe('TEXT')
  })
})

describe('normalizeForSql', () => {
  it('leaves plain schemas alone and copies FK actions onto both join-table refs', () => {
    const ecom = parseOk(ecommerce)
    const same = normalizeForSql(ecom)
    expect(same.diagnostics).toEqual([])
    expect(canonical(same.schema)).toEqual(canonical(ecom))

    const s = parseOk('Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n}\nTable a_b {\n  x int\n}\nRef: a.id <> b.id [delete: cascade]\n')
    const { schema } = normalizeForSql(s)
    const join = schema.tables.find((t) => t.name === 'a_b_2')!
    expect(join.columns.map((c) => c.name)).toEqual(['a_id', 'b_id'])
    expect(join.indexes[0]).toMatchObject({ pk: true })
    const joinRefs = schema.refs.filter((r) => r.from.tableId === join.id)
    expect(joinRefs).toHaveLength(2)
    expect(joinRefs.every((r) => r.kind === '>' && r.onDelete === 'cascade' && !('onUpdate' in r))).toBe(true)
  })

  it('names self-referencing join columns distinctly and copies serial types as int', () => {
    // DBML itself rejects `users.id <> users.id`, but the canvas can build it.
    const s = parseOk('Table users {\n  id serial [pk]\n}\n')
    const users = s.tables[0]
    s.refs.push({ id: 'self', kind: '<>', from: { tableId: users.id, columnIds: [users.columns[0].id] }, to: { tableId: users.id, columnIds: [users.columns[0].id] } })
    const { schema } = normalizeForSql(s)
    const join = schema.tables.find((t) => t.name === 'users_users')!
    expect(join.columns.map((c) => c.name)).toEqual(['users_id', 'users_2_id'])
    expect(join.columns.map((c) => c.type)).toEqual(['int', 'int'])
  })
})

describe('cleanSql / detectDialect', () => {
  it('detects dialects from vendor hints', () => {
    expect(detectDialect('CREATE TABLE `a` (`id` int AUTO_INCREMENT) ENGINE=InnoDB;')).toBe('mysql')
    expect(detectDialect('CREATE TABLE [dbo].[a] ([id] int IDENTITY(1,1), [n] NVARCHAR(50));\nGO\n')).toBe('mssql')
    expect(detectDialect('CREATE TABLE a (id serial, j jsonb);')).toBe('postgres')
    expect(detectDialect('CREATE TABLE a (id int);')).toBe('postgres')
  })

  it('splits statements on ; outside quotes, comments and brackets', () => {
    const sql = "INSERT INTO t VALUES ('a;b', \"c;d\", `e;f`); -- x;y\nCREATE TABLE [x;y] (a int); /* p;q */ SELECT 'it''s;';"
    const parts = splitStatements(sql)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe("INSERT INTO t VALUES ('a;b', \"c;d\", `e;f`);")
    expect(parts[1]).toBe(' -- x;y\nCREATE TABLE [x;y] (a int);')
    expect(parts[2]).toBe(" /* p;q */ SELECT 'it''s;';")
    expect(splitStatements("SELECT 'a\\'b;c'")).toEqual(["SELECT 'a\\'b;c'"])
    expect(splitStatements('/* unterminated')).toEqual(['/* unterminated'])
  })

  it('blanks noise statements while keeping line numbers stable', () => {
    const cleaned = cleanSql(ecommercePg, 'postgres')
    expect(cleaned.split('\n')).toHaveLength(ecommercePg.split('\n').length)
    expect(cleaned).not.toMatch(/CREATE EXTENSION|SET statement_timeout|OWNER TO|COMMENT ON EXTENSION|pg_catalog/)
    expect(cleaned).toMatch(/COMMENT ON TABLE "orders"/)
    expect(cleaned).toMatch(/CREATE TYPE "products_status"/)
    const pgIdx = cleanSql(blogPgDump, 'postgres')
    expect(pgIdx).not.toMatch(/\\restrict|\\connect|CREATE SEQUENCE|ALTER SEQUENCE|GRANT|REVOKE|nextval/)
    expect(pgIdx).toMatch(/ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey/)
  })

  it('handles MySQL conditional comments/DELIMITER and MSSQL GO/IDENTITY(seed, step)', () => {
    const my = cleanSql('/*!40101 SET NAMES utf8 */;\nDELIMITER ;;\nCREATE TABLE `a` (`id` int);\r\n', 'mysql')
    expect(my).toBe('\n\nCREATE TABLE `a` (`id` int);\n')
    const ms = cleanSql('CREATE TABLE [a] ([id] int IDENTITY(1,1));\nGO\nGO 2\n', 'mssql')
    expect(ms).toBe('CREATE TABLE [a] ([id] int IDENTITY);\n\n\n')
  })
})

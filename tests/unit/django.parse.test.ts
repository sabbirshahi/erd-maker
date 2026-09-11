import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateDjango, parseDjango } from '@/core/django'
import { findEnumForType } from '@/core/django/generate'
import { mapDbmlType, mapDjangoField } from '@/core/django/typemap'
import { parseDbml } from '@/core/dbml'
import { fkSide, primaryKeyColumnIds, type Ref, type Schema, type Table } from '@/core/schema'
import { FIXTURES } from './django.fixtures'
import { initDjangoParserForTests } from './django.testInit'

const dbmlFixtures = import.meta.glob<string>('../fixtures/*.dbml', { query: '?raw', import: 'default', eager: true })

beforeAll(() => initDjangoParserForTests())

/**
 * Id-free, order-free view of a schema restricted to what Django can express (plan §2):
 * schema qualifiers, aliases, colours, index types/notes, enum value notes, on_update, non-M2M ref
 * names and `delete: cascade` (D15) are dropped; types are normalised through the type map.
 */
function canon(s: Schema, dropRefIds: Set<string> = new Set()) {
  const tableById = new Map(s.tables.map((t) => [t.id, t]))
  const colName = (t: Table, id: string) => t.columns.find((c) => c.id === id)?.name ?? `?${id}`
  const canonType = (type: string) => {
    const e = findEnumForType(s, type)
    if (e) return e.name
    const m = mapDbmlType(type, s.tables[0]?.columns[0] ?? ({} as never))
    return m.unknown ? 'text' : mapDjangoField(m.field, m.kwargs).type
  }
  const tables = [...s.tables]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const pkIds = new Set(primaryKeyColumnIds(t))
      return {
        name: t.name,
        note: t.note,
        django: t.django,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: canonType(c.type),
          pk: c.pk,
          unique: c.unique,
          notNull: c.notNull || pkIds.has(c.id),
          increment: c.increment,
          default: c.default === 'null' ? undefined : c.default,
          note: c.note,
          django: c.django,
        })),
        indexes: t.indexes
          .map((i) => ({ columns: i.columnIds.map((id) => colName(t, id)), unique: i.unique, pk: i.pk, name: i.name }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      }
    })
  const refs = s.refs
    .filter((r) => !dropRefIds.has(r.id))
    .map((r: Ref) => {
      const { fk, target } = r.kind === '<>' ? { fk: r.from, target: r.to } : fkSide(r)
      const ft = tableById.get(fk.tableId)!
      const tt = tableById.get(target.tableId)!
      return {
        kind: r.kind === '<' ? '>' : r.kind,
        from: [ft.name, ...fk.columnIds.map((id) => colName(ft, id))],
        to: [tt.name, ...target.columnIds.map((id) => colName(tt, id))],
        onDelete: r.onDelete === 'cascade' ? undefined : r.onDelete,
        name: r.kind === '<>' ? r.name : undefined,
        django: r.django,
      }
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const enums = [...s.enums]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, note: e.note, values: e.values.map((v) => v.name) }))
  return JSON.parse(JSON.stringify({ tables, refs, enums }))
}

async function roundTrip(s: Schema) {
  const gen = generateDjango(s)
  const dropped = new Set(gen.diagnostics.filter((d) => d.severity === 'error' && d.refId).map((d) => d.refId!))
  const parsed = await parseDjango(gen.text)
  expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(parsed.schema).toBeDefined()
  expect(canon(parsed.schema!)).toEqual(canon(s, dropped))
  // Generation is idempotent across the round trip.
  expect(generateDjango(parsed.schema!).text).toBe(gen.text)
  return parsed
}

describe('parseDjango round trips', () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    it(`parse(generate(${name})) deep-equals the IR fixture`, async () => {
      await roundTrip(make())
    })
  }
  for (const [path, dbml] of Object.entries(dbmlFixtures)) {
    const name = path.split('/').pop()!.replace(/\.dbml$/, '')
    it(`parse(generate(parseDbml(${name}))) deep-equals the DBML fixture`, async ({ skip }) => {
      const parsed = parseDbml(dbml)
      if (!parsed.schema) skip()
      await roundTrip(parsed.schema!)
    })
  }

  it('parses the golden files on disk', async () => {
    for (const name of Object.keys(FIXTURES)) {
      const text = readFileSync(`tests/golden/ir/${name}.py`, 'utf8')
      const { schema, diagnostics } = await parseDjango(text)
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(schema!.tables.length).toBe(FIXTURES[name]().tables.length)
    }
  })
})

const SIX_MODELS = `
from django.db import models
from django.utils import timezone
import uuid


class PublishedManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(status='published')


class Status(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    PUBLISHED = 'published', 'Published'


class Author(models.Model):
    """Writers"""
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    joined = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'authors'
        ordering = ['name']

    def __str__(self):
        return self.name

    @property
    def initials(self):
        return ''.join(w[0] for w in self.name.split())


class Post(models.Model):
    uid = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(Author, on_delete=models.PROTECT, related_name='posts')
    editor = models.ForeignKey('Author', null=True, blank=True, on_delete=models.SET_NULL, db_column='editor_ref')
    status = models.CharField(max_length=9, choices=Status.choices, default=Status.DRAFT)
    title = models.CharField('Headline', max_length=200, db_index=True)
    body = models.TextField(blank=True)
    tags = models.ManyToManyField('Tag', related_name='posts', blank=True)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True)

    objects = models.Manager()
    published = PublishedManager()

    class Meta:
        db_table = 'posts'
        indexes = [models.Index(fields=['-status', 'title'], name='post_status_title')]
        constraints = [models.UniqueConstraint(fields=['author', 'title'], name='unique_author_title')]
        verbose_name = 'blog post'


class Tag(models.Model):
    label = models.SlugField(unique=True)


class Comment(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE)
    body = models.TextField()
    created = models.DateTimeField(auto_now_add=True)
    rating = models.PositiveSmallIntegerField(default=3, help_text="1-5")

    class Meta:
        unique_together = (('post', 'created'),)
        index_together = ['post', 'rating']


class Profile(models.Model):
    author = models.OneToOneField(Author, on_delete=models.CASCADE, primary_key=True)
    bio = models.TextField(null=True)


class Reaction(models.Model):
    pk = models.CompositePrimaryKey('comment', 'kind')
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE)
    kind = models.CharField(max_length=10)
    count = models.IntegerField(default=0)
`

describe('parseDjango on hand-written models.py', () => {
  it('parses a 6-model file with a method and a custom manager, keeping both as passthrough', async () => {
    const { schema, diagnostics } = await parseDjango(SIX_MODELS)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const s = schema!
    expect(s.tables.map((t) => t.name)).toEqual(['authors', 'posts', 'tags', 'comments', 'profiles', 'reactions'])
    expect(s.enums).toEqual([expect.objectContaining({ name: 'status', values: [expect.objectContaining({ name: 'draft' }), expect.objectContaining({ name: 'published' })] })])

    const author = s.tables[0]
    expect(author.note).toBe('Writers')
    expect(author.columns.map((c) => c.name)).toEqual(['id', 'name', 'email', 'joined'])
    expect(author.columns[0]).toMatchObject({ pk: true, increment: true, type: 'int', notNull: true })
    expect(author.columns[2]).toMatchObject({ type: 'varchar(254)', unique: true, notNull: true, django: { fieldType: 'EmailField' } })
    expect(author.columns[3].django?.extraKwargs).toEqual({ default: 'timezone.now' })
    expect(author.django?.ordering).toEqual(['name'])
    expect(author.django?.passthrough).toEqual([
      'def __str__(self):\n    return self.name',
      "@property\ndef initials(self):\n    return ''.join(w[0] for w in self.name.split())",
    ])

    const post = s.tables[1]
    expect(post.columns.map((c) => c.name)).toEqual(['uid', 'author_id', 'editor_ref', 'status', 'title', 'body', 'parent_id'])
    expect(post.columns[0]).toMatchObject({ type: 'uuid', pk: true, increment: false, notNull: true, django: { extraKwargs: { default: 'uuid.uuid4', editable: 'False' } } })
    expect(post.columns[1]).toMatchObject({ type: 'int', notNull: true, django: { relatedName: 'posts' } })
    expect(post.columns[2]).toMatchObject({ type: 'int', notNull: false })
    expect(post.columns[3]).toMatchObject({ type: 'status', default: "'draft'" })
    expect(post.columns[4].django).toEqual({ verboseName: 'Headline' })
    expect(post.columns[5].django).toEqual({ blank: true })
    expect(post.django).toMatchObject({ verboseName: 'blog post', passthrough: ['objects = models.Manager()', 'published = PublishedManager()'] })
    const idxNames = post.indexes.map((i) => ({ cols: i.columnIds.map((id) => post.columns.find((c) => c.id === id)!.name), unique: i.unique, name: i.name }))
    expect(idxNames).toEqual([
      { cols: ['title'], unique: false, name: undefined },
      { cols: ['status', 'title'], unique: false, name: 'post_status_title' },
      { cols: ['author_id', 'title'], unique: true, name: 'unique_author_title' },
    ])

    const tag = s.tables[2]
    expect(tag.columns[1]).toMatchObject({ type: 'varchar(50)', django: { fieldType: 'SlugField' } })

    const comment = s.tables[3]
    expect(comment.columns.find((c) => c.name === 'created')).toMatchObject({ default: '`now()`', type: 'timestamp' })
    expect(comment.columns.find((c) => c.name === 'rating')).toMatchObject({ type: 'smallint', default: '3', note: '1-5', django: { fieldType: 'PositiveSmallIntegerField' } })
    expect(comment.indexes.map((i) => [i.unique, i.columnIds.length])).toEqual([[true, 2], [false, 2]])

    const profile = s.tables[4]
    expect(profile.columns.map((c) => c.name)).toEqual(['author_id', 'bio'])
    expect(profile.columns[0]).toMatchObject({ pk: true, increment: false, type: 'int' })
    expect(profile.columns[1].django).toEqual({ blank: false })

    const reaction = s.tables[5]
    expect(reaction.indexes).toEqual([expect.objectContaining({ pk: true, columnIds: [reaction.columns[0].id, reaction.columns[1].id] })])
    expect(reaction.columns.some((c) => c.pk)).toBe(false)

    const refDesc = s.refs.map((r) => {
      const from = s.tables.find((t) => t.id === r.from.tableId)!
      const to = s.tables.find((t) => t.id === r.to.tableId)!
      return [r.kind, `${from.name}.${r.from.columnIds.map((id) => from.columns.find((c) => c.id === id)!.name)}`, `${to.name}.${r.to.columnIds.map((id) => to.columns.find((c) => c.id === id)!.name)}`, r.onDelete]
    })
    expect(refDesc).toEqual([
      ['>', 'posts.author_id', 'authors.id', 'restrict'],
      ['>', 'posts.editor_ref', 'authors.id', 'set null'],
      ['>', 'posts.parent_id', 'posts.uid', undefined],
      ['>', 'comments.post_id', 'posts.uid', undefined],
      ['-', 'profiles.author_id', 'authors.id', undefined],
      ['>', 'reactions.comment_id', 'comments.id', undefined],
      ['<>', 'posts.uid', 'tags.id', undefined],
    ])
    expect(s.refs.find((r) => r.kind === '<>')!.django).toEqual({ relatedName: 'posts' })
    expect(comment.columns.find((c) => c.name === 'post_id')!.type).toBe('uuid')

    // Non-model top-level code is reported, not silently dropped.
    expect(diagnostics.map((d) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('from django.utils import timezone'),
        expect.stringContaining('import uuid'),
        expect.stringContaining('class PublishedManager is not a Django model'),
      ]),
    )

    // Regenerating re-emits the method and the managers.
    const { text } = generateDjango(s)
    expect(text).toContain('    def __str__(self):\n        return self.name')
    expect(text).toContain('    published = PublishedManager()')
    expect(text).toContain("    title = models.CharField(max_length=200, verbose_name='Headline')")
    expect(text).toContain("    editor = models.ForeignKey('Author', on_delete=models.SET_NULL, db_column='editor_ref', null=True, blank=True)")
    expect(text).toContain('    joined = models.DateTimeField(default=timezone.now)')
    const again = await parseDjango(text)
    expect(canon(again.schema!)).toEqual(canon(s))
  })

  it('returns no schema and a positioned diagnostic on a Python syntax error', async () => {
    const { schema, diagnostics } = await parseDjango('from django.db import models\n\nclass X(models.Model:\n    a = models.IntegerField()\n')
    expect(schema).toBeUndefined()
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].message).toMatch(/Python syntax error/)
    expect(diagnostics[0].line).toBe(3)
    expect(diagnostics[0].col).toBeGreaterThan(0)
  })

  it('reports a missing token as a syntax error', async () => {
    const { schema, diagnostics } = await parseDjango('class X(models.Model):\n    a = models.IntegerField(\n')
    expect(schema).toBeUndefined()
    expect(diagnostics.every((d) => d.severity === 'error')).toBe(true)
  })

  it('never throws, even on garbage input', async () => {
    const r = await parseDjango(undefined as unknown as string)
    expect(r.schema).toBeUndefined()
    expect(r.diagnostics[0].severity).toBe('error')
    const empty = await parseDjango('')
    expect(empty.schema).toEqual({ project: { appLabel: 'app' }, tables: [], refs: [], enums: [] })
  })

  it('adds the implicit id back, derives table names, and records custom class names (D14/D13)', async () => {
    const { schema } = await parseDjango('from django.db import models\nclass OrderItem(models.Model):\n    qty = models.IntegerField()\n\nclass Weird(models.Model):\n    class Meta:\n        db_table = "custom_table"\n')
    expect(schema!.tables[0].name).toBe('order_items')
    expect(schema!.tables[0].django).toBeUndefined()
    expect(schema!.tables[0].columns[0]).toMatchObject({ name: 'id', pk: true, increment: true })
    expect(schema!.tables[1]).toMatchObject({ name: 'custom_table', django: { className: 'Weird' } })
    expect(generateDjango(schema!).text).toContain('class Weird(models.Model):')
  })

  it('handles abstract bases, model subclasses, IntegerChoices, and non-django statements', async () => {
    const src = `
from django.db import models

def helper():
    return 1

class Base(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    class Meta:
        abstract = True

class Level(models.IntegerChoices):
    LOW = 1, 'Low'
    HIGH = 2

class Thing(Base):
    level = models.IntegerField(choices=Level.choices, default=Level.HIGH)
    class Meta:
        db_table = 'things'
        managed = False
        constraints = [models.CheckConstraint(check=models.Q(level__gt=0), name='pos')]
        def broken(self):
            pass
`
    const { schema, diagnostics } = await parseDjango(src)
    expect(schema!.tables.map((t) => t.name)).toEqual(['things'])
    expect(schema!.enums[0]).toMatchObject({ name: 'level', values: [expect.objectContaining({ name: '1' }), expect.objectContaining({ name: '2' })] })
    expect(schema!.tables[0].columns[1]).toMatchObject({ type: 'level', default: "'2'" })
    const msgs = diagnostics.map((d) => d.message)
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Top-level function definition'),
        expect.stringContaining('Abstract model Base'),
        expect.stringContaining('Meta.managed is not preserved'),
        expect.stringContaining('only Index and UniqueConstraint'),
        expect.stringContaining('Unsupported statement in class Meta'),
      ]),
    )
  })

  it('keeps unknown fields, kwargs, on_delete callables and inline choices verbatim', async () => {
    const src = `
class Geo(models.Model):
    shape = models.GeometryField(srid=4326)
    kind = models.CharField(max_length=2, choices=[('a', 'A'), ('b', 'B')])
    owner = models.ForeignKey('Owner', on_delete=models.SET(get_default), to_field='code')
    boss = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    friends = models.ManyToManyField('Missing')
    nothing = models.ManyToManyField()
    label = models.CharField(max_length=5, default=None, db_comment='c')

class Owner(models.Model):
    code = models.CharField(max_length=3, unique=True)
`
    const { schema, diagnostics } = await parseDjango(src)
    const geo = schema!.tables[0]
    const byName = (n: string) => geo.columns.find((c) => c.name === n)!
    expect(byName('shape')).toMatchObject({ type: 'text', django: { fieldType: 'GeometryField', extraKwargs: { srid: '4326' } } })
    expect(byName('kind').django?.extraKwargs).toEqual({ choices: "[('a', 'A'), ('b', 'B')]" })
    expect(byName('owner_id').django?.extraKwargs).toEqual({ on_delete: 'models.SET(get_default)' })
    expect(byName('owner_id').type).toBe('varchar(3)')
    expect(byName('boss_id')).toMatchObject({ type: 'int' })
    expect(byName('label').default).toBeUndefined()
    expect(byName('label').django).toEqual({ extraKwargs: { db_comment: "'c'" } })
    expect(schema!.refs).toHaveLength(1)
    const msgs = diagnostics.map((d) => d.message)
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Unknown Django field GeometryField'),
        expect.stringContaining('settings.AUTH_USER_MODEL'),
        expect.stringContaining('many-to-many target Missing'),
        expect.stringContaining('Relation field without a target model'),
      ]),
    )
    const { text } = generateDjango(schema!)
    expect(text).toContain('    shape = models.GeometryField(srid=4326)')
    expect(text).toContain("    owner = models.ForeignKey('Owner', on_delete=models.SET(get_default), db_column='owner_id', to_field='code')")
    expect(text).toContain("    kind = models.CharField(max_length=2, choices=[('a', 'A'), ('b', 'B')])")
  })

  it('warns on unresolvable targets, to_field and index fields, and FKs to composite keys', async () => {
    const src = `
class A(models.Model):
    pk = models.CompositePrimaryKey('x', 'y')
    x = models.IntegerField()
    y = models.IntegerField()

class B(models.Model):
    a = models.ForeignKey(A, on_delete=models.CASCADE)
    c = models.ForeignKey('Zed', on_delete=models.CASCADE)
    a2 = models.ForeignKey(A, on_delete=models.CASCADE, to_field='nope')

    class Meta:
        indexes = [models.Index(fields=['ghost'])]
`
    const { schema, diagnostics } = await parseDjango(src)
    expect(schema!.refs).toEqual([])
    expect(schema!.tables[1].indexes).toEqual([])
    const msgs = diagnostics.map((d) => d.message)
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('composite primary key'),
        expect.stringContaining('model Zed, which is not defined'),
        expect.stringContaining("to_field 'nope'"),
        expect.stringContaining('unknown field `ghost`'),
      ]),
    )
  })

  it('reads docstrings, enum notes, multi-line strings and single-string unique_together', async () => {
    const src = `
class Kind(models.TextChoices):
    """What kind"""
    A = 'a'

class T(models.Model):
    """
    Multi
    line
    """
    k = models.CharField(max_length=1, choices=Kind.choices)
    n = models.CharField(max_length=1, db_column="n col")
    class Meta:
        unique_together = ('k', 'n')
`
    const { schema } = await parseDjango(src)
    expect(schema!.enums[0].note).toBe('What kind')
    expect(schema!.tables[0].note).toBe('Multi\nline')
    expect(schema!.tables[0].columns.map((c) => c.name)).toEqual(['id', 'k', 'n col'])
    expect(schema!.tables[0].indexes).toEqual([expect.objectContaining({ unique: true, columnIds: [schema!.tables[0].columns[1].id, schema!.tables[0].columns[2].id] })])
    const { text } = generateDjango(schema!)
    expect(text).toContain("    n = models.CharField(max_length=1, db_column='n col')")
    expect(text).toContain("            models.UniqueConstraint(fields=['k', 'n'], name='ts_k_n col_uniq'),")
  })
})

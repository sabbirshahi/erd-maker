import { describe, it, expect } from 'vitest'
import { generateDjango } from '@/core/django'
import { parseDbml } from '@/core/dbml'
import { emptySchema, newColumn, newIdColumn, newTable, type Schema } from '@/core/schema'
import { DJANGO_TYPE_CHOICES, mapDbmlType, mapDjangoField } from '@/core/django/typemap'
import { blogSchema, diagnosticsSchema, FIXTURES, shopSchema } from './django.fixtures'

const dbmlFixtures = import.meta.glob<string>('../fixtures/*.dbml', { query: '?raw', import: 'default', eager: true })

describe('generateDjango golden files', () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    it(`matches tests/golden/ir/${name}.py`, async () => {
      const { text, diagnostics } = generateDjango(make())
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      await expect(text).toMatchFileSnapshot(`../golden/ir/${name}.py`)
    })
  }

  // Once worker-1's parseDbml lands, every tests/fixtures/*.dbml gets a golden file too.
  for (const [path, dbml] of Object.entries(dbmlFixtures)) {
    const name = path.split('/').pop()!.replace(/\.dbml$/, '')
    it(`matches tests/golden/${name}.py (from DBML fixture)`, async ({ skip }) => {
      const parsed = parseDbml(dbml)
      if (!parsed.schema) skip()
      const { text } = generateDjango(parsed.schema!)
      await expect(text).toMatchFileSnapshot(`../golden/${name}.py`)
    })
  }
})

describe('generateDjango content', () => {
  const blog = generateDjango(blogSchema())
  const shop = generateDjango(shopSchema())

  it('starts with the models import and emits TextChoices before models', () => {
    expect(blog.text.startsWith('from django.db import models\n')).toBe(true)
    expect(blog.text.indexOf('class PostStatus(models.TextChoices):')).toBeLessThan(blog.text.indexOf('class User(models.Model):'))
    expect(blog.text).toContain("    DRAFT = 'draft', 'Draft'")
  })

  it('always emits db_table and singularised class names', () => {
    expect(blog.text).toContain("class Post(models.Model):")
    expect(blog.text).toContain("        db_table = 'posts'")
    expect(shop.text).toContain("class OrderItem(models.Model):")
    expect(shop.text).toContain("class Profile(models.Model):")
    expect(shop.text).toContain("        db_table = 'customer_profiles'")
  })

  it('omits the implicit int id and emits BigAutoField / primary_key=True otherwise (D14)', () => {
    expect(blog.text).not.toMatch(/^\s+id = /m)
    expect(shop.text).toContain('    id = models.BigAutoField(primary_key=True)')
    expect(shop.text).toContain('    id = models.UUIDField(primary_key=True)')
  })

  it('maps foreign keys with on_delete, db_column, to_field and related_name', () => {
    expect(blog.text).toContain("    author = models.ForeignKey('User', on_delete=models.CASCADE, db_column='author_id')")
    expect(blog.text).toContain("    post = models.ForeignKey('Post', on_delete=models.CASCADE, db_column='post_id')")
    expect(shop.text).toContain("    referred_by = models.ForeignKey('self', on_delete=models.SET_NULL, db_column='referred_by_id', null=True, blank=True)")
    expect(shop.text).toContain("    customer = models.OneToOneField('Customer', on_delete=models.CASCADE, db_column='customer_id')")
    expect(shop.text).toContain("    category_slug = models.ForeignKey('Category', on_delete=models.PROTECT, db_column='category_slug', to_field='slug')")
    expect(shop.text).toContain("    customer = models.ForeignKey('Customer', on_delete=models.PROTECT, db_column='customer_id', related_name='orders')")
    expect(shop.text).toContain('on_delete=models.DO_NOTHING')
    expect(shop.text).toContain('on_delete=models.SET_DEFAULT')
  })

  it('maps many-to-many refs to ManyToManyField on the from model (D16)', () => {
    expect(blog.text).toContain("    tags = models.ManyToManyField('Tag')")
  })

  it('maps nullability, uniqueness, defaults and notes', () => {
    expect(blog.text).toContain('    username = models.CharField(max_length=150, unique=True)')
    expect(blog.text).toContain('    body = models.TextField(null=True, blank=True)')
    expect(blog.text).toContain('    is_active = models.BooleanField(default=True)')
    expect(blog.text).toContain('    created_at = models.DateTimeField(auto_now_add=True)')
    expect(blog.text).toContain('    status = models.CharField(max_length=9, choices=PostStatus.choices, default=PostStatus.DRAFT)')
    expect(shop.text).toContain("    joined_on = models.DateField(help_text='Signup date')")
    expect(shop.text).toContain('    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)')
    expect(shop.text).toContain('    bio = models.TextField(blank=True)')
    expect(shop.text).toContain('    settings = models.JSONField(null=True)')
  })

  it('emits Meta indexes, constraints, composite pk, ordering and verbose_name', () => {
    expect(blog.text).toContain("            models.Index(fields=['author', 'published_at']),")
    expect(shop.text).toContain("            models.Index(fields=['price'], name='products_price_idx'),")
    expect(shop.text).toContain("            models.UniqueConstraint(fields=['product', 'customer'], name='reviews_product_id_customer_id_uniq'),")
    expect(shop.text).toContain("    pk = models.CompositePrimaryKey('order', 'product')")
    expect(shop.text).toContain("        ordering = ['-id']")
    expect(shop.text).toContain("        verbose_name = 'customer'")
  })

  it('emits table notes as docstrings and re-emits passthrough and extra kwargs', () => {
    expect(blog.text).toContain('class User(models.Model):\n\n    """Registered users"""')
    expect(shop.text).toContain('    def __str__(self):\n        return self.bio[:20]')
    expect(shop.text).toContain("    stock = models.SmallIntegerField(default=0, db_comment='units on hand')")
    expect(shop.text).toContain('    email = models.EmailField(unique=True)')
  })

  it('yields exactly info/error/warning for timestamptz, multi-column FK and unknown type', () => {
    const { text, diagnostics } = generateDjango(diagnosticsSchema())
    expect(diagnostics.map((d) => d.severity).sort()).toEqual(['error', 'info', 'warning'])
    const info = diagnostics.find((d) => d.severity === 'info')!
    expect(info.lossy).toBe(true)
    expect(info.source).toBe('typemap')
    expect(info.tableId).toBe('t_a')
    expect(info.columnId).toBeDefined()
    expect(info.message).toContain('timezone')
    const warning = diagnostics.find((d) => d.severity === 'warning')!
    expect(warning.message).toContain('hstore')
    expect(text).toContain('    payload = models.TextField(null=True, blank=True)')
    const error = diagnostics.find((d) => d.severity === 'error')!
    expect(error.refId).toBeDefined()
    expect(text).toContain('    region = models.CharField(max_length=10)')
  })

  it('reports FK to composite pk and missing targets as errors', () => {
    const s = shopSchema()
    const orderItems = s.tables.find((t) => t.name === 'order_items')!
    const products = s.tables.find((t) => t.name === 'products')!
    s.tables.push(
      newTable({
        id: 't_x',
        name: 'x',
        columns: [newIdColumn(), newColumn({ id: 'c_x1', name: 'item_id', type: 'int' }), newColumn({ id: 'c_x2', name: 'ghost_id', type: 'int' })],
      }),
    )
    s.refs.push(
      { id: 'r1', kind: '>', from: { tableId: 't_x', columnIds: ['c_x1'] }, to: { tableId: orderItems.id, columnIds: [orderItems.columns[0].id] } },
      { id: 'r2', kind: '>', from: { tableId: 't_x', columnIds: ['c_x2'] }, to: { tableId: 'nope', columnIds: ['nope'] } },
      { id: 'r3', kind: '<>', from: { tableId: 't_x', columnIds: ['c_x1'] }, to: { tableId: 'nope', columnIds: ['nope'] } },
      { id: 'r4', kind: '<', from: { tableId: products.id, columnIds: [products.columns[0].id] }, to: { tableId: 't_x', columnIds: ['c_x1'] } },
    )
    const { text, diagnostics } = generateDjango(s)
    const errors = diagnostics.filter((d) => d.severity === 'error')
    expect(errors).toHaveLength(3)
    expect(errors.map((d) => d.refId).sort()).toEqual(['r1', 'r2', 'r3'])
    expect(text).toContain('    item = models.ForeignKey')
  })

  it('handles enums with notes, weird values, empty enums and enum defaults not in the enum', () => {
    const s = emptySchema()
    s.enums.push(
      { id: 'e1', name: 'priority', note: 'How urgent', values: [{ id: 'v1', name: '1st-class', note: 'top' }, { id: 'v2', name: 'low' }] },
      { id: 'e2', name: 'empty', values: [] },
    )
    s.tables.push(newTable({ name: 'tickets', columns: [newIdColumn(), newColumn({ name: 'prio', type: 'priority', default: "'urgent'" })] }))
    const { text, diagnostics } = generateDjango(s)
    expect(text).toContain('class Priority(models.TextChoices):\n    """How urgent"""\n    _1ST_CLASS = \'1st-class\', \'1st class\'\n    LOW = \'low\', \'Low\'')
    expect(text).toContain('class Empty(models.TextChoices):\n    pass')
    expect(text).toContain("prio = models.CharField(max_length=9, choices=Priority.choices, null=True, blank=True, default='urgent')")
    expect(diagnostics.some((d) => d.lossy && d.message.includes('Enum value note'))).toBe(true)
  })

  it('handles SQL defaults, schema qualifiers, index types, on_update, name collisions and null defaults', () => {
    const s = emptySchema()
    const a = newTable({
      id: 'a',
      name: 'user',
      schema: 'public',
      columns: [
        newIdColumn(),
        newColumn({ id: 'a_code', name: 'code', type: 'uuid', notNull: true, default: '`gen_random_uuid()`' }),
        newColumn({ id: 'a_nil', name: 'nil', type: 'int', default: 'null' }),
        newColumn({ id: 'a_note', name: 'note', type: 'text', note: "it's noted", django: { verboseName: 'Note', blank: true } }),
        newColumn({ id: 'a_parent', name: 'parent_id', type: 'int', unique: true }),
        newColumn({ id: 'a_parent2', name: 'parent', type: 'int' }),
      ],
      indexes: [
        { id: 'i1', columnIds: ['a_code'], unique: false, pk: false, type: 'hash', note: 'n' },
        { id: 'i2', columnIds: ['missing'], unique: false, pk: false },
      ],
    })
    const b = newTable({ id: 'b', name: 'users', columns: [newIdColumn()], note: 'multi\nline' })
    s.tables.push(a, b)
    s.refs.push({ id: 'r', kind: '>', from: { tableId: 'a', columnIds: ['a_parent'] }, to: { tableId: 'a', columnIds: [a.columns[0].id] }, onUpdate: 'cascade', django: { relatedName: 'kids' } })
    const { text, diagnostics } = generateDjango(s)
    expect(text).toContain('    # default: `gen_random_uuid()`\n    code = models.UUIDField()')
    expect(text).toContain('    nil = models.IntegerField(null=True, blank=True)')
    expect(text).toContain("    note = models.TextField(null=True, blank=True, help_text='it\\'s noted', verbose_name='Note')")
    // `parent_id` keeps its full name because a plain `parent` column exists
    expect(text).toContain("    parent_id = models.ForeignKey('self', on_delete=models.CASCADE, db_column='parent_id', related_name='kids', unique=True, null=True, blank=True)")
    expect(text).toContain('class User(models.Model):')
    expect(text).toContain('class User2(models.Model):')
    expect(text).toContain('    """\n    multi\n    line\n    """')
    expect(diagnostics.some((d) => d.severity === 'warning' && d.message.includes('gen_random_uuid'))).toBe(true)
    expect(diagnostics.some((d) => d.lossy && d.message.includes('Schema qualifier'))).toBe(true)
    expect(diagnostics.some((d) => d.lossy && d.message.includes('Index type'))).toBe(true)
    expect(diagnostics.some((d) => d.lossy && d.message.includes('on_update'))).toBe(true)
    expect(diagnostics.some((d) => d.severity === 'warning' && d.message.includes('references no existing columns'))).toBe(true)
  })

  it('emits a field type override even for unknown DBML types without warning', () => {
    const s: Schema = emptySchema()
    s.tables.push(newTable({ name: 'things', columns: [newIdColumn(), newColumn({ name: 'ip', type: 'inet', notNull: true, django: { fieldType: 'GenericIPAddressField' } })] }))
    const { text, diagnostics } = generateDjango(s)
    expect(text).toContain('    ip = models.GenericIPAddressField()')
    expect(diagnostics).toEqual([])
  })
})

describe('typemap', () => {
  const c = newColumn({ name: 'x' })
  it('maps every plan row', () => {
    const rows: Array<[string, string, Record<string, string>?]> = [
      ['int', 'IntegerField'], ['integer', 'IntegerField'], ['bigint', 'BigIntegerField'], ['smallint', 'SmallIntegerField'],
      ['varchar(255)', 'CharField', { max_length: '255' }], ['text', 'TextField'], ['boolean', 'BooleanField'], ['bool', 'BooleanField'],
      ['timestamp', 'DateTimeField'], ['timestamptz', 'DateTimeField'], ['datetime', 'DateTimeField'], ['date', 'DateField'], ['time', 'TimeField'],
      ['decimal(10,2)', 'DecimalField', { max_digits: '10', decimal_places: '2' }], ['numeric(8, 3)', 'DecimalField', { max_digits: '8', decimal_places: '3' }],
      ['float', 'FloatField'], ['double', 'FloatField'], ['real', 'FloatField'], ['uuid', 'UUIDField'], ['json', 'JSONField'], ['jsonb', 'JSONField'],
      ['Timestamp With Time Zone', 'DateTimeField'],
    ]
    for (const [dbml, field, kwargs] of rows) {
      const m = mapDbmlType(dbml, c)
      expect([dbml, m.field]).toEqual([dbml, field])
      expect(m.kwargs).toEqual(kwargs ?? {})
      expect(m.unknown).toBe(false)
    }
    expect(mapDbmlType('hstore', c)).toMatchObject({ field: 'TextField', unknown: true })
  })

  it('flags lossy rows', () => {
    expect(mapDbmlType('timestamptz', c).lossy).toMatch(/timezone/)
    expect(mapDbmlType('timetz', c).lossy).toMatch(/timezone/)
    expect(mapDbmlType('timestamp', c).lossy).toBeUndefined()
    expect(mapDbmlType('varchar', c).lossy).toMatch(/255/)
    expect(mapDbmlType('char(3)', c).lossy).toMatch(/fixed-width/)
    expect(mapDbmlType('decimal', c).lossy).toMatch(/precision/)
    expect(mapDbmlType('real', c).lossy).toMatch(/single precision/)
    expect(mapDbmlType('jsonb', c).lossy).toMatch(/json/)
    expect(mapDbmlType('tinyint', c).lossy).toMatch(/SmallIntegerField/)
    expect(mapDbmlType('decimal(4,1)', c).lossy).toBeUndefined()
  })

  it('maps Django fields back to DBML types', () => {
    expect(mapDjangoField('CharField', { max_length: '40' })).toMatchObject({ type: 'varchar(40)', consumed: ['max_length'] })
    expect(mapDjangoField('CharField', {})).toMatchObject({ type: 'varchar(255)' })
    expect(mapDjangoField('DecimalField', { max_digits: '6', decimal_places: '1' })).toMatchObject({ type: 'decimal(6,1)' })
    expect(mapDjangoField('DecimalField', {})).toMatchObject({ type: 'decimal(10,2)' })
    expect(mapDjangoField('BigAutoField', {})).toMatchObject({ type: 'bigint', auto: true })
    expect(mapDjangoField('EmailField', {})).toMatchObject({ type: 'varchar(254)', fieldType: 'EmailField' })
    expect(mapDjangoField('EmailField', { max_length: '100' })).toMatchObject({ type: 'varchar(100)', fieldType: 'EmailField' })
    expect(mapDjangoField('PositiveIntegerField', {})).toMatchObject({ type: 'int', fieldType: 'PositiveIntegerField' })
    expect(mapDjangoField('GeometryField', {})).toMatchObject({ type: 'text', fieldType: 'GeometryField', unknown: true })
  })

  it('exposes inspector choices', () => {
    expect(DJANGO_TYPE_CHOICES).toContain('CharField')
    expect(DJANGO_TYPE_CHOICES).toContain('EmailField')
    expect(DJANGO_TYPE_CHOICES).toContain('ForeignKey')
    expect(new Set(DJANGO_TYPE_CHOICES).size).toBe(DJANGO_TYPE_CHOICES.length)
  })
})

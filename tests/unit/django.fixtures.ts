/**
 * IR fixtures for the Django generator/parser tests (worker-4). Built by hand until worker-1's
 * DBML parser + tests/fixtures land; `blog` mirrors src/examples/blog.dbml.
 */
import { emptySchema, newColumn, newIdColumn, newTable, type Ref, type Schema, type Table } from '@/core/schema'

const col = (t: Table, name: string) => t.columns.find((c) => c.name === name)!
const ref = (partial: Omit<Ref, 'id'> & { id?: string }): Ref => ({ id: partial.id ?? `ref_${partial.from.tableId}_${partial.to.tableId}_${partial.from.columnIds[0]}`, ...partial })

export function blogSchema(): Schema {
  const s = emptySchema()
  s.enums.push({
    id: 'e_post_status',
    name: 'post_status',
    values: [
      { id: 'ev_draft', name: 'draft' },
      { id: 'ev_published', name: 'published' },
      { id: 'ev_archived', name: 'archived' },
    ],
  })
  const users = newTable({
    id: 't_users',
    name: 'users',
    note: 'Registered users',
    columns: [
      newIdColumn(),
      newColumn({ name: 'username', type: 'varchar(150)', notNull: true, unique: true }),
      newColumn({ name: 'email', type: 'varchar(254)', notNull: true, unique: true }),
      newColumn({ name: 'is_active', type: 'boolean', notNull: true, default: 'true' }),
      newColumn({ name: 'created_at', type: 'timestamp', notNull: true, default: '`now()`' }),
    ],
  })
  const posts = newTable({
    id: 't_posts',
    name: 'posts',
    columns: [
      newIdColumn(),
      newColumn({ name: 'author_id', type: 'int', notNull: true }),
      newColumn({ name: 'title', type: 'varchar(200)', notNull: true }),
      newColumn({ name: 'body', type: 'text' }),
      newColumn({ name: 'status', type: 'post_status', notNull: true, default: "'draft'" }),
      newColumn({ name: 'published_at', type: 'timestamp' }),
    ],
  })
  posts.indexes.push({
    id: 'i_posts_author_published',
    columnIds: [col(posts, 'author_id').id, col(posts, 'published_at').id],
    unique: false,
    pk: false,
  })
  const tags = newTable({
    id: 't_tags',
    name: 'tags',
    columns: [newIdColumn(), newColumn({ name: 'name', type: 'varchar(50)', notNull: true, unique: true })],
  })
  const comments = newTable({
    id: 't_comments',
    name: 'comments',
    columns: [
      newIdColumn(),
      newColumn({ name: 'post_id', type: 'int', notNull: true }),
      newColumn({ name: 'user_id', type: 'int', notNull: true }),
      newColumn({ name: 'body', type: 'text', notNull: true }),
      newColumn({ name: 'created_at', type: 'timestamp', notNull: true, default: '`now()`' }),
    ],
  })
  s.tables.push(users, posts, tags, comments)
  s.refs.push(
    ref({ kind: '>', from: { tableId: posts.id, columnIds: [col(posts, 'author_id').id] }, to: { tableId: users.id, columnIds: [col(users, 'id').id] } }),
    ref({ kind: '>', from: { tableId: comments.id, columnIds: [col(comments, 'post_id').id] }, to: { tableId: posts.id, columnIds: [col(posts, 'id').id] }, onDelete: 'cascade' }),
    ref({ kind: '>', from: { tableId: comments.id, columnIds: [col(comments, 'user_id').id] }, to: { tableId: users.id, columnIds: [col(users, 'id').id] } }),
    ref({ kind: '<>', from: { tableId: posts.id, columnIds: [col(posts, 'id').id] }, to: { tableId: tags.id, columnIds: [col(tags, 'id').id] } }),
  )
  return s
}

/** E-commerce: bigint pk, uuid, decimal, one-to-one, self FK, to_field, composite pk, unique constraint, Django bags. */
export function shopSchema(): Schema {
  const s = emptySchema()
  s.enums.push({
    id: 'e_order_status',
    name: 'order_status',
    note: 'Lifecycle of an order',
    values: [
      { id: 'ev_new', name: 'new' },
      { id: 'ev_paid', name: 'paid' },
      { id: 'ev_in_transit', name: 'in-transit' },
    ],
  })
  const customers = newTable({
    id: 't_customers',
    name: 'customers',
    columns: [
      newColumn({ name: 'id', type: 'bigint', pk: true, increment: true, notNull: true }),
      newColumn({ name: 'email', type: 'varchar(254)', notNull: true, unique: true, django: { fieldType: 'EmailField' } }),
      newColumn({ name: 'referred_by_id', type: 'bigint' }),
      newColumn({ name: 'joined_on', type: 'date', notNull: true, note: 'Signup date' }),
    ],
    django: { ordering: ['-id'], verboseName: 'customer' },
  })
  const profiles = newTable({
    id: 't_profiles',
    name: 'customer_profiles',
    columns: [
      newColumn({ name: 'id', type: 'uuid', pk: true, notNull: true, default: undefined }),
      newColumn({ name: 'customer_id', type: 'bigint', notNull: true }),
      newColumn({ name: 'bio', type: 'text', notNull: true, django: { blank: true } }),
      newColumn({ name: 'settings', type: 'json', django: { blank: false } }),
    ],
    django: { className: 'Profile', passthrough: ['def __str__(self):\n    return self.bio[:20]'] },
  })
  const categories = newTable({
    id: 't_categories',
    name: 'categories',
    columns: [
      newIdColumn(),
      newColumn({ name: 'slug', type: 'varchar(60)', notNull: true, unique: true }),
      newColumn({ name: 'parent_id', type: 'int' }),
    ],
  })
  const products = newTable({
    id: 't_products',
    name: 'products',
    columns: [
      newIdColumn(),
      newColumn({ name: 'sku', type: 'varchar(32)', notNull: true, unique: true }),
      newColumn({ name: 'category_slug', type: 'varchar(60)', notNull: true }),
      newColumn({ name: 'price', type: 'decimal(10,2)', notNull: true, default: '0' }),
      newColumn({ name: 'weight', type: 'float' }),
      newColumn({ name: 'stock', type: 'smallint', notNull: true, default: '0', django: { extraKwargs: { db_comment: "'units on hand'" } } }),
    ],
  })
  products.indexes.push({ id: 'i_products_price', columnIds: [col(products, 'price').id], unique: false, pk: false, name: 'products_price_idx' })
  const orders = newTable({
    id: 't_orders',
    name: 'orders',
    columns: [
      newIdColumn(),
      newColumn({ name: 'customer_id', type: 'bigint', notNull: true, django: { relatedName: 'orders' } }),
      newColumn({ name: 'status', type: 'order_status', notNull: true, default: "'new'" }),
      newColumn({ name: 'placed_at', type: 'timestamp', notNull: true, default: '`now()`' }),
    ],
  })
  const orderItems = newTable({
    id: 't_order_items',
    name: 'order_items',
    columns: [
      newColumn({ name: 'order_id', type: 'int', notNull: true }),
      newColumn({ name: 'product_id', type: 'int', notNull: true }),
      newColumn({ name: 'quantity', type: 'int', notNull: true, default: '1' }),
    ],
  })
  orderItems.indexes.push({
    id: 'i_order_items_pk',
    columnIds: [col(orderItems, 'order_id').id, col(orderItems, 'product_id').id],
    unique: false,
    pk: true,
  })
  const reviews = newTable({
    id: 't_reviews',
    name: 'reviews',
    columns: [
      newIdColumn(),
      newColumn({ name: 'product_id', type: 'int', notNull: true }),
      newColumn({ name: 'customer_id', type: 'bigint', notNull: true }),
      newColumn({ name: 'rating', type: 'smallint', notNull: true }),
    ],
  })
  reviews.indexes.push({
    id: 'i_reviews_unique',
    columnIds: [col(reviews, 'product_id').id, col(reviews, 'customer_id').id],
    unique: true,
    pk: false,
  })
  s.tables.push(customers, profiles, categories, products, orders, orderItems, reviews)
  s.refs.push(
    ref({ kind: '>', from: { tableId: customers.id, columnIds: [col(customers, 'referred_by_id').id] }, to: { tableId: customers.id, columnIds: [col(customers, 'id').id] }, onDelete: 'set null' }),
    ref({ kind: '-', from: { tableId: profiles.id, columnIds: [col(profiles, 'customer_id').id] }, to: { tableId: customers.id, columnIds: [col(customers, 'id').id] }, onDelete: 'cascade' }),
    ref({ kind: '>', from: { tableId: categories.id, columnIds: [col(categories, 'parent_id').id] }, to: { tableId: categories.id, columnIds: [col(categories, 'id').id] }, onDelete: 'set null' }),
    ref({ kind: '>', from: { tableId: products.id, columnIds: [col(products, 'category_slug').id] }, to: { tableId: categories.id, columnIds: [col(categories, 'slug').id] }, onDelete: 'restrict' }),
    ref({ kind: '>', from: { tableId: orders.id, columnIds: [col(orders, 'customer_id').id] }, to: { tableId: customers.id, columnIds: [col(customers, 'id').id] }, onDelete: 'restrict' }),
    ref({ kind: '>', from: { tableId: orderItems.id, columnIds: [col(orderItems, 'order_id').id] }, to: { tableId: orders.id, columnIds: [col(orders, 'id').id] }, onDelete: 'cascade' }),
    ref({ kind: '>', from: { tableId: orderItems.id, columnIds: [col(orderItems, 'product_id').id] }, to: { tableId: products.id, columnIds: [col(products, 'id').id] }, onDelete: 'no action' }),
    ref({ kind: '>', from: { tableId: reviews.id, columnIds: [col(reviews, 'product_id').id] }, to: { tableId: products.id, columnIds: [col(products, 'id').id] } }),
    ref({ kind: '>', from: { tableId: reviews.id, columnIds: [col(reviews, 'customer_id').id] }, to: { tableId: customers.id, columnIds: [col(customers, 'id').id] }, onDelete: 'set default' }),
  )
  return s
}

/** Exactly one lossy type, one multi-column FK and one unknown type -> 3 diagnostics (info/error/warning). */
export function diagnosticsSchema(): Schema {
  const s = emptySchema()
  const a = newTable({
    id: 't_a',
    name: 'events',
    columns: [
      newIdColumn(),
      newColumn({ name: 'happened_at', type: 'timestamptz', notNull: true }),
      newColumn({ name: 'payload', type: 'hstore' }),
      newColumn({ name: 'region', type: 'varchar(10)', notNull: true }),
      newColumn({ name: 'code', type: 'varchar(10)', notNull: true }),
    ],
  })
  const b = newTable({
    id: 't_b',
    name: 'zones',
    columns: [
      newIdColumn(),
      newColumn({ name: 'region', type: 'varchar(10)', notNull: true }),
      newColumn({ name: 'code', type: 'varchar(10)', notNull: true }),
    ],
  })
  b.indexes.push({ id: 'i_zones_uq', columnIds: [col(b, 'region').id, col(b, 'code').id], unique: true, pk: false })
  s.tables.push(b, a)
  s.refs.push(
    ref({
      kind: '>',
      from: { tableId: a.id, columnIds: [col(a, 'region').id, col(a, 'code').id] },
      to: { tableId: b.id, columnIds: [col(b, 'region').id, col(b, 'code').id] },
    }),
  )
  return s
}

export const FIXTURES: Record<string, () => Schema> = {
  blog: blogSchema,
  shop: shopSchema,
}

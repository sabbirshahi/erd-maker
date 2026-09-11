import type { Layout, Schema } from '@/core/schema'
import blog from './blog.dbml?raw'
import ecommerce from './ecommerce.dbml?raw'
import school from './school.dbml?raw'
import saas from './saas_multitenant.dbml?raw'
import djangoAuth from './django_auth.dbml?raw'

export interface Example {
  id: string
  title: string
  description: string
  dbml: string
  /** Optional saved positions keyed by table *name* (ids are assigned at parse time). */
  layout?: Record<string, { x: number; y: number }>
  tags?: string[]
}

/** OWNER: worker-6 (app). */
export const examples: Example[] = [
  {
    id: 'blog',
    title: 'Blog',
    description: 'Users, posts, tags, comments with an enum and a many-to-many.',
    dbml: blog,
    tags: ['starter'],
  },
  {
    id: 'ecommerce',
    title: 'E-commerce',
    description: 'Customers, addresses, catalog, orders, order items and payments.',
    dbml: ecommerce,
  },
  {
    id: 'school',
    title: 'School',
    description: 'Students, teachers, courses, sections per term, enrollments and grades.',
    dbml: school,
  },
  {
    id: 'saas_multitenant',
    title: 'SaaS multi-tenant',
    description: 'Organizations, memberships with roles, projects, API keys, billing, audit log.',
    dbml: saas,
  },
  {
    id: 'django_auth',
    title: 'Django auth',
    description: "The tables Django's contrib.auth, contenttypes and sessions apps create.",
    dbml: djangoAuth,
    tags: ['django'],
  },
]

export const findExample = (id: string): Example | undefined => examples.find((e) => e.id === id)

export interface LoadedExample {
  schema: Schema
  layout: Layout
  dbmlText: string
}

/**
 * Parse an example into a schema + id-keyed layout. Returns diagnostics on failure
 * (examples are expected to parse with zero errors — see acceptance criterion 17).
 */
export type LoadExampleResult = { ok: true; doc: LoadedExample } | { ok: false; error: string }

export async function loadExample(example: Example): Promise<LoadExampleResult> {
  // Dynamic import: @dbml/core is the largest chunk in the bundle; only pay for it when an example is loaded.
  const { parseDbml } = await import('@/core/dbml')
  const res = parseDbml(example.dbml)
  if (!res.schema) {
    const first = res.diagnostics.find((d) => d.severity === 'error')
    return { ok: false, error: first?.message ?? 'Example failed to parse' }
  }
  const layout: Layout = {}
  if (example.layout) {
    for (const t of res.schema.tables) {
      const pos = example.layout[t.name]
      if (pos) layout[t.id] = pos
    }
  }
  return { ok: true, doc: { schema: res.schema, layout, dbmlText: example.dbml } }
}

import type { Layout, Schema } from '@/core/schema'
import { parseDbml } from '@/core/dbml'
import blog from './blog.dbml?raw'

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
export function loadExample(example: Example): { ok: true; doc: LoadedExample } | { ok: false; error: string } {
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

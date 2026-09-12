import { describe, it, expect, beforeEach } from 'vitest'
import {
  createProject,
  deleteProject,
  duplicateProject,
  ensureProjects,
  listProjects,
  readIndex,
  readProject,
  renameProject,
  setActiveProject,
  writeProject,
  migrateLegacyKeys,
  DEFAULT_PROJECT_NAME,
} from './projects'
import { DOC_KEY, serializeDoc } from './persistence'
import { emptySchema, newTable, type Schema } from '@/core/schema'

/** Minimal in-memory Storage. */
function memStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

const schemaWith = (...names: string[]): Schema => {
  const s = emptySchema()
  for (const n of names) s.tables.push(newTable({ name: n }))
  return s
}
const state = (s: Schema) => ({ schema: s, layout: {}, dbmlText: null })

let storage: Storage
beforeEach(() => {
  storage = memStorage()
})

describe('projects', () => {
  it('creates the first project on an empty browser', () => {
    const meta = ensureProjects(storage)
    expect(meta.name).toBe(DEFAULT_PROJECT_NAME)
    expect(listProjects(storage)).toHaveLength(1)
    expect(readIndex(storage).activeId).toBe(meta.id)
  })

  it('adopts a pre-projects document into the first project', () => {
    storage.setItem(DOC_KEY, JSON.stringify(serializeDoc(state(schemaWith('legacy_table')))))
    const meta = ensureProjects(storage)
    expect(meta.name).toBe('My diagram')
    expect(readProject(meta.id, storage)?.schema.tables[0].name).toBe('legacy_table')
  })

  it('keeps each project’s document separate', () => {
    const a = createProject('A', state(schemaWith('a_table')), storage)
    const b = createProject('B', state(schemaWith('b_table')), storage)
    expect(readProject(a.id, storage)?.schema.tables[0].name).toBe('a_table')
    expect(readProject(b.id, storage)?.schema.tables[0].name).toBe('b_table')
    // Writing one must not disturb the other.
    writeProject(a.id, state(schemaWith('a_table', 'a_second')), storage)
    expect(readProject(a.id, storage)?.schema.tables).toHaveLength(2)
    expect(readProject(b.id, storage)?.schema.tables).toHaveLength(1)
  })

  it('renames, duplicates and deletes', () => {
    const a = createProject('Shop', state(schemaWith('orders')), storage)
    renameProject(a.id, 'Store', storage)
    expect(listProjects(storage)[0].name).toBe('Store')

    const copy = duplicateProject(a.id, storage)!
    expect(copy.name).toBe('Store copy')
    expect(readProject(copy.id, storage)?.schema.tables[0].name).toBe('orders')
    expect(listProjects(storage)).toHaveLength(2)

    const nextActive = deleteProject(copy.id, storage)
    expect(nextActive).toBe(a.id)
    expect(listProjects(storage)).toHaveLength(1)
    expect(readProject(copy.id, storage)).toBeNull()
  })

  it('switches the active project and survives a malformed index', () => {
    const a = createProject('A', null, storage)
    const b = createProject('B', null, storage)
    expect(readIndex(storage).activeId).toBe(b.id)
    setActiveProject(a.id, storage)
    expect(readIndex(storage).activeId).toBe(a.id)

    storage.setItem('dbridge:projects:v1', '{ not json')
    expect(readIndex(storage).projects).toEqual([])
    expect(() => ensureProjects(storage)).not.toThrow()
  })

  it('reports failure instead of throwing when storage rejects a write', () => {
    const full = { ...memStorage(), setItem: () => { throw new Error('QuotaExceededError') } } as unknown as Storage
    const meta = createProject('X', null, storage)
    expect(writeProject(meta.id, state(schemaWith('t')), full)).toBe(false)
  })
})

describe('rename migration (erd-maker: -> dbridge:)', () => {
  it('adopts diagrams saved under the old prefix', () => {
    const doc = JSON.stringify(serializeDoc(state(schemaWith('kept_from_before'))))
    storage.setItem('erd-maker:project:abc', doc)
    storage.setItem('erd-maker:projects:v1', JSON.stringify({ v: 1, activeId: 'abc', projects: [{ id: 'abc', name: 'Old diagram', createdAt: '', updatedAt: '' }] }))

    const meta = ensureProjects(storage)

    expect(meta.name).toBe('Old diagram')
    expect(readProject('abc', storage)?.schema.tables[0].name).toBe('kept_from_before')
    // The originals stay put, so an older build still opens.
    expect(storage.getItem('erd-maker:project:abc')).toBe(doc)
  })

  it('never overwrites a key the new prefix already has', () => {
    storage.setItem('erd-maker:theme', 'dark')
    storage.setItem('dbridge:theme', 'light')
    migrateLegacyKeys(storage)
    expect(storage.getItem('dbridge:theme')).toBe('light')
  })

  it('is a no-op when there is nothing to migrate', () => {
    expect(migrateLegacyKeys(storage)).toBe(0)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSaveController } from './saveController'
import { createProject, readProject, writeProject } from './projects'
import { useSchemaStore } from '@/store'
import { emptySchema, newTable } from '@/core/schema'

/** In-memory Storage shared by the "tabs" in these tests. */
function memStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

const withTable = (name: string) => {
  const s = emptySchema()
  s.tables.push(newTable({ name }))
  return s
}

let storage: Storage
beforeEach(() => {
  storage = memStorage()
  useSchemaStore.getState().reset()
})

describe('save controller', () => {
  it('saves the store into the active project', () => {
    const meta = createProject('P', null, storage)
    const c = createSaveController(useSchemaStore, meta.id, storage)
    useSchemaStore.getState().commit('canvas', withTable('users'))
    expect(c.save()).toBe(true)
    expect(readProject(meta.id, storage)?.schema.tables[0].name).toBe('users')
    expect(c.status).toBe('saved')
  })

  it('refuses a save that would discard another tab’s newer work, until forced', () => {
    const meta = createProject('P', null, storage)
    // This "tab" loads the project, so its baseline is the document as it stands now.
    writeProject(meta.id, { schema: withTable('base'), layout: {}, dbmlText: null }, storage)
    const c = createSaveController(useSchemaStore, meta.id, storage)

    // Another tab saves in the meantime.
    writeProject(meta.id, { schema: withTable('from_other_tab'), layout: {}, dbmlText: null }, storage)

    useSchemaStore.getState().commit('canvas', withTable('mine'))
    expect(c.save()).toBe(false)
    expect(c.status).toBe('conflict')
    // The other tab's work is still there.
    expect(readProject(meta.id, storage)?.schema.tables[0].name).toBe('from_other_tab')

    // Overwriting is possible, but only deliberately.
    expect(c.save(true)).toBe(true)
    expect(readProject(meta.id, storage)?.schema.tables[0].name).toBe('mine')
    expect(c.status).toBe('saved')
  })

  it('re-baselines after a forced save, so the next save is clean', () => {
    const meta = createProject('P', null, storage)
    writeProject(meta.id, { schema: withTable('a'), layout: {}, dbmlText: null }, storage)
    const c = createSaveController(useSchemaStore, meta.id, storage)
    writeProject(meta.id, { schema: withTable('b'), layout: {}, dbmlText: null }, storage)
    useSchemaStore.getState().commit('canvas', withTable('c'))
    c.save()
    c.save(true)
    useSchemaStore.getState().commit('canvas', withTable('d'))
    expect(c.save()).toBe(true)
  })

  it('notifies a conflict handler', () => {
    const meta = createProject('P', null, storage)
    writeProject(meta.id, { schema: withTable('a'), layout: {}, dbmlText: null }, storage)
    const c = createSaveController(useSchemaStore, meta.id, storage)
    const onConflict = vi.fn()
    c.onConflict?.(onConflict)
    writeProject(meta.id, { schema: withTable('b'), layout: {}, dbmlText: null }, storage)
    useSchemaStore.getState().commit('canvas', withTable('c'))
    c.save()
    expect(onConflict).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while paused, so an empty canvas cannot overwrite a project', () => {
    const meta = createProject('P', null, storage)
    writeProject(meta.id, { schema: withTable('kept'), layout: {}, dbmlText: null }, storage)
    const paused = createSaveController(useSchemaStore, meta.id, storage, undefined, false)
    useSchemaStore.getState().commit('system', emptySchema())
    paused.save()
    expect(readProject(meta.id, storage)?.schema.tables[0].name).toBe('kept')
  })
})

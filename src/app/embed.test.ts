import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isEmbed, setEmbedForTesting } from './embed'
import { createProject, deleteProject, renameProject, writeProject, listProjects, migrateLegacyKeys } from './projects'
import { createSaveController } from './saveController'
import { applyTheme } from './theme'
import { setTabProject } from './session'
import { useSchemaStore } from '@/store'
import { emptySchema, newTable } from '@/core/schema'

/** Storage that records every write, so "wrote nothing" can be asserted rather than assumed. */
function spyStorage() {
  const map = new Map<string, string>()
  const writes: string[] = []
  const storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      writes.push(`remove:${k}`)
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      writes.push(`set:${k}`)
      map.set(k, v)
    },
  } as unknown as Storage
  return { storage, writes }
}

const withTable = (name: string) => {
  const s = emptySchema()
  s.tables.push(newTable({ name }))
  return s
}

afterEach(() => {
  setEmbedForTesting(null)
  vi.restoreAllMocks()
})

describe('isEmbed', () => {
  beforeEach(() => setEmbedForTesting(null))

  it('reads the query parameter', () => {
    expect(isEmbed('?embed=1')).toBe(true)
    expect(isEmbed('?p=abc&embed=1')).toBe(true)
    expect(isEmbed('?embed=true')).toBe(true)
    expect(isEmbed('?embed')).toBe(true)
  })

  it('is off by default and can be switched off explicitly', () => {
    expect(isEmbed('')).toBe(false)
    expect(isEmbed('?p=abc')).toBe(false)
    expect(isEmbed('?embed=0')).toBe(false)
    expect(isEmbed('?embed=false')).toBe(false)
  })
})

describe('embed mode writes nothing', () => {
  it('makes every project write a no-op', () => {
    const { storage, writes } = spyStorage()
    setEmbedForTesting(true)

    createProject('Nope', { schema: withTable('t'), layout: {}, dbmlText: null }, storage)
    writeProject('anything', { schema: withTable('t'), layout: {}, dbmlText: null }, storage)
    renameProject('anything', 'New name', storage)
    deleteProject('anything', storage)
    migrateLegacyKeys(storage)

    expect(writes).toEqual([])
    expect(listProjects(storage)).toEqual([])
  })

  it('never autosaves, and cannot be re-armed by switching project', () => {
    const { storage, writes } = spyStorage()
    setEmbedForTesting(true)
    useSchemaStore.getState().reset()

    const controller = createSaveController(useSchemaStore, 'p1', storage)
    useSchemaStore.getState().commit('canvas', withTable('users'))
    expect(controller.save()).toBe(true)
    controller.setProject('p2')
    expect(controller.save(true)).toBe(true)

    expect(writes).toEqual([])
    controller.dispose()
  })

  it('does not persist a theme change', () => {
    setEmbedForTesting(true)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    applyTheme('dark')
    expect(setItem).not.toHaveBeenCalled()
    // The class is still applied, so the embed can still render dark.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    applyTheme('light')
  })

  it('does not claim the tab key', () => {
    setEmbedForTesting(true)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setTabProject('p1')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('still writes normally when embed is off', () => {
    const { storage, writes } = spyStorage()
    setEmbedForTesting(false)
    createProject('Real', { schema: withTable('t'), layout: {}, dbmlText: null }, storage)
    expect(writes.length).toBeGreaterThan(0)
    expect(listProjects(storage)).toHaveLength(1)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySchema, newTable } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { DOC_KEY, clearDoc, loadDoc, migrateDoc, restoreDoc, saveDoc, startAutosave } from './persistence'

const schemaWith = (name: string) => {
  const s = emptySchema()
  s.tables.push(newTable({ name }))
  return s
}

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useSchemaStore.getState().reset()
  })

  it('round-trips a document through localStorage', () => {
    const schema = schemaWith('users')
    expect(saveDoc({ schema, layout: { a: { x: 1, y: 2 } }, dbmlText: 'Table users {}' })).toBe(true)
    const doc = loadDoc()
    expect(doc?.v).toBe(1)
    expect(doc?.schema.tables[0].name).toBe('users')
    expect(doc?.layout).toEqual({ a: { x: 1, y: 2 } })
    expect(doc?.dbmlText).toBe('Table users {}')
    clearDoc()
    expect(loadDoc()).toBeNull()
  })

  it('migrates unversioned docs and rejects garbage', () => {
    expect(migrateDoc(null)).toBeNull()
    expect(migrateDoc({ v: 1 })).toBeNull()
    expect(migrateDoc({ v: 99, schema: emptySchema() })).toBeNull()
    const m = migrateDoc({ schema: schemaWith('t') })
    expect(m?.v).toBe(1)
    expect(m?.layout).toEqual({})
    expect(m?.dbmlText).toBeNull()
    localStorage.setItem(DOC_KEY, '{not json')
    expect(loadDoc()).toBeNull()
  })

  it('restoreDoc loads into the store only when there are tables', () => {
    saveDoc({ schema: emptySchema(), layout: {}, dbmlText: null })
    expect(restoreDoc(useSchemaStore)).toBe(false)
    saveDoc({ schema: schemaWith('posts'), layout: {}, dbmlText: 'x' })
    expect(restoreDoc(useSchemaStore)).toBe(true)
    expect(useSchemaStore.getState().schema.tables[0].name).toBe('posts')
    expect(useSchemaStore.getState().dbmlText).toBe('x')
  })

  it('autosaves debounced on schema changes and ignores selection changes', () => {
    vi.useFakeTimers()
    const stop = startAutosave(useSchemaStore, localStorage, 500)
    useSchemaStore.getState().select({ tableId: 'nope' })
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem(DOC_KEY)).toBeNull()

    useSchemaStore.getState().commit('import', schemaWith('a'))
    useSchemaStore.getState().commit('import', schemaWith('b'))
    vi.advanceTimersByTime(499)
    expect(localStorage.getItem(DOC_KEY)).toBeNull()
    vi.advanceTimersByTime(1)
    expect(loadDoc()?.schema.tables[0].name).toBe('b')

    useSchemaStore.getState().setTablePosition('b', { x: 5, y: 5 })
    vi.advanceTimersByTime(500)
    expect(loadDoc()?.layout).toEqual({ b: { x: 5, y: 5 } })
    stop()
    useSchemaStore.getState().commit('import', schemaWith('c'))
    vi.advanceTimersByTime(500)
    expect(loadDoc()?.schema.tables[0].name).toBe('b')
    vi.useRealTimers()
  })
})

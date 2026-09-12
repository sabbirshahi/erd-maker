import { describe, it, expect, beforeEach } from 'vitest'
import { buildBackup, backupFilename, restoreBackup, serializeBackup, BackupError, BACKUP_VERSION } from './backup'
import { createProject, listProjects, readProject } from './projects'
import { emptySchema, newTable, type Schema } from '@/core/schema'

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

describe('backup', () => {
  it('survives export -> wipe -> restore with identical schemas', () => {
    createProject('Shop', state(schemaWith('orders', 'customers')), storage)
    createProject('Blog', state(schemaWith('posts')), storage)
    const file = serializeBackup(buildBackup(storage))

    // The browser is cleared: nothing at all is left.
    storage.clear()
    expect(listProjects(storage)).toHaveLength(0)

    const result = restoreBackup(file, storage)
    expect(result).toEqual({ imported: 2, skipped: 0 })

    const restored = listProjects(storage)
    expect(restored.map((p) => p.name).sort()).toEqual(['Blog', 'Shop'])
    const shop = restored.find((p) => p.name === 'Shop')!
    expect(readProject(shop.id, storage)?.schema.tables.map((t) => t.name)).toEqual(['orders', 'customers'])
  })

  it('adds alongside existing diagrams instead of overwriting them', () => {
    const keep = createProject('Mine', state(schemaWith('untouched')), storage)
    const file = serializeBackup(buildBackup(storage))

    const result = restoreBackup(file, storage)

    expect(result.imported).toBe(1)
    expect(listProjects(storage)).toHaveLength(2)
    // The original is still there, with its own id and content.
    expect(readProject(keep.id, storage)?.schema.tables[0].name).toBe('untouched')
    // The copy got a fresh id.
    expect(listProjects(storage).filter((p) => p.id === keep.id)).toHaveLength(1)
  })

  it('carries a diagram that has no document yet', () => {
    createProject('Empty', null, storage)
    const result = restoreBackup(serializeBackup(buildBackup(storage)), storage)
    expect(result).toEqual({ imported: 1, skipped: 0 })
  })

  it('restores the readable diagrams and counts the rest', () => {
    const backup = {
      v: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: '0.0.0',
      projects: [
        { name: 'Good', createdAt: '', updatedAt: '', doc: { v: 1, savedAt: '', rev: 1, schema: schemaWith('t'), layout: {}, dbmlText: null } },
        { name: 'Corrupt', createdAt: '', updatedAt: '', doc: { v: 1, schema: { nope: true } } },
      ],
    }
    expect(restoreBackup(backup, storage)).toEqual({ imported: 1, skipped: 1 })
    expect(listProjects(storage).map((p) => p.name)).toEqual(['Good'])
  })

  it('explains why a bad file was refused, and writes nothing', () => {
    expect(() => restoreBackup('not json at all', storage)).toThrow(BackupError)
    expect(() => restoreBackup('[]', storage)).toThrow(/not a DBridge backup/)
    expect(() => restoreBackup(JSON.stringify({ v: 1 }), storage)).toThrow(/not a DBridge backup/)
    expect(() => restoreBackup(JSON.stringify({ v: 99, projects: [] }), storage)).toThrow(/newer version/)
    expect(() => restoreBackup(JSON.stringify({ v: 1, projects: [] }), storage)).toThrow(/no diagrams/)
    expect(listProjects(storage)).toHaveLength(0)
  })

  it('names the file by date so downloads sort chronologically', () => {
    expect(backupFilename(new Date('2026-09-12T10:00:00Z'))).toBe('dbridge-backup-2026-09-12.json')
  })
})

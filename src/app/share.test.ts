import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySchema, newColumn, newTable } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { SHARE_WARN_BYTES, buildShareUrl, decodeShare, encodeShare, restoreFromHash, shareCurrent, shareFromHash } from './share'
import { clearToasts, useToasts } from './toast'

const schema = () => {
  const s = emptySchema()
  s.tables.push(newTable({ name: 'users', columns: [newColumn({ name: 'id', type: 'int', pk: true })] }))
  return s
}

describe('share links', () => {
  beforeEach(() => {
    useSchemaStore.getState().reset()
    clearToasts()
  })

  it('encodes and decodes schema + layout', () => {
    const doc = { schema: schema(), layout: { x: { x: 1, y: 2 } } }
    const enc = encodeShare(doc)
    expect(enc).not.toMatch(/[^A-Za-z0-9+\-$]/)
    expect(decodeShare(enc)).toEqual(doc)
    expect(decodeShare('not-valid')).toBeNull()
    expect(decodeShare(encodeShare({ schema: { nope: true } as never, layout: {} }))).toBeNull()
  })

  it('finds the payload in various hash shapes', () => {
    expect(shareFromHash('')).toBeNull()
    expect(shareFromHash('#')).toBeNull()
    expect(shareFromHash('#d=abc')).toBe('abc')
    expect(shareFromHash('#/?d=abc')).toBe('abc')
    expect(shareFromHash('#other=1')).toBeNull()
  })

  it('builds a URL whose hash restores the document into the store', () => {
    const url = buildShareUrl({ schema: schema(), layout: {} }, 'https://example.test/app?e2e=1')
    const hash = new URL(url).hash
    expect(hash.startsWith('#d=')).toBe(true)
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    expect(restoreFromHash(useSchemaStore, hash)).toBe(true)
    expect(useSchemaStore.getState().schema.tables[0].name).toBe('users')
    expect(replace).toHaveBeenCalled()
    expect(restoreFromHash(useSchemaStore, '')).toBe(false)
    expect(restoreFromHash(useSchemaStore, '#d=garbage')).toBe(false)
    replace.mockRestore()
  })

  it('copies the link and warns when it is large', async () => {
    const writes: string[] = []
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void writes.push(t) } })
    useSchemaStore.getState().commit('import', schema())
    const url = await shareCurrent(useSchemaStore)
    expect(writes[0]).toBe(url)

    const big = emptySchema()
    for (let i = 0; i < 400; i++)
      big.tables.push(newTable({ name: `table_${i}_${Math.random()}`, columns: [newColumn({ name: `c${Math.random()}` })] }))
    useSchemaStore.getState().commit('import', big)
    const bigUrl = await shareCurrent(useSchemaStore)
    expect(new TextEncoder().encode(bigUrl).length).toBeGreaterThan(SHARE_WARN_BYTES)
    expect(useToasts).toBeTypeOf('function')
  })
})

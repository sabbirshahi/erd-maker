import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressToEncodedURIComponent } from 'lz-string'
import { emptySchema, newColumn, newId, newTable, type Layout, type Schema } from '@/core/schema'
import { useSchemaStore } from '@/store'
import {
  buildShareUrl,
  decodeShare,
  encodeShare,
  restoreFromHash,
  restoreShortLink,
  shareCurrent,
  shareFromHash,
  shortLinkPending,
} from './share'
import { packShare } from './shareCodec'
import { clearToasts } from './toast'

/** Every toast raised during a test, so the wording the user actually sees can be asserted. */
const { shown } = vi.hoisted(() => ({ shown: [] as Array<{ message: string; kind: string }> }))
vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>()
  return {
    ...actual,
    toast: (message: string, kind: 'info' | 'error' = 'info') => {
      shown.push({ message, kind })
      return actual.toast(message, kind)
    },
  }
})

const SHORT_ID = 'AbCdEfGhIjKlMnOpQrStUv'

/** Every share test states what the network does; none of them reach a real one. */
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** A fetch that fails the test if anything calls it. */
function forbidFetch() {
  const fn = vi.fn(() => {
    throw new Error('the network must not be touched here')
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const schema = () => {
  const s = emptySchema()
  s.tables.push(
    newTable({ name: 'users', columns: [newColumn({ name: 'id', type: 'int', pk: true })] }),
  )
  return s
}

/**
 * A share link carries no ids — the decoder mints fresh ones (see shareCodec.ts) — so round-trip
 * equality is checked on everything else, with ids rewritten to their position in the document.
 */
function normalize(doc: { schema: Schema; layout: Layout }): unknown {
  const at = new Map<string, string>()
  doc.schema.tables.forEach((t, i) => {
    at.set(t.id, `t${i}`)
    t.columns.forEach((c, j) => at.set(c.id, `t${i}c${j}`))
    t.indexes.forEach((ix, j) => at.set(ix.id, `t${i}i${j}`))
  })
  doc.schema.refs.forEach((r, i) => at.set(r.id, `r${i}`))
  doc.schema.enums.forEach((e, i) => {
    at.set(e.id, `e${i}`)
    e.values.forEach((v, j) => at.set(v.id, `e${i}v${j}`))
  })
  const rewrite = (v: unknown): unknown => {
    if (typeof v === 'string') return at.get(v) ?? v
    if (Array.isArray(v)) return v.map(rewrite)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [at.get(k) ?? k, rewrite(val)]))
    return v
  }
  return rewrite(doc)
}

/** A rich document: enums, indexes, notes, django metadata, composite and self-referencing refs. */
function richDoc() {
  const s = emptySchema('shop')
  s.project.note = 'Storefront'
  s.project.passthrough = ['Project shop { database_type: "PostgreSQL" }']
  const id = newColumn({ name: 'id', type: 'int', pk: true, increment: true, notNull: true })
  const email = newColumn({ name: 'email', type: 'varchar(255)', unique: true, notNull: true })
  const status = newColumn({
    name: 'status',
    type: 'user_status',
    default: "'active'",
    note: 'lifecycle',
  })
  const manager = newColumn({ name: 'manager_id', type: 'int' })
  const users = newTable({
    name: 'users',
    schema: 'public',
    alias: 'u',
    note: 'People',
    columns: [id, email, status, manager],
    django: { className: 'User', ordering: ['email'] },
  })
  users.indexes.push({
    id: newId(),
    columnIds: [email.id, status.id],
    unique: true,
    pk: false,
    name: 'uq_user',
  })

  const orderUser = newColumn({ name: 'user_id', type: 'int', notNull: true })
  const orderSeq = newColumn({ name: 'seq', type: 'int', notNull: true })
  const orders = newTable({ name: 'orders', columns: [orderUser, orderSeq] })
  orders.indexes.push({
    id: newId(),
    columnIds: [orderUser.id, orderSeq.id],
    unique: false,
    pk: true,
  })

  s.tables.push(users, orders)
  s.refs.push(
    {
      id: newId(),
      name: 'fk_orders_user',
      from: { tableId: orders.id, columnIds: [orderUser.id] },
      to: { tableId: users.id, columnIds: [id.id] },
      kind: '>',
      onDelete: 'cascade',
      onUpdate: 'no action',
      django: { relatedName: 'orders' },
    },
    {
      id: newId(),
      from: { tableId: users.id, columnIds: [manager.id] },
      to: { tableId: users.id, columnIds: [id.id] },
      kind: '>',
    },
  )
  s.enums.push({
    id: newId(),
    name: 'user_status',
    schema: 'public',
    note: 'Account states',
    values: [
      { id: newId(), name: 'active' },
      { id: newId(), name: 'banned', note: 'no login' },
    ],
  })
  const layout: Layout = { [users.id]: { x: 40, y: 80 }, [orders.id]: { x: 420, y: 80 } }
  return { schema: s, layout }
}

/**
 * A real `#d=` payload produced by the pre-compaction encoder, frozen here on purpose: links in
 * this shape are already out in the world and must keep opening. Two tables, one ref, a layout.
 */
const LEGACY_LINK =
  'N4IgbiBcCMA0IGcDGALApgWwIZVABwCcB7AKzSQBdcQs88AZLAIzQBspEUi8QBfeCs1ZoEUANqgAlgBMOFJqwD6AVwRoCo+ADssGNB1XrNIJEVbKMW0ZAkgZHU0uX3tu-ZDuyBATzzu7WlTweADWUBQEymjwylqSAI5RUABmWKxq2kQUAHLKrOyQEVHwklpIBJhogeGRaPxSsh6OiphYkuyuehyt7SA+fhxgWASowwAUAEwArFMAlH0goSlpGSCxCUmFtZk5eQVF0QHlldWQqel1ALolWtJoAB4i4pf1nnIKinhECBTGOl0eL4-YyOCxWcQNBxmT4uED-fywii+BHVYJhLbFNZxRLuc6rLRZXL5GqY0rHPSnA6vexNaFYZQULgEBbwjj0xlEAiKRHIjilIKLdF4w7rHHLC47In7bZHCoUqhnFZXG53R7WMQva4gCrJdWQjw6xTQBbJYgYaiCBRoACSjRA8iUQN+C1Bllt6pMdIZTJALwERAtQhtdodKjUGhdZjB7vEnqc9j9IBCpTtAD4FkQtAARNhoCj+JBYZBYO58LVVCzqxOsLDeIgMi0fQwRyCge5QAAsAAZ4N4oAAOLv8e0fJ3WNudiZdgB0U17A6HvF4QA'

describe('share links', () => {
  beforeEach(() => {
    useSchemaStore.getState().reset()
    // Reading a link adopts it as a project (session.ts), so each test starts on a clean browser.
    localStorage.clear()
    sessionStorage.clear()
    clearToasts()
    shown.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('encodes and decodes schema + layout', () => {
    const doc = { schema: schema(), layout: { x: { x: 1, y: 2 } } }
    const enc = encodeShare(doc)
    expect(enc).not.toMatch(/[^A-Za-z0-9+\-$]/)
    const back = decodeShare(enc)
    expect(back).not.toBeNull()
    // The layout key `x` names no table, so it is dropped; everything else survives.
    expect(normalize(back!)).toEqual(normalize({ schema: doc.schema, layout: {} }))
    expect(decodeShare('not-valid')).toBeNull()
    expect(decodeShare(encodeShare({ schema: { nope: true } as never, layout: {} }))).toBeNull()
  })

  it('round-trips a document with enums, indexes, notes and django metadata', () => {
    const doc = richDoc()
    const back = decodeShare(encodeShare(doc))
    expect(back).not.toBeNull()
    expect(normalize(back!)).toEqual(normalize(doc))
  })

  it('rounds layout coordinates to whole pixels', () => {
    const doc = richDoc()
    const [first] = doc.schema.tables
    doc.layout[first.id] = { x: 123.456789, y: -9.5 }
    const back = decodeShare(encodeShare(doc))!
    expect(back.layout[back.schema.tables[0].id]).toEqual({ x: 123, y: -9 })
  })

  it('packs far smaller than the original shape', () => {
    const doc = richDoc()
    const before = compressToEncodedURIComponent(
      JSON.stringify({ v: 1, schema: doc.schema, layout: doc.layout }),
    ).length
    const after = encodeShare(doc).length
    expect(after).toBeLessThan(before / 2)
  })

  it('still opens a link made by the previous encoder', () => {
    const doc = decodeShare(LEGACY_LINK)
    expect(doc).not.toBeNull()
    expect(doc!.schema.project.appLabel).toBe('shop')
    expect(doc!.schema.tables.map((t) => t.name)).toEqual(['users', 'posts'])
    // v1 documents carry their own ids, so they keep them rather than being renumbered.
    expect(doc!.schema.tables[0].id).toBe('tbl_users')
    expect(doc!.schema.tables[1].columns[1].name).toBe('author_id')
    expect(doc!.schema.refs[0]).toMatchObject({
      from: { tableId: 'tbl_posts', columnIds: ['col_author'] },
      to: { tableId: 'tbl_users', columnIds: ['col_uid'] },
      kind: '>',
      onDelete: 'cascade',
    })
    expect(doc!.layout).toEqual({ tbl_users: { x: 40, y: 80 }, tbl_posts: { x: 420.5, y: 80 } })

    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    expect(restoreFromHash(useSchemaStore, `#d=${LEGACY_LINK}`)).toBe(true)
    expect(useSchemaStore.getState().schema.tables.map((t) => t.name)).toEqual(['users', 'posts'])
    replace.mockRestore()
  })

  it('carries the diagram name without moving anything a live link depends on', () => {
    const doc = richDoc()
    const unnamed = packShare(doc) as unknown[]
    const named = packShare({ ...doc, name: 'Shop' }) as unknown[]
    // v2 is read by position, so the name is appended: every earlier slot reads exactly as it did
    // before names existed, which is what keeps links already in the wild decoding.
    expect(named[0]).toBe(2)
    expect(named.slice(0, 6)).toEqual(unnamed.slice(0, 6))
    expect(named[6]).toBe('Shop')
    expect(named).toHaveLength(unnamed.length + 1)

    const back = decodeShare(encodeShare({ ...doc, name: 'Shop' }))!
    expect(back.name).toBe('Shop')
    // The document itself is untouched by having been named.
    expect(normalize({ schema: back.schema, layout: back.layout })).toEqual(normalize(doc))
  })

  it('opens a link that carries no name, and invents none', () => {
    // The frozen pre-compaction link below is the case that matters: v1, and named nothing.
    expect(decodeShare(LEGACY_LINK)!.name).toBeUndefined()
    expect(decodeShare(encodeShare(richDoc()))!.name).toBeUndefined()
    // A blank name is the same as no name, rather than an empty string on the wire.
    expect(packShare({ ...richDoc(), name: '   ' })).toEqual(packShare(richDoc()))
  })

  it('falls back to the verbatim shape when a ref cannot be expressed positionally', () => {
    const doc = richDoc()
    doc.schema.refs[0].from.tableId = 'gone'
    const payload = packShare(doc)
    expect(Array.isArray(payload)).toBe(false)
    expect(payload).toMatchObject({ v: 1 })
    // Still decodes, and the dangling ref is preserved rather than quietly dropped.
    const back = decodeShare(encodeShare(doc))!
    expect(back.schema.refs[0].from.tableId).toBe('gone')

    // The name survives that fallback too, so the escape hatch loses nothing but the compaction.
    const namedFallback = packShare({ ...doc, name: 'Shop' })
    expect(namedFallback).toMatchObject({ v: 1, name: 'Shop' })
    expect(decodeShare(encodeShare({ ...doc, name: 'Shop' }))!.name).toBe('Shop')
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

  it('uploads and copies a short link when storage answers', async () => {
    const writes: string[] = []
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void writes.push(t) } })
    const fn = stubFetch(201, { id: SHORT_ID, expiresInDays: 7 })
    useSchemaStore.getState().commit('import', schema())

    const out = await shareCurrent(useSchemaStore)
    expect(out.kind).toBe('short')
    expect(out.url.endsWith(`/s/${SHORT_ID}`)).toBe(true)
    expect(writes[0]).toBe(out.url)
    // The uploaded body is the compressed payload, not the raw schema.
    const [, init] = fn.mock.calls[0]
    const live = useSchemaStore.getState()
    expect(init.body).toBe(encodeShare({ schema: live.schema, layout: live.layout }))
    expect(shown).toEqual([
      {
        message: 'Share link copied — the diagram is uploaded and deleted after 7 days',
        kind: 'info',
      },
    ])
  })

  it('falls back to a self-contained link when no storage is configured', async () => {
    const writes: string[] = []
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void writes.push(t) } })
    stubFetch(503, { error: 'storage-not-configured' })
    useSchemaStore.getState().commit('import', schema())

    const out = await shareCurrent(useSchemaStore)
    expect(out.kind).toBe('inline')
    expect(out.reason).toBe('unavailable')
    expect(new URL(out.url).hash.startsWith('#d=')).toBe(true)
    expect(writes[0]).toBe(out.url)
    expect(shown[0].message).toBe(
      'Share link copied — nothing was uploaded, so the whole diagram is inside this long link',
    )
    // The fallback link really does carry the document.
    expect(decodeShare(new URL(out.url).hash.slice(3))).not.toBeNull()
  })

  it('keeps "Share link copied" in every success toast, which the e2e suite filters on', async () => {
    Object.assign(navigator, { clipboard: { writeText: async () => {} } })
    for (const [status, body] of [
      [201, { id: SHORT_ID }],
      [503, { error: 'storage-not-configured' }],
      [413, { error: 'payload-too-large' }],
    ] as const) {
      shown.length = 0
      stubFetch(status, body)
      useSchemaStore.getState().commit('import', schema())
      await shareCurrent(useSchemaStore)
      expect(shown[0].message).toContain('Share link copied')
    }
  })

  it('puts the diagram name in the link it copies', async () => {
    Object.assign(navigator, { clipboard: { writeText: async () => {} } })
    stubFetch(503, { error: 'storage-not-configured' })
    useSchemaStore.getState().commit('import', schema())

    const out = await shareCurrent(useSchemaStore, 'Shop')
    expect(decodeShare(new URL(out.url).hash.slice(3))!.name).toBe('Shop')
    // Sharing from an unnamed diagram is still a link, just an unnamed one.
    const anon = await shareCurrent(useSchemaStore)
    expect(decodeShare(new URL(anon.url).hash.slice(3))!.name).toBeUndefined()
  })

  it('says so when the diagram is too large to upload', async () => {
    Object.assign(navigator, { clipboard: { writeText: async () => {} } })
    stubFetch(413, { error: 'payload-too-large' })
    useSchemaStore.getState().commit('import', schema())

    const out = await shareCurrent(useSchemaStore)
    expect(out.kind).toBe('inline')
    expect(out.reason).toBe('too-large')
    expect(shown[0].message).toBe(
      'Share link copied — too large to upload, so the whole diagram is inside this long link',
    )
  })

  it('opens a short link by fetching it', async () => {
    const payload = encodeShare(richDoc())
    stubFetch(200, { p: payload })
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {})

    await expect(restoreShortLink(useSchemaStore, `/s/${SHORT_ID}`)).resolves.toBe(true)
    expect(useSchemaStore.getState().schema.tables.map((t) => t.name)).toEqual(['users', 'orders'])
    expect(replace).toHaveBeenCalled()
    replace.mockRestore()
  })

  it('tells the user when a short link has expired', async () => {
    stubFetch(404, { error: 'not-found' })
    await expect(restoreShortLink(useSchemaStore, `/s/${SHORT_ID}`)).resolves.toBe(false)
    expect(shown[0]).toEqual({
      message: 'This share link has expired or does not exist',
      kind: 'error',
    })
  })

  it('knows a short link is coming from the URL alone, with no request', () => {
    const fn = forbidFetch()
    expect(shortLinkPending(`/s/${SHORT_ID}`)).toBe(true)
    expect(shortLinkPending('/')).toBe(false)
    expect(shortLinkPending('/s/broken')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('never touches the network to open a legacy link', async () => {
    const fn = forbidFetch()
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {})

    expect(decodeShare(LEGACY_LINK)).not.toBeNull()
    expect(restoreFromHash(useSchemaStore, `#d=${LEGACY_LINK}`)).toBe(true)
    expect(useSchemaStore.getState().schema.tables.map((t) => t.name)).toEqual(['users', 'posts'])
    expect(fn).not.toHaveBeenCalled()

    // And neither does a link this build produced.
    await expect(restoreShortLink(useSchemaStore, '/')).resolves.toBe(false)
    expect(fn).not.toHaveBeenCalled()
    replace.mockRestore()
  })
})

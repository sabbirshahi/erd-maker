/**
 * Boot and adoption.
 *
 * The rule this file exists to hold: opening a share link must never cost the recipient a diagram
 * they already had. A link is opened by someone with their own work in this browser, so the shared
 * document arrives as a NEW project — the same rule restoreBackup follows, for the same reason.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { emptySchema, newTable, type Schema } from '@/core/schema'

const SHORT_ID = 'AbCdEfGhIjKlMnOpQrStUv'

const schemaWith = (...names: string[]): Schema => {
  const s = emptySchema()
  for (const n of names) s.tables.push(newTable({ name: n }))
  return s
}
const state = (s: Schema) => ({ schema: s, layout: {}, dbmlText: null })

/**
 * A page load, as a fresh module graph: session.ts memoises the session and projects.ts holds the
 * index listeners, so a second boot in the same test file would otherwise reuse the first one.
 * Everything is imported from the same graph, so the store the session writes is the store the
 * test reads. localStorage is deliberately NOT reset — that is the browser surviving a reload.
 */
async function load() {
  vi.resetModules()
  const [session, projects, share, store] = await Promise.all([
    import('./session'),
    import('./projects'),
    import('./share'),
    import('@/store'),
  ])
  return { session, projects, share, store: store.useSchemaStore }
}

/** Every controller a test boots, disposed afterwards so no autosave timer outlives it. */
const opened: Array<{ controller: { dispose: () => void } }> = []
const boot = (m: Awaited<ReturnType<typeof load>>, restored: boolean) => {
  const s = m.session.bootSession(restored)
  opened.push(s)
  return s
}

describe('opening a share link', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    history.replaceState(null, '', '/')
  })
  afterEach(() => {
    for (const s of opened.splice(0)) s.controller.dispose()
    vi.unstubAllGlobals()
  })

  it('leaves the diagram the recipient already had untouched (#d= link)', async () => {
    const m = await load()
    const mine = m.projects.createProject('My work', state(schemaWith('customers')))

    const link = m.share.encodeShare({ schema: schemaWith('shared_table'), layout: {} })
    const applied = m.share.restoreFromHash(m.store, `#d=${link}`)
    const session = boot(m, applied)

    // The diagram that was already here is still there, and still readable.
    expect(m.projects.readProject(mine.id)?.schema.tables.map((t) => t.name)).toEqual(['customers'])
    // The shared one arrived as its own project, and it is the one on screen.
    expect(session.activeId).not.toBe(mine.id)
    expect(m.projects.listProjects()).toHaveLength(2)
    expect(m.projects.readProject(session.activeId)?.schema.tables.map((t) => t.name)).toEqual(['shared_table'])
    expect(m.store.getState().schema.tables.map((t) => t.name)).toEqual(['shared_table'])
  })

  it('leaves it untouched when the document arrives after boot (/s/ link)', async () => {
    const m = await load()
    const mine = m.projects.createProject('My work', state(schemaWith('customers')))
    m.session.setTabProject(mine.id)

    // A short link cannot be resolved before render, so the tab boots on its own diagram first.
    const session = boot(m, m.share.shortLinkPending(`/s/${SHORT_ID}`))
    expect(session.activeId).toBe(mine.id)

    const payload = m.share.encodeShare({ schema: schemaWith('shared_table'), layout: {} })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ p: payload }) })),
    )
    await expect(m.share.restoreShortLink(m.store, `/s/${SHORT_ID}`)).resolves.toBe(true)

    expect(m.projects.readProject(mine.id)?.schema.tables.map((t) => t.name)).toEqual(['customers'])
    expect(m.projects.listProjects()).toHaveLength(2)
    expect(session.activeId).not.toBe(mine.id)
    expect(m.projects.readProject(session.activeId)?.schema.tables.map((t) => t.name)).toEqual(['shared_table'])
    expect(m.store.getState().schema.tables.map((t) => t.name)).toEqual(['shared_table'])
  })

  it('names the new project after the shared diagram', async () => {
    const m = await load()
    const link = m.share.encodeShare({ schema: schemaWith('orders'), layout: {}, name: 'Shop' })
    const session = boot(m, m.share.restoreFromHash(m.store, `#d=${link}`))
    expect(m.projects.listProjects().find((p) => p.id === session.activeId)?.name).toBe('Shop')
  })

  it('falls back to the default name for a link that carries none', async () => {
    const m = await load()
    const link = m.share.encodeShare({ schema: schemaWith('orders'), layout: {} })
    const session = boot(m, m.share.restoreFromHash(m.store, `#d=${link}`))
    expect(m.projects.listProjects().find((p) => p.id === session.activeId)?.name).toBe(
      m.projects.DEFAULT_PROJECT_NAME,
    )
  })

  it('reopens the adopted diagram on the next load instead of adopting it twice', async () => {
    const first = await load()
    const link = first.share.encodeShare({ schema: schemaWith('orders'), layout: {}, name: 'Shop' })
    const adopted = boot(first, first.share.restoreFromHash(first.store, `#d=${link}`))

    // The share was taken out of the address bar as it was read, so reloading is an ordinary load.
    const again = await load()
    const reopened = boot(again, again.share.restoreFromHash(again.store, location.hash))

    expect(reopened.activeId).toBe(adopted.activeId)
    expect(again.projects.listProjects()).toHaveLength(1)
  })
})

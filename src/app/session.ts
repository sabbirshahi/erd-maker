/**
 * Boot-time wiring for projects: pick the active project, put it in the store, and start the
 * save controller that the top bar drives. One instance per page.
 */
import { useSchemaStore } from '@/store'
import type { Layout, Schema } from '@/core/schema'
import { isEmbed } from './embed'
import {
  DEFAULT_PROJECT_NAME,
  adoptLegacyDocument,
  createProject,
  ensureProjects,
  listProjects,
  readProject,
} from './projects'
import { createSaveController, type SaveController } from './saveController'

export interface Session {
  /** The project this tab is editing. Changes when a share link is adopted after boot. */
  activeId: string
  controller: SaveController
}

/** A diagram that arrived from outside this browser: the payload of a share link. */
export interface IncomingDiagram {
  schema: Schema
  layout: Layout
  /** What the sender called it. Old links carry no name; the default stands in for them. */
  name?: string
}

/**
 * Which project THIS TAB is working on. Tab-scoped on purpose: the project list and the documents
 * are shared across tabs, but switching project in one tab must not yank another tab's canvas, so
 * the active id lives in sessionStorage rather than in the shared index.
 */
export const TAB_KEY = 'dbridge:tab-project'

/** Query parameter naming the project, so a diagram has its own shareable, bookmarkable URL. */
export const PROJECT_PARAM = 'p'

export function projectFromUrl(search = location.search): string | null {
  try {
    return new URLSearchParams(search).get(PROJECT_PARAM)
  } catch {
    return null
  }
}

/** Put `id` in the address bar without adding a history entry for every switch. */
export function setProjectUrl(id: string): void {
  if (isEmbed()) return
  try {
    const url = new URL(location.href)
    if (url.searchParams.get(PROJECT_PARAM) === id) return
    url.searchParams.set(PROJECT_PARAM, id)
    history.replaceState(history.state, '', url)
  } catch {
    /* non-browser or blocked history: the app still works, the URL just stays put */
  }
}

export function getTabProject(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY)
  } catch {
    return null
  }
}

export function setTabProject(id: string): void {
  try {
    if (!isEmbed()) sessionStorage.setItem(TAB_KEY, id)
  } catch {
    /* private mode: the tab just resolves its project again on the next load */
  }
  setProjectUrl(id)
}

let session: Session | null = null

/**
 * Told when this tab changes project without the user asking — which is only ever a `/s/<id>`
 * link, whose document arrives after the shell has already rendered the previous diagram.
 */
const activeListeners = new Set<(id: string) => void>()

export function subscribeActiveProject(onChange: (id: string) => void): () => void {
  activeListeners.add(onChange)
  // Told the current answer as it subscribes: a link can land between a component rendering and
  // its effect running, and a subscriber that only hears about later changes would miss that one.
  if (session) onChange(session.activeId)
  return () => void activeListeners.delete(onChange)
}

/**
 * Adopt a diagram that arrived from outside this browser as a NEW project, and open it.
 *
 * Nothing already in the browser is written to. A share link is opened by someone who has their
 * own diagrams here, and adopting into the active project destroyed whichever one that was — the
 * same mistake restore was fixed for, and for the same reason (see backup.ts). The shared diagram
 * is activated, because asking for the link is asking to see it.
 *
 * Returns null in embed mode, where there are no projects at all: the document is put in the
 * store and nothing is written to the visitor's browser.
 */
export function adoptShare(doc: IncomingDiagram, store = useSchemaStore): Session | null {
  const show = () => store.getState().load({ schema: doc.schema, layout: doc.layout })
  if (isEmbed()) {
    show()
    return null
  }

  // Whatever an older build left behind becomes a project first, so the share does not end up the
  // only diagram this browser can see.
  adoptLegacyDocument()

  const meta = createProject(doc.name ?? DEFAULT_PROJECT_NAME, {
    schema: doc.schema,
    layout: doc.layout,
    dbmlText: null,
  })
  setTabProject(meta.id)
  if (session) {
    // Autosave is pointed at the new project BEFORE the store changes; the other order saves the
    // arriving diagram over the one this tab had open, which is the whole bug.
    session.controller.setProject(meta.id)
    session.activeId = meta.id
    for (const l of [...activeListeners]) l(meta.id)
    show()
    return session
  }
  // Before boot: the document goes in first, so the controller starts on a document that is
  // already saved rather than announcing an unsaved change it would only write back unchanged.
  show()
  session = { activeId: meta.id, controller: createSaveController(store, meta.id) }
  return session
}

/**
 * @param restored true when a share link has already put a document in the store, so nothing
 *                 stored may be loaded over it. A share link creates its own project — see
 *                 adoptShare, which has already run by the time this is called with true.
 */
export function bootSession(restored = false): Session {
  if (session) return session
  const store = useSchemaStore.getState()

  // Embed mode reads; it never creates a project and never arms autosave. ensureProjects() would
  // write an index into the visitor's browser just by being called, so it is skipped entirely.
  if (isEmbed()) {
    const urlId = projectFromUrl()
    const doc = !restored && urlId ? readProject(urlId) : null
    if (doc) store.load({ schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined })
    session = {
      activeId: urlId ?? '',
      controller: createSaveController(useSchemaStore, urlId ?? '', localStorage, undefined, false),
    }
    return session
  }

  const meta = ensureProjects()

  // A project URL wins: /?p=<id> opens that diagram directly, so it can be bookmarked and shared
  // with anyone using the same browser profile.
  const urlId = projectFromUrl()
  const urlDoc = urlId ? readProject(urlId) : null
  if (urlId && urlDoc) {
    setTabProject(urlId)
    store.load({ schema: urlDoc.schema, layout: urlDoc.layout, dbmlText: urlDoc.dbmlText ?? undefined })
    session = { activeId: urlId, controller: createSaveController(useSchemaStore, urlId) }
    return session
  }

  // This tab already has a project (sessionStorage survives a reload): reopen that one.
  const tabId = getTabProject()
  const tabDoc = tabId ? readProject(tabId) : null
  if (tabId && tabDoc) {
    setProjectUrl(tabId)
    store.load({ schema: tabDoc.schema, layout: tabDoc.layout, dbmlText: tabDoc.dbmlText ?? undefined })
    session = { activeId: tabId, controller: createSaveController(useSchemaStore, tabId) }
    return session
  }

  // A new tab opens the diagram worked on most recently; the project menu in the top bar is how you
  // move to another one. Nothing is asked on load.
  const recent = listProjects().find((p) => (readProject(p.id)?.schema.tables.length ?? 0) > 0)
  const open = recent ?? meta
  const doc = readProject(open.id)
  setTabProject(open.id)
  if (doc) store.load({ schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined })
  session = { activeId: open.id, controller: createSaveController(useSchemaStore, open.id) }
  return session
}

export function getSession(): Session {
  return session ?? bootSession()
}

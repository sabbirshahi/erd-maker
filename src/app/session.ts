/**
 * Boot-time wiring for projects: pick the active project, put it in the store, and start the
 * save controller that the top bar drives. One instance per page.
 */
import { useSchemaStore } from '@/store'
import { ensureProjects, listProjects, readProject, writeProject } from './projects'
import { createSaveController, type SaveController } from './saveController'

export interface Session {
  activeId: string
  controller: SaveController
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
    sessionStorage.setItem(TAB_KEY, id)
  } catch {
    /* private mode: the tab just resolves its project again on the next load */
  }
  setProjectUrl(id)
}

let session: Session | null = null

/**
 * @param restored true when a share link already populated the store; the schema is then adopted
 *                 as the active project's content instead of being overwritten by it.
 */
export function bootSession(restored = false): Session {
  if (session) return session
  const meta = ensureProjects()
  const store = useSchemaStore.getState()

  if (restored) {
    // A shared diagram was opened: keep it and save it into the active project.
    writeProject(meta.id, { schema: store.schema, layout: store.layout, dbmlText: store.dbmlText })
    setTabProject(meta.id)
    session = {
      activeId: meta.id,
      controller: createSaveController(useSchemaStore, meta.id),
    }
    return session
  }

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

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
  /**
   * True when the app opened on its own URL and should ask which diagram to work on. A share link
   * carries its own diagram, so it opens straight into the canvas.
   */
  needsLauncher: boolean
}

/**
 * Which project THIS TAB is working on. Tab-scoped on purpose: the project list and the documents
 * are shared across tabs, but switching project in one tab must not yank another tab's canvas, so
 * the active id lives in sessionStorage rather than in the shared index.
 */
export const TAB_KEY = 'erd-maker:tab-project'

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
    /* private mode: the tab simply falls back to asking again next time */
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
      needsLauncher: false,
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
    session = { activeId: urlId, controller: createSaveController(useSchemaStore, urlId), needsLauncher: false }
    return session
  }

  // This tab already chose a project (sessionStorage survives a reload): reopen it rather than
  // asking again. Only a tab that has never chosen one sees the launcher.
  const tabId = getTabProject()
  const tabDoc = tabId ? readProject(tabId) : null
  if (tabId && tabDoc) {
    setProjectUrl(tabId)
    store.load({ schema: tabDoc.schema, layout: tabDoc.layout, dbmlText: tabDoc.dbmlText ?? undefined })
    session = { activeId: tabId, controller: createSaveController(useSchemaStore, tabId), needsLauncher: false }
    return session
  }

  // No project for this tab yet. Only ask which one to open when there is actually something to
  // choose between: on a first run the user gets a blank canvas, not a dialog.
  const choices = listProjects().filter((p) => (readProject(p.id)?.schema.tables.length ?? 0) > 0)
  if (choices.length === 0) {
    setTabProject(meta.id)
    session = { activeId: meta.id, controller: createSaveController(useSchemaStore, meta.id), needsLauncher: false }
    return session
  }

  // Saved diagrams exist but this tab has not picked one. The canvas stays empty and the controller
  // starts paused, so autosave cannot write that empty state over a project the user has not opened.
  session = {
    activeId: meta.id,
    controller: createSaveController(useSchemaStore, meta.id, localStorage, undefined, false),
    needsLauncher: true,
  }
  return session
}

export function getSession(): Session {
  return session ?? bootSession()
}

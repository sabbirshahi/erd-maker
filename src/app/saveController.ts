/**
 * Save state for the active project.
 *
 * Work is never lost: edits are autosaved into the active project after a short idle, and flushed
 * on `pagehide`. The Save button is an explicit checkpoint on top of that — it writes immediately
 * and reports the result, so "saved" is something the user can see rather than assume.
 */
import type { useSchemaStore } from '@/store'
import { writeProject, type ProjectState } from './projects'

export const AUTOSAVE_DEBOUNCE_MS = 800

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

export interface SaveController {
  status: SaveStatus
  lastSavedAt: string | null
  /** Write now. Returns false when storage rejected it (quota, private mode). */
  save: () => boolean
  /** Point the controller at another project (after switching or creating one). */
  setProject: (id: string) => void
  subscribe: (listener: () => void) => () => void
  dispose: () => void
}

type Store = typeof useSchemaStore

const snapshot = (store: Store): ProjectState => {
  const s = store.getState()
  return { schema: s.schema, layout: s.layout, dbmlText: s.dbmlText }
}

export function createSaveController(
  store: Store,
  projectId: string,
  storage: Storage = localStorage,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  /**
   * Start paused. At boot the store is empty until the user picks a project in the launcher;
   * autosaving that empty state would overwrite whichever project was last active. `setProject`
   * arms the controller.
   */
  armed = true,
): SaveController {
  let id = projectId
  let active = armed
  let status: SaveStatus = 'saved'
  let lastSavedAt: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = store.getState()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const setStatus = (next: SaveStatus) => {
    if (status === next) return
    status = next
    notify()
  }

  function save(): boolean {
    if (!active) return true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    setStatus('saving')
    const ok = writeProject(id, snapshot(store), storage)
    if (ok) {
      lastSavedAt = new Date().toISOString()
      status = 'saved'
    } else {
      status = 'error'
    }
    notify()
    return ok
  }

  const unsub = store.subscribe((s) => {
    if (!active) return
    if (s.schema === last.schema && s.layout === last.layout && s.dbmlText === last.dbmlText) return
    last = s
    setStatus('unsaved')
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      save()
    }, debounceMs)
  })

  const onHide = () => {
    if (timer) save()
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide)

  return {
    get status() {
      return status
    },
    get lastSavedAt() {
      return lastSavedAt
    },
    save,
    setProject(next: string) {
      // Persist the outgoing project before following the switch.
      if (timer) save()
      id = next
      active = true
      last = store.getState()
      status = 'saved'
      lastSavedAt = null
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      unsub()
      if (timer) clearTimeout(timer)
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide)
      listeners.clear()
    },
  }
}

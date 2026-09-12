/**
 * Save state for the active project.
 *
 * Work is never lost: edits are autosaved into the active project after a short idle, and flushed
 * on `pagehide`. The Save button is an explicit checkpoint on top of that — it writes immediately
 * and reports the result, so "saved" is something the user can see rather than assume.
 */
import type { useSchemaStore } from '@/store'
import { isEmbed } from './embed'
import { readProject, writeProject, type ProjectState } from './projects'

export const AUTOSAVE_DEBOUNCE_MS = 800

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

export interface SaveController {
  status: SaveStatus
  lastSavedAt: string | null
  /**
   * Write now. Returns false when storage rejected it (quota, private mode) or when another tab
   * has saved this project since we last read it — pass `force` to overwrite that deliberately.
   */
  save: (force?: boolean) => boolean
  /** Called when a save was refused because another tab got there first. */
  onConflict?: (handler: () => void) => void
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
   * Start paused, for a controller created before its project's document is in the store:
   * autosaving that empty state would overwrite the project. `setProject` arms it.
   */
  armed = true,
): SaveController {
  let id = projectId
  // Embed mode never arms, and setProject cannot re-arm it: nothing an embedded diagram does may
  // reach the visitor's storage.
  let active = armed && !isEmbed()
  /**
   * Revision of the document this tab last read or wrote. Saving compares it with what is in
   * storage: if another tab wrote in between, this tab's save would silently discard that work,
   * so it is refused and reported instead.
   */
  let base: number | null = readProject(projectId, storage)?.rev ?? null
  let conflictHandler: (() => void) | null = null
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

  function save(force = false): boolean {
    if (!active) return true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const stored = readProject(id, storage)
    if (!force && stored && base !== null && stored.rev !== base) {
      status = 'conflict'
      notify()
      conflictHandler?.()
      return false
    }
    setStatus('saving')
    const ok = writeProject(id, snapshot(store), storage)
    if (ok) {
      const written = readProject(id, storage)
      base = written?.rev ?? null
      lastSavedAt = written?.savedAt ?? null
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
      active = !isEmbed()
      last = store.getState()
      base = readProject(next, storage)?.rev ?? null
      status = 'saved'
      lastSavedAt = null
      notify()
    },
    onConflict(handler) {
      conflictHandler = handler
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

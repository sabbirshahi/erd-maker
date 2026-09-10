/**
 * Autosave `{ schema, layout, dbmlText }` to localStorage (debounced) and restore on boot.
 * Versioned key with a migration stub for future IR changes.
 */
import type { Layout, Schema } from '@/core/schema'
import type { useSchemaStore } from '@/store'

export const DOC_KEY = 'erd-maker:doc:v1'
export const DOC_VERSION = 1
export const AUTOSAVE_DEBOUNCE_MS = 500

export interface SavedDoc {
  v: number
  savedAt: string
  schema: Schema
  layout: Layout
  dbmlText: string | null
}

type Store = typeof useSchemaStore

function isSchemaLike(x: unknown): x is Schema {
  if (!x || typeof x !== 'object') return false
  const s = x as Record<string, unknown>
  return Array.isArray(s.tables) && Array.isArray(s.refs) && Array.isArray(s.enums) && typeof s.project === 'object'
}

/** Upgrade older documents to the current shape. Returns null for unusable input. */
export function migrateDoc(raw: unknown): SavedDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<SavedDoc> & Record<string, unknown>
  const v = typeof d.v === 'number' ? d.v : 0
  // v0 (pre-versioned) and v1 share the same shape; future versions add cases here.
  if (v > DOC_VERSION) return null
  if (!isSchemaLike(d.schema)) return null
  return {
    v: DOC_VERSION,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date(0).toISOString(),
    schema: d.schema,
    layout: d.layout && typeof d.layout === 'object' ? (d.layout as Layout) : {},
    dbmlText: typeof d.dbmlText === 'string' ? d.dbmlText : null,
  }
}

export function serializeDoc(state: { schema: Schema; layout: Layout; dbmlText: string | null }): SavedDoc {
  return {
    v: DOC_VERSION,
    savedAt: new Date().toISOString(),
    schema: state.schema,
    layout: state.layout,
    dbmlText: state.dbmlText,
  }
}

export function saveDoc(state: { schema: Schema; layout: Layout; dbmlText: string | null }, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(DOC_KEY, JSON.stringify(serializeDoc(state)))
    return true
  } catch {
    return false
  }
}

export function loadDoc(storage: Storage = localStorage): SavedDoc | null {
  try {
    const raw = storage.getItem(DOC_KEY)
    if (!raw) return null
    return migrateDoc(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearDoc(storage: Storage = localStorage) {
  try {
    storage.removeItem(DOC_KEY)
  } catch {
    /* ignore */
  }
}

/** Restore a saved document into the store. Returns true when something was loaded. */
export function restoreDoc(store: Store, storage: Storage = localStorage): boolean {
  const doc = loadDoc(storage)
  if (!doc || doc.schema.tables.length === 0) return false
  store.getState().load({ schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined })
  return true
}

/**
 * Subscribe to the store and persist schema/layout/dbmlText changes, debounced.
 * Returns an unsubscribe function. Flushes pending writes on `pagehide`.
 */
export function startAutosave(store: Store, storage: Storage = localStorage, debounceMs = AUTOSAVE_DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = store.getState()

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const s = store.getState()
    saveDoc({ schema: s.schema, layout: s.layout, dbmlText: s.dbmlText }, storage)
  }

  const unsub = store.subscribe((s) => {
    if (s.schema === last.schema && s.layout === last.layout && s.dbmlText === last.dbmlText) return
    last = s
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  })

  const onHide = () => {
    if (timer) flush()
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide)

  return () => {
    unsub()
    if (timer) clearTimeout(timer)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide)
  }
}

/**
 * Named projects: several diagrams in one browser, each with its own schema, layout and DBML text.
 *
 * Storage layout (localStorage):
 *   dbridge:projects:v1   -> { v, activeId, projects: ProjectMeta[] }     (small index)
 *   dbridge:project:<id>  -> SavedDoc                                      (one per project)
 *
 * The index is kept separate from the documents so switching projects and renaming never rewrites
 * every diagram. A pre-projects document is migrated into the first project, and keys written
 * under the old `erd-maker:` prefix are adopted on load.
 */
import { nanoid } from 'nanoid'
import type { Layout, Schema } from '@/core/schema'
import { isEmbed } from './embed'
import { DOC_KEY, migrateDoc, serializeDoc, type SavedDoc } from './persistence'

export const INDEX_KEY = 'dbridge:projects:v1'
export const PROJECT_KEY_PREFIX = 'dbridge:project:'
export const INDEX_VERSION = 1
export const DEFAULT_PROJECT_NAME = 'Untitled diagram'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ProjectIndex {
  v: number
  activeId: string | null
  projects: ProjectMeta[]
}

export interface ProjectState {
  schema: Schema
  layout: Layout
  dbmlText: string | null
}

/**
 * The index is shared mutable state: the diagram menu reads it, but restore, autosave and the
 * project actions all write it, from three different components. Without a notification a writer's
 * change was invisible until the page reloaded — restoring a backup said "3 diagrams imported" and
 * then showed none of them. Readers subscribe here instead of caching a list at mount.
 */
let revision = 0
const listeners = new Set<() => void>()

export function subscribeProjects(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => void listeners.delete(onChange)
}

/** Changes on every index write; a stable value to hang useSyncExternalStore off. */
export function projectsRevision(): number {
  return revision
}

function announce(): void {
  revision++
  // Copied: a listener may unsubscribe while being notified.
  for (const l of [...listeners]) l()
}

const emptyIndex = (): ProjectIndex => ({ v: INDEX_VERSION, activeId: null, projects: [] })
const projectKey = (id: string) => `${PROJECT_KEY_PREFIX}${id}`
const now = () => new Date().toISOString()

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(storage: Storage, key: string, value: unknown): boolean {
  // An embedded diagram must not leave anything in the visitor's browser. Guarded here rather than
  // at the call sites so a new caller cannot forget.
  if (isEmbed()) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Quota exceeded or storage disabled: callers surface this to the user.
    return false
  }
}

function isMeta(x: unknown): x is ProjectMeta {
  const m = x as Record<string, unknown> | null
  return !!m && typeof m.id === 'string' && typeof m.name === 'string'
}

/** Read the index, repairing anything malformed. Never throws. */
export function readIndex(storage: Storage = localStorage): ProjectIndex {
  const raw = read<Partial<ProjectIndex>>(storage, INDEX_KEY)
  if (!raw || !Array.isArray(raw.projects)) return emptyIndex()
  const projects = raw.projects.filter(isMeta).map((p) => ({
    id: p.id,
    name: p.name || DEFAULT_PROJECT_NAME,
    createdAt: p.createdAt ?? new Date(0).toISOString(),
    updatedAt: p.updatedAt ?? p.createdAt ?? new Date(0).toISOString(),
  }))
  const activeId = typeof raw.activeId === 'string' && projects.some((p) => p.id === raw.activeId) ? raw.activeId : (projects[0]?.id ?? null)
  return { v: INDEX_VERSION, activeId, projects }
}

export function writeIndex(index: ProjectIndex, storage: Storage = localStorage): boolean {
  const ok = write(storage, INDEX_KEY, { ...index, v: INDEX_VERSION })
  if (ok) announce()
  return ok
}

/** Projects newest-updated first. */
export function listProjects(storage: Storage = localStorage): ProjectMeta[] {
  return [...readIndex(storage).projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readProject(id: string, storage: Storage = localStorage): SavedDoc | null {
  return migrateDoc(read<unknown>(storage, projectKey(id)))
}

/** Persist a project's content and stamp `updatedAt` in the index. */
export function writeProject(id: string, state: ProjectState, storage: Storage = localStorage): boolean {
  // Bump the revision so other tabs can tell this write apart from the one they last saw.
  const rev = (readProject(id, storage)?.rev ?? 0) + 1
  const ok = write(storage, projectKey(id), serializeDoc(state, rev))
  if (!ok) return false
  const index = readIndex(storage)
  const meta = index.projects.find((p) => p.id === id)
  if (meta) {
    meta.updatedAt = now()
    writeIndex(index, storage)
  }
  return true
}

export function createProject(
  name = DEFAULT_PROJECT_NAME,
  state: ProjectState | null = null,
  storage: Storage = localStorage,
  /** Restore adds diagrams in bulk and must leave the user on the one they were editing. */
  activate = true,
): ProjectMeta {
  const meta: ProjectMeta = { id: nanoid(10), name: name.trim() || DEFAULT_PROJECT_NAME, createdAt: now(), updatedAt: now() }
  const index = readIndex(storage)
  index.projects.push(meta)
  if (activate || index.activeId === null) index.activeId = meta.id
  writeIndex(index, storage)
  if (state) write(storage, projectKey(meta.id), serializeDoc(state))
  return meta
}

export function renameProject(id: string, name: string, storage: Storage = localStorage): boolean {
  const index = readIndex(storage)
  const meta = index.projects.find((p) => p.id === id)
  if (!meta) return false
  meta.name = name.trim() || DEFAULT_PROJECT_NAME
  meta.updatedAt = now()
  return writeIndex(index, storage)
}

/** Copy a project's content under a new name; the copy becomes active. */
export function duplicateProject(id: string, storage: Storage = localStorage): ProjectMeta | null {
  const index = readIndex(storage)
  const meta = index.projects.find((p) => p.id === id)
  if (!meta) return null
  const doc = readProject(id, storage)
  const copy = createProject(`${meta.name} copy`, doc ? { schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText } : null, storage)
  return copy
}

/** Remove a project and its document. Returns the id that should become active. */
export function deleteProject(id: string, storage: Storage = localStorage): string | null {
  const index = readIndex(storage)
  const at = index.projects.findIndex((p) => p.id === id)
  if (at === -1) return index.activeId
  index.projects.splice(at, 1)
  if (index.activeId === id) index.activeId = index.projects[Math.max(0, at - 1)]?.id ?? null
  writeIndex(index, storage)
  try {
    if (!isEmbed()) storage.removeItem(projectKey(id))
  } catch {
    /* ignore */
  }
  return index.activeId
}

export function setActiveProject(id: string, storage: Storage = localStorage): boolean {
  const index = readIndex(storage)
  if (!index.projects.some((p) => p.id === id)) return false
  index.activeId = id
  return writeIndex(index, storage)
}

export function activeProject(storage: Storage = localStorage): ProjectMeta | null {
  const index = readIndex(storage)
  return index.projects.find((p) => p.id === index.activeId) ?? null
}

/** Prefix used before the product was renamed to DBridge. */
const LEGACY_PREFIX = 'erd-maker:'

/**
 * Copy anything still saved under the old `erd-maker:` prefix across to `dbridge:`.
 *
 * The rename would otherwise orphan real diagrams sitting in someone's browser. Only keys the new
 * prefix does not already have are copied, and the originals are left untouched so an older build
 * still opens. Safe to run on every boot, and safe to delete after a release or two.
 */
export function migrateLegacyKeys(storage: Storage = localStorage): number {
  let copied = 0
  if (isEmbed()) return 0
  try {
    const legacy: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key)
    }
    for (const key of legacy) {
      const next = `dbridge:${key.slice(LEGACY_PREFIX.length)}`
      if (storage.getItem(next) !== null) continue
      const value = storage.getItem(key)
      if (value === null) continue
      storage.setItem(next, value)
      copied++
    }
  } catch {
    // Storage unavailable (private mode, quota): nothing to migrate, and not worth failing boot.
  }
  return copied
}

/**
 * Bring anything an older build left behind into the project index: keys under the `erd-maker:`
 * prefix, and the pre-projects single document. Returns the project that document became, or null
 * when there was nothing to adopt.
 *
 * A no-op once this browser has any project at all, so it can be called on every boot — including
 * the boot that opens a share link, which must not leave a pre-projects diagram stranded outside
 * the menu.
 */
export function adoptLegacyDocument(storage: Storage = localStorage): ProjectMeta | null {
  migrateLegacyKeys(storage)
  if (readIndex(storage).projects.length > 0) return null
  const legacy = migrateDoc(read<unknown>(storage, DOC_KEY))
  if (!legacy) return null
  return createProject(
    legacy.schema.tables.length > 0 ? 'My diagram' : DEFAULT_PROJECT_NAME,
    { schema: legacy.schema, layout: legacy.layout, dbmlText: legacy.dbmlText },
    storage,
  )
}

/**
 * Ensure at least one project exists and one is active, adopting a pre-projects document if found.
 * Safe to call on every boot.
 */
export function ensureProjects(storage: Storage = localStorage): ProjectMeta {
  const adopted = adoptLegacyDocument(storage)
  if (adopted) return adopted
  const index = readIndex(storage)
  const current = index.projects.find((p) => p.id === index.activeId)
  if (current) return current
  if (index.projects.length > 0) {
    index.activeId = index.projects[0].id
    writeIndex(index, storage)
    return index.projects[0]
  }
  return createProject(DEFAULT_PROJECT_NAME, null, storage)
}

/** A diagram's name, defaulted for a project that has no index entry (embed, or a deleted one). */
export function projectName(id: string, storage: Storage = localStorage): string {
  return readIndex(storage).projects.find((p) => p.id === id)?.name ?? DEFAULT_PROJECT_NAME
}

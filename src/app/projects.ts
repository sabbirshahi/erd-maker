/**
 * Named projects: several diagrams in one browser, each with its own schema, layout and DBML text.
 *
 * Storage layout (localStorage):
 *   erd-maker:projects:v1   -> { v, activeId, projects: ProjectMeta[] }   (small index)
 *   erd-maker:project:<id>  -> SavedDoc                                    (one per project)
 *
 * The index is kept separate from the documents so switching projects and renaming never rewrites
 * every diagram. A pre-projects document (erd-maker:doc:v1) is migrated into the first project.
 */
import { nanoid } from 'nanoid'
import type { Layout, Schema } from '@/core/schema'
import { DOC_KEY, migrateDoc, serializeDoc, type SavedDoc } from './persistence'

export const INDEX_KEY = 'erd-maker:projects:v1'
export const PROJECT_KEY_PREFIX = 'erd-maker:project:'
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
  return write(storage, INDEX_KEY, { ...index, v: INDEX_VERSION })
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
  const ok = write(storage, projectKey(id), serializeDoc(state))
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
): ProjectMeta {
  const meta: ProjectMeta = { id: nanoid(10), name: name.trim() || DEFAULT_PROJECT_NAME, createdAt: now(), updatedAt: now() }
  const index = readIndex(storage)
  index.projects.push(meta)
  index.activeId = meta.id
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
    storage.removeItem(projectKey(id))
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

/**
 * Ensure at least one project exists and one is active, adopting a pre-projects document if found.
 * Safe to call on every boot.
 */
export function ensureProjects(storage: Storage = localStorage): ProjectMeta {
  const index = readIndex(storage)
  const current = index.projects.find((p) => p.id === index.activeId)
  if (current) return current
  if (index.projects.length > 0) {
    index.activeId = index.projects[0].id
    writeIndex(index, storage)
    return index.projects[0]
  }
  // First run: adopt the single-document format if the user has one.
  const legacy = migrateDoc(read<unknown>(storage, DOC_KEY))
  const meta = createProject(
    legacy && legacy.schema.tables.length > 0 ? 'My diagram' : DEFAULT_PROJECT_NAME,
    legacy ? { schema: legacy.schema, layout: legacy.layout, dbmlText: legacy.dbmlText } : null,
    storage,
  )
  return meta
}

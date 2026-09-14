/**
 * Whole-workspace backup and restore.
 *
 * localStorage is the only store: there are no accounts and nothing is on a server, so a cleared
 * browser profile takes every diagram with it. The per-diagram JSON export in the export dialog
 * covers one diagram; this covers all of them in a single file.
 *
 * Restore deliberately ADDS rather than overwrites. A backup file is usually opened by someone who
 * has already lost work, and silently replacing whatever is in the browser would be a second loss.
 * Every restored diagram gets a fresh id, so importing the same file twice makes copies rather
 * than destroying anything.
 */
import type { SavedDoc } from './persistence'
import { migrateDoc } from './persistence'
import { createProject, listProjects, readProject, type ProjectMeta } from './projects'

export const BACKUP_VERSION = 1

export interface BackupProject {
  name: string
  createdAt: string
  updatedAt: string
  /** Null for a diagram that was created but never given any content. */
  doc: SavedDoc | null
}

export interface Backup {
  v: number
  exportedAt: string
  appVersion: string
  projects: BackupProject[]
}

/** Thrown when a file is not a DBridge backup, so callers can show the reason. */
export class BackupError extends Error {}

export interface RestoreResult {
  imported: number
  /** Entries that were present but unreadable; the rest are still restored. */
  skipped: number
}

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export function buildBackup(storage: Storage = localStorage, now = new Date()): Backup {
  const projects = listProjects(storage).map((meta: ProjectMeta) => ({
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    doc: readProject(meta.id, storage),
  }))
  return { v: BACKUP_VERSION, exportedAt: now.toISOString(), appVersion: APP_VERSION, projects }
}

/** `dbridge-backup-2026-09-12.json` — sorts chronologically in a downloads folder. */
export function backupFilename(now = new Date()): string {
  return `dbridge-backup-${now.toISOString().slice(0, 10)}.json`
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2)
}

function parse(raw: string | unknown): Backup {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new BackupError('That file is not valid JSON.')
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BackupError('That file is not a DBridge backup.')
  }
  const b = data as Partial<Backup>
  if (typeof b.v !== 'number' || !Array.isArray(b.projects)) {
    throw new BackupError('That file is not a DBridge backup.')
  }
  if (b.v > BACKUP_VERSION) {
    throw new BackupError(`That backup was made by a newer version of DBridge (format ${b.v}).`)
  }
  return b as Backup
}

/**
 * Add every readable diagram in `raw` to this browser under a new id.
 *
 * @throws BackupError when the file itself cannot be read. Individual unreadable entries are
 *         counted in `skipped` instead, so one bad diagram does not cost the user the other eleven.
 */
export function restoreBackup(raw: string | unknown, storage: Storage = localStorage): RestoreResult {
  const backup = parse(raw)
  let imported = 0
  let skipped = 0

  for (const entry of backup.projects) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
      skipped++
      continue
    }
    const doc = entry.doc === null ? null : migrateDoc(entry.doc)
    if (entry.doc !== null && !doc) {
      skipped++
      continue
    }
    // Not activated: a restored diagram must not silently replace the one on screen. Activating it
    // left the running session editing a different project than the index pointed at, so the next
    // reload opened something other than what the user was looking at.
    createProject(entry.name, doc ? { schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText } : null, storage, false)
    imported++
  }

  if (imported === 0 && skipped === 0) throw new BackupError('That backup contains no diagrams.')
  return { imported, skipped }
}

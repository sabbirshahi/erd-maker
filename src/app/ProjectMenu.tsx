/**
 * The diagram's name in the top bar: switcher, rename, and the autosave indicator.
 *
 * There is no Save button. Edits autosave into the active project after a short idle, so the bar
 * reports when that last happened ("Saved 2m ago") instead of asking the user to do it. Ctrl+S
 * still forces an immediate write, and the label itself becomes the way out of a save conflict.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSchemaStore } from '@/store'
import { emptySchema } from '@/core/schema'
import { Menu } from './ui'
import { toast } from './toast'
import {
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  readProject,
  renameProject,
  type ProjectMeta,
} from './projects'
import { backupFilename, buildBackup, restoreBackup, serializeBackup, BackupError } from './backup'
import { downloadText } from './exportPng'
import { setTabProject } from './session'
import type { SaveController, SaveStatus } from './saveController'

/** "Saved 2m ago" reads as reassurance; a bare "Saved" leaves the user wondering when. */
function agoText(iso: string | null): string {
  if (!iso) return 'Saved'
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 45) return 'Saved just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `Saved ${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Saved ${hours}h ago`
  return `Saved ${Math.round(hours / 24)}d ago`
}

function statusText(status: SaveStatus, lastSavedAt: string | null): string {
  switch (status) {
    case 'saving':
      return 'Saving…'
    case 'unsaved':
      return 'Unsaved changes'
    case 'error':
      return 'Save failed'
    case 'conflict':
      return 'Changed in another tab'
    default:
      return agoText(lastSavedAt)
  }
}

/** Quiet heading that separates the diagram list from the actions below it. */
function SectionLabel({ children, border = false }: { children: React.ReactNode; border?: boolean }) {
  return <span className={`erd-menu__section${border ? ' erd-menu__section--border' : ''}`}>{children}</span>
}

/**
 * Menu action, visually distinct from the plain list of diagram names above it. Icons are inline
 * SVG rather than glyph characters, which render as empty boxes wherever the font lacks them.
 */
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  copy: 'M9 9h10v10H9zM5 15H4V4h11v1',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  archive: 'M3 7h18v13H3zM3 7l2-4h14l2 4M10 12h4',
  upload: 'M12 21V9m0 0 4 4m-4-4-4 4M4 5h16',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8',
} as const

function Action({ icon, children, danger = false }: { icon: keyof typeof ICONS; children: React.ReactNode; danger?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${danger ? 'erd-menuitem--danger' : ''}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
        <path d={ICONS[icon]} />
      </svg>
      {children}
    </span>
  )
}

export interface ProjectMenuProps {
  controller: SaveController
  activeId: string
  onActiveChange: (id: string) => void
  /** Ways to start a diagram. They live here rather than in the bar, which is for the current one. */
  onExamples: () => void
  onImport: () => void
  onOpenJson: () => void
  onShortcuts: () => void
}

export function ProjectMenu({ controller, activeId, onActiveChange, onExamples, onImport, onOpenJson, onShortcuts }: ProjectMenuProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects())
  const [renaming, setRenaming] = useState(false)
  const renameInput = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

  // The controller is an external store; subscribing to it directly keeps the label in step
  // without mirroring its state into this component.
  const subscribe = useCallback((cb: () => void) => controller.subscribe(cb), [controller])
  const status = useSyncExternalStore(subscribe, () => controller.status)
  const savedAt = useSyncExternalStore(subscribe, () => controller.lastSavedAt)

  // Nothing changes when the user sits still, but "just now" still has to become "2m ago".
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (renaming) renameInput.current?.select()
  }, [renaming])

  const refresh = useCallback(() => setProjects(listProjects()), [])
  const active = projects.find((p) => p.id === activeId) ?? null

  /** Save the current project, then put `id`'s document into the store. */
  const switchTo = useCallback(
    (id: string) => {
      if (id === activeId) return
      controller.save()
      const doc = readProject(id)
      setTabProject(id)
      controller.setProject(id)
      useSchemaStore.getState().load(
        doc
          ? { schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined }
          : { schema: emptySchema(), layout: {} },
      )
      onActiveChange(id)
      refresh()
    },
    [activeId, controller, onActiveChange, refresh],
  )

  const newProject = useCallback(() => {
    controller.save()
    const meta = createProject()
    setTabProject(meta.id)
    controller.setProject(meta.id)
    useSchemaStore.getState().load({ schema: emptySchema(), layout: {} })
    onActiveChange(meta.id)
    refresh()
    toast(`Created ${meta.name}`)
  }, [controller, onActiveChange, refresh])

  const duplicate = useCallback(() => {
    controller.save()
    const copy = duplicateProject(activeId)
    if (!copy) return
    setTabProject(copy.id)
    controller.setProject(copy.id)
    onActiveChange(copy.id)
    refresh()
    toast(`Duplicated to ${copy.name}`)
  }, [activeId, controller, onActiveChange, refresh])

  const remove = useCallback(() => {
    if (!active) return
    if (!window.confirm(`Delete “${active.name}”? This cannot be undone.`)) return
    const nextId = deleteProject(activeId)
    const remaining = listProjects()
    if (nextId) {
      const doc = readProject(nextId)
      setTabProject(nextId)
      controller.setProject(nextId)
      useSchemaStore.getState().load(
        doc ? { schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined } : { schema: emptySchema(), layout: {} },
      )
      onActiveChange(nextId)
    } else {
      const meta = createProject()
      setTabProject(meta.id)
      controller.setProject(meta.id)
      useSchemaStore.getState().load({ schema: emptySchema(), layout: {} })
      onActiveChange(meta.id)
    }
    setProjects(remaining)
    refresh()
    toast(`Deleted ${active.name}`)
  }, [active, activeId, controller, onActiveChange, refresh])

  const commitRename = useCallback(
    (name: string) => {
      setRenaming(false)
      const trimmed = name.trim()
      if (!trimmed || !active || trimmed === active.name) return
      renameProject(activeId, trimmed)
      refresh()
    },
    [active, activeId, refresh],
  )

  const downloadBackup = useCallback(() => {
    controller.save()
    const backup = buildBackup()
    downloadText(serializeBackup(backup), backupFilename(), 'application/json')
    const n = backup.projects.length
    toast(`Backed up ${n} ${n === 1 ? 'diagram' : 'diagrams'}`)
  }, [controller])

  const restoreFromFile = useCallback(
    async (file: File) => {
      try {
        const { imported, skipped } = restoreBackup(await file.text())
        refresh()
        toast(
          skipped > 0
            ? `${imported} ${imported === 1 ? 'diagram' : 'diagrams'} imported, ${skipped} unreadable`
            : `${imported} ${imported === 1 ? 'diagram' : 'diagrams'} imported`,
        )
      } catch (err) {
        toast(err instanceof BackupError ? err.message : 'Could not read that backup file.', 'error')
      }
    },
    [refresh],
  )

  /**
   * The status label is also the escape hatch. With no Save button, a failed or conflicting save
   * would otherwise be a dead end, so clicking the label retries it.
   */
  const stuck = status === 'conflict' || status === 'error'
  const retry = () => {
    if (!stuck) return
    if (controller.save()) return void toast('Saved')
    if (
      controller.status === 'conflict' &&
      window.confirm('Another tab saved this diagram after you opened it.\n\nOverwrite it with your version?')
    ) {
      if (controller.save(true)) toast('Saved')
    } else {
      toast('Could not save: browser storage is full or unavailable', 'error')
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="project-bar">
      <input
        ref={restoreInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="restore-backup-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void restoreFromFile(f)
          e.target.value = ''
        }}
      />
      {renaming ? (
        <input
          ref={renameInput}
          data-testid="project-rename-input"
          defaultValue={active?.name ?? ''}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setRenaming(false)
          }}
          className="erd-rename-input"
        />
      ) : (
        <Menu
          testId="project-menu"
          trigger={({ onClick }) => (
            <button
              type="button"
              className="erd-hdr-title"
              data-testid="btn-project"
              onClick={onClick}
              onDoubleClick={() => setRenaming(true)}
              title="Diagrams — double-click the name to rename"
            >
              <span className="truncate" data-testid="project-name">
                {active?.name ?? 'Untitled diagram'}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
          items={[
            { id: 'hdr-open', label: <SectionLabel>Switch to</SectionLabel>, disabled: true, onSelect: () => {} },
            ...projects.map((p) => ({
              id: `project-${p.id}`,
              label: (
                <span className="flex items-center gap-2 pl-1">
                  <span className={p.id === activeId ? '' : 'opacity-0'} style={{ color: 'var(--erd-accent)' }}>
                    ✓
                  </span>
                  <span className="truncate">{p.name}</span>
                </span>
              ),
              onSelect: () => switchTo(p.id),
            })),
            { id: 'hdr-manage', label: <SectionLabel border>Manage</SectionLabel>, disabled: true, onSelect: () => {} },
            { id: 'project-new', label: <Action icon="plus">New diagram</Action>, onSelect: newProject },
            { id: 'project-rename', label: <Action icon="pencil">Rename…</Action>, onSelect: () => setRenaming(true) },
            { id: 'project-duplicate', label: <Action icon="copy">Duplicate</Action>, onSelect: duplicate },
            { id: 'project-delete', label: <Action icon="trash" danger>Delete…</Action>, onSelect: remove },
            { id: 'hdr-start', label: <SectionLabel border>Start from</SectionLabel>, disabled: true, onSelect: () => {} },
            { id: 'project-examples', label: <Action icon="grid">Examples…</Action>, onSelect: onExamples },
            { id: 'project-import', label: <Action icon="download">Paste DBML, SQL or models.py…</Action>, onSelect: onImport },
            { id: 'import-json', label: <Action icon="download">Open .json…</Action>, onSelect: onOpenJson },
            { id: 'hdr-backup', label: <SectionLabel border>All diagrams</SectionLabel>, disabled: true, onSelect: () => {} },
            { id: 'backup-download', label: <Action icon="archive">Download backup…</Action>, hint: `${projects.length}`, onSelect: downloadBackup },
            { id: 'backup-restore', label: <Action icon="upload">Restore from backup…</Action>, onSelect: () => restoreInput.current?.click() },
            { id: 'hdr-help', label: <SectionLabel border>Help</SectionLabel>, disabled: true, onSelect: () => {} },
            { id: 'shortcuts', label: <Action icon="keyboard">Keyboard shortcuts</Action>, hint: '?', onSelect: onShortcuts },
          ]}
        />
      )}

      {stuck ? (
        <button type="button" className="erd-hdr-status" data-testid="save-status" data-status={status} onClick={retry} title="Click to try saving again">
          {statusText(status, savedAt)}
        </button>
      ) : (
        <span className="erd-hdr-status" data-testid="save-status" data-status={status}>
          {statusText(status, savedAt)}
        </span>
      )}
    </div>
  )
}

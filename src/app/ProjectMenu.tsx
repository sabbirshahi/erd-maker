/**
 * Project switcher + explicit Save for the top bar.
 *
 * Several diagrams live in one browser; each is a named project in localStorage. Edits are also
 * autosaved into the active project, so the Save button is a visible checkpoint rather than the
 * only thing standing between the user and lost work.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSchemaStore } from '@/store'
import { emptySchema } from '@/core/schema'
import { Button, Menu } from './ui'
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
import { setTabProject } from './session'
import type { SaveController, SaveStatus } from './saveController'

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
  conflict: 'Changed elsewhere',
}

const STATUS_CLASS: Record<SaveStatus, string> = {
  saved: 'text-zinc-400 dark:text-zinc-500',
  unsaved: 'text-amber-600 dark:text-amber-400',
  saving: 'text-blue-600 dark:text-blue-400',
  error: 'text-red-600 dark:text-red-400',
  conflict: 'text-amber-600 dark:text-amber-400',
}

/** Small caps heading that separates the diagram list from the actions below it. */
function SectionLabel({ children, border = false }: { children: React.ReactNode; border?: boolean }) {
  return (
    <span
      className={`-mx-3 -my-1 block px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 ${
        border ? 'mt-1 border-t border-zinc-200 dark:border-zinc-700' : ''
      }`}
    >
      {children}
    </span>
  )
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
} as const

function Action({ icon, children, danger = false }: { icon: keyof typeof ICONS; children: React.ReactNode; danger?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${danger ? 'text-red-600 dark:text-red-400' : ''}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
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
}

export function ProjectMenu({ controller, activeId, onActiveChange }: ProjectMenuProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects())
  const [status, setStatus] = useState<SaveStatus>(controller.status)
  const [renaming, setRenaming] = useState(false)
  const renameInput = useRef<HTMLInputElement>(null)

  useEffect(() => setStatus(controller.status), [controller])
  useEffect(() => controller.subscribe(() => setStatus(controller.status)), [controller])
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

  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="project-bar">
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
          className="w-40 rounded border border-blue-500 bg-white px-1.5 py-0.5 text-sm outline-none dark:bg-zinc-900"
        />
      ) : (
        <Menu
          testId="project-menu"
          trigger={({ onClick }) => (
            <Button
              variant="ghost"
              size="sm"
              data-testid="btn-project"
              onClick={onClick}
              onDoubleClick={() => setRenaming(true)}
              title="Projects — double-click the name to rename"
            >
              <span className="max-w-40 truncate font-medium" data-testid="project-name">
                {active?.name ?? 'Untitled diagram'}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-1 opacity-60">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Button>
          )}
          items={[
            { id: 'hdr-open', label: <SectionLabel>Switch to</SectionLabel>, disabled: true, onSelect: () => {} },
            ...projects.map((p) => ({
              id: `project-${p.id}`,
              label: (
                <span className="flex items-center gap-2 pl-1">
                  <span className={`w-3 text-blue-600 dark:text-blue-400 ${p.id === activeId ? '' : 'opacity-0'}`}>✓</span>
                  <span className="truncate">{p.name}</span>
                </span>
              ),
              onSelect: () => switchTo(p.id),
            })),
            { id: 'hdr-manage', label: <SectionLabel border>Manage</SectionLabel>, disabled: true, onSelect: () => {} },
            { id: 'project-new', label: <Action icon="plus">New project</Action>, onSelect: newProject },
            { id: 'project-rename', label: <Action icon="pencil">Rename…</Action>, onSelect: () => setRenaming(true) },
            { id: 'project-duplicate', label: <Action icon="copy">Duplicate</Action>, onSelect: duplicate },
            { id: 'project-delete', label: <Action icon="trash" danger>Delete…</Action>, onSelect: remove },
          ]}
        />
      )}

      <Button
        variant="ghost"
        size="sm"
        data-testid="btn-save"
        title="Save (Ctrl+S)"
        onClick={() => {
          if (controller.save()) {
            toast(`Saved ${active?.name ?? 'project'}`)
          } else if (controller.status === 'conflict') {
            // Another tab saved this project after we loaded it; overwriting is the user's call.
            if (window.confirm('Another tab saved this diagram after you opened it.\n\nOverwrite it with your version?')) {
              if (controller.save(true)) toast(`Saved ${active?.name ?? 'project'}`)
            }
          } else {
            toast('Could not save: browser storage is full or unavailable', 'error')
          }
        }}
      >
        Save
      </Button>
      <span data-testid="save-status" data-status={status} className={`hidden text-xs sm:inline ${STATUS_CLASS[status]}`}>
        {STATUS_TEXT[status]}
      </span>
    </div>
  )
}

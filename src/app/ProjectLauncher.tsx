/**
 * Start screen shown when the app is opened on its own URL.
 *
 * The canvas stays empty until a choice is made here, so opening the site never silently resumes
 * (or, worse, overwrites) whichever diagram was last open. A share link skips this entirely.
 */
import { useEffect, useState } from 'react'
import { useSchemaStore } from '@/store'
import { emptySchema } from '@/core/schema'
import { Button } from './ui'
import { createProject, listProjects, readProject, type ProjectMeta } from './projects'
import { setTabProject } from './session'
import type { SaveController } from './saveController'

export interface ProjectLauncherProps {
  controller: SaveController
  onOpen: (id: string) => void
  onBrowseExamples: () => void
}

function tableCount(id: string): number {
  return readProject(id)?.schema.tables.length ?? 0
}

function when(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (!Number.isFinite(mins) || mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function ProjectLauncher({ controller, onOpen, onBrowseExamples }: ProjectLauncherProps) {
  const [projects] = useState<ProjectMeta[]>(() => listProjects().filter((p) => tableCount(p.id) > 0))

  const open = (id: string) => {
    const doc = readProject(id)
    setTabProject(id)
    controller.setProject(id)
    useSchemaStore.getState().load(
      doc ? { schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined } : { schema: emptySchema(), layout: {} },
    )
    onOpen(id)
  }

  const startNew = () => {
    const meta = createProject()
    setTabProject(meta.id)
    controller.setProject(meta.id)
    useSchemaStore.getState().load({ schema: emptySchema(), layout: {} })
    onOpen(meta.id)
  }

  // Dismissible: Escape or a click outside starts a blank diagram rather than trapping the user.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startNew()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm"
      data-testid="project-launcher"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a diagram"
      onClick={(e) => {
        if (e.target === e.currentTarget) startNew()
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between">
          <h1 className="text-lg font-semibold">ERD Maker</h1>
          <button
            type="button"
            data-testid="launcher-close"
            aria-label="Close"
            onClick={startNew}
            className="-mr-1 -mt-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Design a schema in DBML, on a canvas, or as Django models.</p>

        {projects.length > 0 && (
          <>
            <h2 className="mt-5 text-xs font-medium uppercase tracking-wide text-zinc-400">Your diagrams</h2>
            <ul className="mt-2 max-h-56 divide-y divide-zinc-100 overflow-auto rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-testid={`launcher-project-${p.id}`}
                    onClick={() => open(p.id)}
                    className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="text-xs text-zinc-400">
                      {tableCount(p.id)} tables · {when(p.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button data-testid="launcher-new" onClick={startNew}>
            New project
          </Button>
          <Button variant="ghost" data-testid="launcher-blank" onClick={startNew}>
            Start blank
          </Button>
          <Button
            variant="ghost"
            data-testid="launcher-examples"
            onClick={() => {
              startNew()
              onBrowseExamples()
            }}
          >
            Browse examples
          </Button>
        </div>
      </div>
    </div>
  )
}

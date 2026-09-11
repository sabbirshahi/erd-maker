/**
 * App shell: top bar, resizable canvas | right pane (DBML | Django | Demo), bottom Problems panel.
 * OWNER: worker-6.
 */
import { clsx } from 'clsx'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSchemaStore, useAllDiagnostics, undo, redo, type TextView } from '@/store'
import { EmptyState } from './EmptyState'
import { ExamplesGallery } from './ExamplesMenu'
import { downloadText, exportCanvasPng } from './exportPng'
import { Canvas, DbmlEditor, DjangoEditor, DemoPanel, ImportDialog, ExportDialog, Placeholder } from './panes'
import { ProblemsPanel, countBySeverity } from './ProblemsPanel'
import { shareCurrent } from './share'
import { useTheme } from './theme'
import { toast } from './toast'
import { Button, ErrorBoundary, IconButton, Kbd, Menu, Tabs } from './ui'
import { generateDbml } from '@/core/dbml'

type RightTab = TextView | 'demo'

const UI_KEY = 'erd-maker:ui:v1'
interface UiPrefs {
  rightWidth: number
  problemsOpen: boolean
  tab: RightTab
}
const defaultPrefs: UiPrefs = { rightWidth: 460, problemsOpen: false, tab: 'dbml' }

function readPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_KEY)
    return raw ? { ...defaultPrefs, ...(JSON.parse(raw) as Partial<UiPrefs>) } : defaultPrefs
  } catch {
    return defaultPrefs
  }
}
function writePrefs(p: UiPrefs) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

const GITHUB_URL = 'https://github.com/sabbirshahi/erd-maker'

function Logo() {
  return (
    <div className="flex items-center gap-2 pr-2 font-semibold">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-600 dark:text-indigo-400" aria-hidden>
        <rect x="3" y="3" width="8" height="6" rx="1" />
        <rect x="13" y="15" width="8" height="6" rx="1" />
        <path d="M7 9v5a2 2 0 0 0 2 2h4" />
      </svg>
      <span>ERD Maker</span>
    </div>
  )
}

function Pane({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary name={name}>
      <Suspense fallback={<Placeholder name={name} hint="Loading…" />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || Boolean(el.closest?.('.cm-editor'))
}

export function Shell() {
  const [prefs, setPrefs] = useState<UiPrefs>(readPrefs)
  const patchPrefs = useCallback((p: Partial<UiPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p }
      writePrefs(next)
      return next
    })
  }, [])

  const tableCount = useSchemaStore((s) => s.schema.tables.length)
  const [blankDismissed, setBlankDismissed] = useState(false)
  useEffect(
    () =>
      useSchemaStore.subscribe((s, prev) => {
        if (s.schema.tables.length > 0 && prev.schema.tables.length === 0) setBlankDismissed(false)
      }),
    [],
  )

  const [gallery, setGallery] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [theme, toggleTheme] = useTheme()

  const diagnostics = useAllDiagnostics()
  const counts = countBySeverity(diagnostics)

  // Undo / redo shortcuts (canvas & editors handle their own when focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Resizable split
  const dragging = useRef(false)
  const onDividerDown = (e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDividerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const w = Math.min(Math.max(window.innerWidth - e.clientX, 280), window.innerWidth - 320)
    patchPrefs({ rightWidth: w })
  }
  const onDividerUp = () => {
    dragging.current = false
  }

  const exportJson = () => {
    const s = useSchemaStore.getState()
    downloadText(JSON.stringify({ v: 1, schema: s.schema, layout: s.layout }, null, 2), 'erd.json', 'application/json')
    toast('Downloaded erd.json')
  }
  const exportDbmlFile = () => {
    const s = useSchemaStore.getState()
    downloadText(s.dbmlText ?? generateDbml(s.schema), 'schema.dbml', 'text/plain')
    toast('Downloaded schema.dbml')
  }
  const fileInput = useRef<HTMLInputElement>(null)
  const importJson = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as { schema?: unknown; layout?: unknown }
      const schema = d.schema as { tables?: unknown[] } | undefined
      if (!schema || !Array.isArray(schema.tables)) throw new Error('missing schema')
      useSchemaStore.getState().load({ schema: d.schema as never, layout: (d.layout as never) ?? {} })
      toast(`Imported ${file.name}`)
    } catch {
      toast('Not a valid ERD Maker JSON file', 'error')
    }
  }

  const showEmpty = tableCount === 0 && !blankDismissed
  const problemsCount = diagnostics.length

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100" data-testid="shell">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900" data-testid="topbar">
        <Logo />
        <Button variant="ghost" size="sm" data-testid="btn-examples" onClick={() => setGallery(true)}>
          Examples
        </Button>
        <Menu
          testId="import-menu"
          trigger={({ onClick }) => (
            <Button variant="ghost" size="sm" data-testid="btn-import" onClick={onClick}>
              Import
            </Button>
          )}
          items={[
            { id: 'import-paste', label: 'Paste DBML / SQL / models.py…', onSelect: () => setImportOpen(true) },
            { id: 'import-json', label: 'Open .json (schema + layout)…', onSelect: () => fileInput.current?.click() },
          ]}
        />
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="import-json-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importJson(f)
            e.target.value = ''
          }}
        />
        <Menu
          testId="export-menu"
          trigger={({ onClick }) => (
            <Button variant="ghost" size="sm" data-testid="btn-export" onClick={onClick}>
              Export
            </Button>
          )}
          items={[
            { id: 'export-dialog', label: 'DBML / SQL / models.py…', onSelect: () => setExportOpen(true) },
            { id: 'export-dbml', label: 'Download schema.dbml', onSelect: exportDbmlFile },
            { id: 'export-json', label: 'Download erd.json', onSelect: exportJson },
            { id: 'export-png', label: 'Export PNG', onSelect: () => void exportCanvasPng() },
          ]}
        />
        <Button variant="ghost" size="sm" data-testid="btn-share" onClick={() => void shareCurrent(useSchemaStore)}>
          Share
        </Button>
        <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
        <IconButton label="Undo (Ctrl+Z)" data-testid="btn-undo" onClick={() => undo()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" data-testid="btn-redo" onClick={() => redo()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
        </IconButton>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} data-testid="btn-theme" onClick={toggleTheme}>
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            )}
          </IconButton>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="GitHub"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" /></svg>
          </a>
        </div>
      </header>

      {/* Main split */}
      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1" data-testid="canvas-pane">
          <Pane name="Canvas">
            <Canvas />
          </Pane>
          {showEmpty && (
            <EmptyState
              onExamples={() => setGallery(true)}
              onImport={() => setImportOpen(true)}
              onBlank={() => setBlankDismissed(true)}
            />
          )}
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          className="w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-indigo-400 dark:bg-zinc-800 dark:hover:bg-indigo-500"
        />

        <aside className="flex min-h-0 flex-col bg-white dark:bg-zinc-900" style={{ width: prefs.rightWidth }} data-testid="right-pane">
          <div className="flex items-center border-b border-zinc-200 px-2 dark:border-zinc-800">
            <Tabs<RightTab>
              value={prefs.tab}
              onChange={(tab) => patchPrefs({ tab })}
              items={[
                { id: 'dbml', label: 'DBML' },
                { id: 'django', label: 'Django' },
                { id: 'demo', label: 'Demo' },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1">
            <div className={clsx('h-full', prefs.tab !== 'dbml' && 'hidden')}>
              <Pane name="DBML editor">
                <DbmlEditor />
              </Pane>
            </div>
            <div className={clsx('h-full', prefs.tab !== 'django' && 'hidden')}>
              <Pane name="Django editor">
                <DjangoEditor />
              </Pane>
            </div>
            {prefs.tab === 'demo' && (
              <div className="h-full">
                <Pane name="Demo">
                  <DemoPanel />
                </Pane>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Problems */}
      <footer
        className={clsx('shrink-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900', prefs.problemsOpen ? 'h-56' : 'h-8')}
        data-testid="problems-footer"
      >
        <div className="flex h-8 items-center px-2">
          <button
            type="button"
            data-testid="tab-problems"
            aria-expanded={prefs.problemsOpen}
            onClick={() => patchPrefs({ problemsOpen: !prefs.problemsOpen })}
            className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-white"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={clsx('transition-transform', prefs.problemsOpen && 'rotate-90')}><path d="m9 6 6 6-6 6" /></svg>
            Problems
            <span
              data-testid="problems-badge"
              className={clsx(
                'rounded-full px-1.5 text-[10px] leading-4 tabular-nums',
                counts.error > 0
                  ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100'
                  : counts.warning > 0
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100',
              )}
            >
              {problemsCount}
            </span>
          </button>
          <div className="ml-auto hidden items-center gap-2 text-[11px] text-zinc-400 sm:flex">
            <span>
              <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo
            </span>
            <span>
              <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>T</Kbd> add table
            </span>
          </div>
        </div>
        {prefs.problemsOpen && (
          <div className="h-[calc(100%-2rem)]">
            <ProblemsPanel onGoto={(view) => patchPrefs({ tab: view })} />
          </div>
        )}
      </footer>

      <ExamplesGallery open={gallery} onClose={() => setGallery(false)} />
      <Pane name="Import dialog">
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      </Pane>
      <Pane name="Export dialog">
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      </Pane>
    </div>
  )
}

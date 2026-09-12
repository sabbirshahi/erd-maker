/**
 * App shell: top bar, resizable canvas | right pane (DBML | Django | Demo), bottom Problems panel.
 * OWNER: worker-6.
 */
import { clsx } from 'clsx'
import './shell.css'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSchemaStore, useAllDiagnostics, undo, redo, type TextView } from '@/store'
import { EmptyState } from './EmptyState'
import { ExamplesGallery } from './ExamplesMenu'
import { downloadText, exportCanvasPng } from './exportPng'
import { Canvas, DbmlEditor, DjangoEditor, DemoPanel, ImportDialog, ExportDialog, Placeholder } from './panes'
import { ProjectMenu } from './ProjectMenu'
import { ShortcutsDialog } from './ShortcutsDialog'
import { getSession } from './session'
import { startCrossTabSync } from './crossTab'
import { ProblemsPanel, countBySeverity } from './ProblemsPanel'
import { shareCurrent } from './share'
import { useTheme } from './theme'
import { toast } from './toast'
import { Button, ErrorBoundary, IconButton, Menu, Tabs } from './ui'
import { useStore } from 'zustand'
import { track } from './analytics'

type RightTab = TextView | 'demo'

const UI_KEY = 'dbridge:ui:v1'
interface UiPrefs {
  rightWidth: number
  problemsOpen: boolean
  rightCollapsed: boolean
  tab: RightTab
}
const defaultPrefs: UiPrefs = { rightWidth: 460, problemsOpen: false, rightCollapsed: false, tab: 'dbml' }

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
    <div className="erd-logo">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <rect x="3" y="3" width="8" height="6" rx="1" />
        <rect x="13" y="15" width="8" height="6" rx="1" />
        <path d="M7 9v5a2 2 0 0 0 2 2h4" />
      </svg>
      <span>DBridge</span>
    </div>
  )
}

/**
 * One line at the foot of the right panel, in place of the old full-width Problems bar.
 *
 * Most of the time there is nothing wrong, and a bar spanning the window to announce "0" is a lot
 * of chrome for that. Quiet when the schema is clean; a button that opens the list when it is not.
 */
function StatusLine({
  count,
  errors,
  warnings,
  open,
  onToggle,
}: {
  count: number
  errors: number
  warnings: number
  open: boolean
  onToggle: () => void
}) {
  if (count === 0) {
    return (
      <div className="erd-statusline" data-testid="tab-problems" data-count={0}>
        <span className="erd-statusline__ok" aria-hidden>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        Synced, no problems
      </div>
    )
  }
  const tone = errors > 0 ? 'error' : 'warning'
  return (
    <button
      type="button"
      className="erd-statusline erd-statusline--clickable"
      data-testid="tab-problems"
      data-count={count}
      aria-expanded={open}
      onClick={onToggle}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={clsx('transition-transform', open && 'rotate-90')} aria-hidden>
        <path d="m9 6 6 6-6 6" />
      </svg>
      <span className={`erd-statusline__count erd-statusline__count--${tone}`} data-testid="problems-badge">
        {count}
      </span>
      {errors > 0 ? `${errors === 1 ? 'problem' : 'problems'} to fix` : `${warnings === 1 ? 'warning' : 'warnings'}`}
    </button>
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
  const [shortcuts, setShortcuts] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false)
  const session = getSession()
  const [activeId, setActiveId] = useState(session.activeId)
  const [theme, toggleTheme] = useTheme()

  const diagnostics = useAllDiagnostics()
  const counts = countBySeverity(diagnostics)
  // Undo/redo live only in the header now, so they need the history depth the canvas toolbar used.
  const past = useStore(useSchemaStore.temporal, (t) => t.pastStates.length)
  const future = useStore(useSchemaStore.temporal, (t) => t.futureStates.length)

  // Undo / redo shortcuts (canvas & editors handle their own when focused).
  // The canvas selection toolbar asks for an export scoped to the selected tables.
  useEffect(() => {
    const onExportSelection = () => {
      setExportSelectionOnly(true)
      setExportOpen(true)
    }
    window.addEventListener('erd:export-selection', onExportSelection)
    return () => window.removeEventListener('erd:export-selection', onExportSelection)
  }, [])

  // Another tab on the same project saved: pick the change up live.
  useEffect(
    () =>
      startCrossTabSync(useSchemaStore, session.controller, activeId, {
        onConflict: () => toast('This diagram changed in another tab. Save or reload to see it.'),
      }),
    [session, activeId],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      // '?' is a printable character, so it must never be taken while the user is typing.
      if (!mod && e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault()
        setShortcuts((o) => !o)
        return
      }
      if (!mod) return
      // Ctrl+S saves from anywhere, including while typing in an editor.
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (session.controller.save()) toast('Saved')
        else if (session.controller.status === 'conflict') toast('Another tab saved this diagram. Use Save to overwrite it.', 'error')
        else toast('Could not save: browser storage is full or unavailable', 'error')
        return
      }
      if (isEditableTarget(e.target)) return
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
  }, [session])

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
  // A drag handle that only responds to a mouse is unusable without one.
  const onDividerKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') patchPrefs({ rightWidth: Math.min(prefs.rightWidth + step, window.innerWidth - 320) })
    else if (e.key === 'ArrowRight') patchPrefs({ rightWidth: Math.max(prefs.rightWidth - step, 280) })
    else return
    e.preventDefault()
  }

  const exportJson = () => {
    const s = useSchemaStore.getState()
    track({ name: 'export', format: 'json' })
    downloadText(JSON.stringify({ v: 1, schema: s.schema, layout: s.layout }, null, 2), 'erd.json', 'application/json')
    toast('Downloaded erd.json')
  }
  const exportDbmlFile = async () => {
    const s = useSchemaStore.getState()
    // Dynamic import keeps the (large) @dbml/core chunk out of the shell's boot path.
    const text = s.dbmlText ?? (await import('@/core/dbml')).generateDbml(s.schema)
    track({ name: 'export', format: 'dbml' })
    downloadText(text, 'schema.dbml', 'text/plain')
    toast('Downloaded schema.dbml')
  }
  const fileInput = useRef<HTMLInputElement>(null)
  const importJson = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as { schema?: unknown; layout?: unknown }
      const schema = d.schema as { tables?: unknown[] } | undefined
      if (!schema || !Array.isArray(schema.tables)) throw new Error('missing schema')
      useSchemaStore.getState().load({ schema: d.schema as never, layout: (d.layout as never) ?? {} })
      track({ name: 'import', kind: 'json' })
      toast(`Imported ${file.name}`)
    } catch {
      toast('Not a valid DBridge JSON file', 'error')
    }
  }

  const showEmpty = tableCount === 0 && !blankDismissed
  const problemsCount = diagnostics.length

  return (
    <div className="erd-app" data-testid="shell">
      {/* Top bar. One filled button exists in the product and it is Share; everything else is
          quieter than the diagram's own name. */}
      <header className="erd-topbar" data-testid="topbar">
        <Logo />
        <ProjectMenu
          controller={session.controller}
          activeId={activeId}
          onActiveChange={setActiveId}
          onExamples={() => setGallery(true)}
          onImport={() => setImportOpen(true)}
          onOpenJson={() => fileInput.current?.click()}
          onShortcuts={() => setShortcuts(true)}
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

        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Undo (Ctrl+Z)" data-testid="btn-undo" disabled={past === 0} onClick={() => undo()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" data-testid="btn-redo" disabled={future === 0} onClick={() => redo()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
          </IconButton>

          <span className="erd-divider mx-1" />

          <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} data-testid="btn-theme" onClick={toggleTheme}>
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            )}
          </IconButton>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub" className="erd-iconbtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" /></svg>
          </a>

          <Menu
            align="right"
            testId="export-menu"
            trigger={({ onClick }) => (
              <Button variant="outline" data-testid="btn-export" onClick={onClick} className="ml-1">
                Export
              </Button>
            )}
            items={[
              { id: 'export-dialog', label: 'DBML, SQL or models.py…', onSelect: () => { setExportSelectionOnly(false); setExportOpen(true) } },
              { id: 'export-dbml', label: 'Download schema.dbml', onSelect: () => void exportDbmlFile() },
              { id: 'export-json', label: 'Download erd.json', onSelect: exportJson },
              { id: 'export-png', label: 'Export PNG', onSelect: () => { track({ name: 'export', format: 'png' }); void exportCanvasPng() } },
            ]}
          />
          <Button variant="primary" data-testid="btn-share" onClick={() => void shareCurrent(useSchemaStore)}>
            Share
          </Button>
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

        {prefs.rightCollapsed ? (
          <div className="erd-rail" data-testid="right-rail">
            <IconButton label="Show code panel" data-testid="btn-expand-right" onClick={() => patchPrefs({ rightCollapsed: false })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m14 6-6 6 6 6" /></svg>
            </IconButton>
          </div>
        ) : (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize code panel"
              tabIndex={0}
              className="erd-resize"
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onKeyDown={onDividerKey}
            />

            <aside className="erd-rightpane" style={{ width: prefs.rightWidth }} data-testid="right-pane">
              <div className="erd-rightpane__head">
                <Tabs<RightTab>
                  value={prefs.tab}
                  onChange={(tab) => patchPrefs({ tab })}
                  items={[
                    { id: 'dbml', label: 'DBML' },
                    { id: 'django', label: 'Django' },
                    { id: 'demo', label: 'SQL' },
                  ]}
                />
                <button
                  type="button"
                  className="erd-collapse"
                  data-testid="btn-collapse-right"
                  aria-label="Hide code panel"
                  title="Hide code panel"
                  onClick={() => patchPrefs({ rightCollapsed: true })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m10 6 6 6-6 6" /></svg>
                </button>
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

              {problemsCount > 0 && prefs.problemsOpen && (
                <div className="h-56 shrink-0" data-testid="problems-drawer">
                  <ProblemsPanel onGoto={(view) => patchPrefs({ tab: view })} />
                </div>
              )}
              <StatusLine
                count={problemsCount}
                errors={counts.error}
                warnings={counts.warning}
                open={prefs.problemsOpen}
                onToggle={() => patchPrefs({ problemsOpen: !prefs.problemsOpen })}
              />
            </aside>
          </>
        )}
      </div>

      <ExamplesGallery open={gallery} onClose={() => setGallery(false)} />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <Pane name="Import dialog">
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      </Pane>
      <Pane name="Export dialog">
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} initialSelectionOnly={exportSelectionOnly} />
      </Pane>
    </div>
  )
}

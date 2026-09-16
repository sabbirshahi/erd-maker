/**
 * App shell: top bar, resizable canvas | right pane (DBML | Django | Demo), bottom Problems panel.
 * OWNER: worker-6.
 */
import { clsx } from 'clsx'
import './shell.css'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useSchemaStore, useAllDiagnostics, undo, redo, type TextView } from '@/store'
import { isEmbed } from './embed'
import { EmptyState } from './EmptyState'
import { ExamplesGallery } from './ExamplesMenu'
import { downloadText, exportCanvasPng, exportCanvasSvg } from './exportPng'
import { exportFilename } from './filename'
import { projectName, projectsRevision, subscribeProjects } from './projects'
import { Canvas, DbmlEditor, DjangoEditor, DemoPanel, ImportDialog, ExportDialog, Placeholder } from './panes'
import { ProjectMenu } from './ProjectMenu'
import { backupFilename, buildBackup, restoreBackup, serializeBackup, BackupError } from './backup'
import { CommandPalette } from './CommandPalette'
import { ShortcutsDialog } from './ShortcutsDialog'
import { getSession, subscribeActiveProject } from './session'
import { startCrossTabSync } from './crossTab'
import { ProblemsPanel, countBySeverity } from './ProblemsPanel'
import { shareCurrent } from './share'
import { useTheme } from './theme'
import { toast } from './toast'
import { Button, ErrorBoundary, IconButton, Menu, Tabs } from './ui'
import { NARROW, STACKED, useMediaQuery } from './useMediaQuery'
import { MIN_CANVAS_WIDTH, clampPaneWidth, paneWidthCss, paneWidthFromPointer } from './paneSize'
import { useStore } from 'zustand'
import { track } from './analytics'

type RightTab = TextView | 'demo'

const UI_KEY = 'dbridge:ui:v1'
interface UiPrefs {
  rightWidth: number
  problemsOpen: boolean
  rightCollapsed: boolean
  /**
   * The panel is taking every pixel the canvas can spare. Held apart from `rightWidth` rather
   * than written into it, so restoring comes back to the width the user dragged to instead of
   * the default.
   */
  rightMaximized: boolean
  /** Soft-wrap long lines in the code panes. Off by default: DBML should read as it was written. */
  wrap: boolean
  tab: RightTab
}
const defaultPrefs: UiPrefs = {
  rightWidth: 460,
  problemsOpen: false,
  rightCollapsed: false,
  rightMaximized: false,
  wrap: false,
  tab: 'dbml',
}

/**
 * Which pane a first visit opens on.
 *
 * On a wide screen both are on show, so the answer does not matter. Below 860px they take turns
 * and it matters a lot: the code panel covers the canvas, so defaulting to it put a new visitor
 * in an empty DBML editor with the "start from an example" card hidden behind it. The diagram is
 * the thing to land on; the panel is one tap away.
 *
 * Only a default — a stored preference always wins, so this never overrides a choice.
 */
function startsCollapsed(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(STACKED).matches)
}

function readPrefs(): UiPrefs {
  const base = { ...defaultPrefs, rightCollapsed: startsCollapsed() }
  try {
    const raw = localStorage.getItem(UI_KEY)
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<UiPrefs>) } : base
  } catch {
    return base
  }
}
function writePrefs(p: UiPrefs) {
  // Defence in depth: the shell does not render in embed mode, but no write path should depend on
  // that staying true.
  if (isEmbed()) return
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
  const [palette, setPalette] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false)
  const session = getSession()
  const [activeId, setActiveId] = useState(session.activeId)
  const [theme, toggleTheme] = useTheme()

  // A /s/<id> link resolves after this has rendered and adopts the diagram as a new project of its
  // own, so the bar is told rather than left naming the diagram that was open before.
  useEffect(() => subscribeActiveProject(setActiveId), [])

  // Exports are named after the diagram, so the name has to be as live as the menu that renames
  // it: the index is written from outside this component.
  const revision = useSyncExternalStore(subscribeProjects, projectsRevision, projectsRevision)
  // projectName() reads the index out of localStorage, which oxlint cannot see, so it reports
  // `revision` as unnecessary. It is what makes a rename reach the export filenames at all.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const diagramName = useMemo(() => projectName(activeId), [activeId, revision])
  const jsonFile = exportFilename(diagramName, 'erd.json')
  const dbmlFile = exportFilename(diagramName, 'schema.dbml')
  const pngFile = exportFilename(diagramName, 'erd.png')
  const svgFile = exportFilename(diagramName, 'erd.svg')

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
      // Cmd/Ctrl+K opens the finder, but inside CodeMirror it belongs to the editor.
      if (e.key.toLowerCase() === 'k' && !isEditableTarget(e.target)) {
        e.preventDefault()
        setPalette((o) => !o)
        return
      }
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

  // Resizable split. Dragging or nudging the divider always means "this width", so either one
  // takes the panel out of its widened state rather than fighting it.
  const dragging = useRef(false)
  const [resizing, setResizing] = useState(false)
  const onDividerDown = (e: React.PointerEvent) => {
    dragging.current = true
    setResizing(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDividerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    patchPrefs({ rightWidth: paneWidthFromPointer(e.clientX, window.innerWidth), rightMaximized: false })
  }
  const onDividerUp = () => {
    dragging.current = false
    setResizing(false)
  }
  // A drag handle that only responds to a mouse is unusable without one.
  const onDividerKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    const vw = window.innerWidth
    // While widened the stored width is not what is on screen, so nudge from what is.
    const from = prefs.rightMaximized ? clampPaneWidth(vw - MIN_CANVAS_WIDTH, vw) : prefs.rightWidth
    if (e.key === 'ArrowLeft') patchPrefs({ rightWidth: clampPaneWidth(from + step, vw), rightMaximized: false })
    else if (e.key === 'ArrowRight') patchPrefs({ rightWidth: clampPaneWidth(from - step, vw), rightMaximized: false })
    else return
    e.preventDefault()
  }

  const exportJson = () => {
    const s = useSchemaStore.getState()
    track({ name: 'export', format: 'json' })
    downloadText(JSON.stringify({ v: 1, schema: s.schema, layout: s.layout }, null, 2), jsonFile, 'application/json')
    toast(`Downloaded ${jsonFile}`)
  }
  const exportDbmlFile = async () => {
    const s = useSchemaStore.getState()
    // Dynamic import keeps the (large) @dbml/core chunk out of the shell's boot path.
    const text = s.dbmlText ?? (await import('@/core/dbml')).generateDbml(s.schema)
    track({ name: 'export', format: 'dbml' })
    downloadText(text, dbmlFile, 'text/plain')
    toast(`Downloaded ${dbmlFile}`)
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

  const restoreInput = useRef<HTMLInputElement>(null)
  const downloadBackup = () => {
    session.controller.save()
    const backup = buildBackup()
    downloadText(serializeBackup(backup), backupFilename(), 'application/json')
    const n = backup.projects.length
    toast(`Backed up ${n} ${n === 1 ? 'diagram' : 'diagrams'}`)
  }
  const restoreFromFile = async (file: File) => {
    try {
      const { imported, skipped } = restoreBackup(await file.text())
      // The diagram on screen is deliberately left alone, so say where the restored ones went —
      // otherwise a successful restore looks like nothing happened.
      const n = `${imported} ${imported === 1 ? 'diagram' : 'diagrams'}`
      toast(
        skipped > 0
          ? `${n} restored (${skipped} unreadable) — open them from the diagram menu`
          : `${n} restored — open them from the diagram menu`,
      )
    } catch (err) {
      toast(err instanceof BackupError ? err.message : 'Could not read that backup file.', 'error')
    }
  }

  const showEmpty = tableCount === 0 && !blankDismissed
  const problemsCount = diagnostics.length
  // Below this width the bar cannot hold every control, so some of them move into the More menu.
  const narrow = useMediaQuery(NARROW)
  // Below this the panes take turns, so the status line at the foot of the code panel is off
  // screen whenever the canvas is the one showing.
  const stacked = useMediaQuery(STACKED)

  return (
    <div className="erd-app" data-testid="shell">
      {/* Top bar. One filled button exists in the product and it is Share; everything else is
          quieter than the diagram's own name. */}
      <header className="erd-topbar" data-testid="topbar">
        <Logo />
        <ProjectMenu controller={session.controller} activeId={activeId} onActiveChange={setActiveId} />
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

        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Undo (Ctrl+Z)" data-testid="btn-undo" disabled={past === 0} onClick={() => undo()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" data-testid="btn-redo" disabled={future === 0} onClick={() => redo()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
          </IconButton>

          <span className="erd-divider mx-1" />

          <Menu
            align="right"
            testId="more-menu"
            trigger={({ onClick }) => (
              <IconButton label="More" data-testid="btn-more" onClick={onClick}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
              </IconButton>
            )}
            items={[
              { id: 'more-start', label: <span className="erd-menu__section">Start from</span>, disabled: true, onSelect: () => {} },
              { id: 'project-examples', label: 'Examples…', onSelect: () => setGallery(true) },
              { id: 'project-import', label: 'Paste DBML or SQL…', onSelect: () => setImportOpen(true) },
              { id: 'import-json', label: 'Open .json…', onSelect: () => fileInput.current?.click() },
              { id: 'more-all', label: <span className="erd-menu__section erd-menu__section--border">All diagrams</span>, disabled: true, onSelect: () => {} },
              { id: 'backup-download', label: 'Download backup…', onSelect: downloadBackup },
              { id: 'backup-restore', label: 'Restore from backup…', onSelect: () => restoreInput.current?.click() },
              // Export and the theme toggle leave the bar on a narrow screen; they are only
              // listed here when they are not on it, so neither is reachable twice.
              ...(narrow
                ? [
                    { id: 'more-export', label: <span className="erd-menu__section erd-menu__section--border">Export</span>, disabled: true, onSelect: () => {} },
                    { id: 'narrow-export-dialog', label: 'DBML, SQL or models.py…', onSelect: () => { setExportSelectionOnly(false); setExportOpen(true) } },
                    { id: 'narrow-export-png', label: 'Export PNG', onSelect: () => { track({ name: 'export', format: 'png' }); void exportCanvasPng(pngFile) } },
                    { id: 'narrow-export-svg', label: 'Export SVG', onSelect: () => { track({ name: 'export', format: 'svg' }); void exportCanvasSvg(svgFile) } },
                    { id: 'more-view', label: <span className="erd-menu__section erd-menu__section--border">View</span>, disabled: true, onSelect: () => {} },
                    { id: 'narrow-theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', onSelect: toggleTheme },
                  ]
                : []),
              { id: 'more-help', label: <span className="erd-menu__section erd-menu__section--border">Help</span>, disabled: true, onSelect: () => {} },
              { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', onSelect: () => setShortcuts(true) },
            ]}
          />

          <IconButton
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="erd-wide-only"
            data-testid="btn-theme"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            )}
          </IconButton>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub" className="erd-iconbtn erd-wide-only">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" /></svg>
          </a>

          <Menu
            align="right"
            testId="export-menu"
            trigger={({ onClick }) => (
              <Button variant="outline" data-testid="btn-export" onClick={onClick} className="ml-1 erd-wide-only">
                Export
              </Button>
            )}
            items={[
              { id: 'export-dialog', label: 'DBML, SQL or models.py…', onSelect: () => { setExportSelectionOnly(false); setExportOpen(true) } },
              // The labels spell out the file that arrives, so the two cannot drift apart.
              { id: 'export-dbml', label: <span className="block max-w-64 truncate">Download {dbmlFile}</span>, onSelect: () => void exportDbmlFile() },
              { id: 'export-json', label: <span className="block max-w-64 truncate">Download {jsonFile}</span>, onSelect: exportJson },
              { id: 'export-png', label: 'Export PNG', onSelect: () => { track({ name: 'export', format: 'png' }); void exportCanvasPng(pngFile) } },
              { id: 'export-svg', label: 'Export SVG', onSelect: () => { track({ name: 'export', format: 'svg' }); void exportCanvasSvg(svgFile) } },
            ]}
          />
          <Button variant="primary" data-testid="btn-share" onClick={() => void shareCurrent(useSchemaStore, diagramName)}>
            Share
          </Button>
        </div>
      </header>

      {/* Main split. Side by side when there is room; below NARROW the panes take turns and the
          code panel covers the canvas instead of squeezing it. */}
      <div className="erd-main flex min-h-0 flex-1">
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
            {/* The status line lives at the foot of the code panel, so while the panel is off
                screen nothing would report a broken schema. This is that report, and it opens the
                panel on the problems list. */}
            {stacked && problemsCount > 0 && (
              <button
                type="button"
                className={clsx('erd-railbadge', counts.error > 0 ? 'erd-railbadge--error' : 'erd-railbadge--warning')}
                data-testid="rail-problems"
                aria-label={`${problemsCount} ${problemsCount === 1 ? 'problem' : 'problems'}, open the code panel`}
                onClick={() => patchPrefs({ rightCollapsed: false, problemsOpen: true })}
              >
                {problemsCount}
              </button>
            )}
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
              title="Drag to resize the code panel"
              tabIndex={0}
              className="erd-resize"
              data-testid="resize-right"
              data-dragging={resizing ? 'true' : undefined}
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onKeyDown={onDividerKey}
            />

            <aside
              className="erd-rightpane"
              /* Not `width`: an inline width would outrank the narrow layout's rule. */
              style={{ '--erd-pane-w': paneWidthCss(prefs.rightWidth, prefs.rightMaximized) } as CSSProperties}
              data-testid="right-pane"
            >
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
                {/* Three sizes of the same decision: how much room the code gets. Wrapping is the
                    answer that costs no width at all, so it comes first. */}
                <div className="erd-rightpane__tools">
                  <button
                    type="button"
                    className="erd-collapse"
                    data-testid="btn-wrap"
                    aria-pressed={prefs.wrap}
                    aria-label={prefs.wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
                    title={prefs.wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
                    onClick={() => patchPrefs({ wrap: !prefs.wrap })}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6h16" />
                      <path d="M4 12h13a3 3 0 0 1 0 6H8" />
                      <path d="m11 15-3 3 3 3" />
                    </svg>
                  </button>
                  {/* Below 860px the panel already covers the window, so widening it means nothing
                      and the control would be one more thing in the way. */}
                  {!stacked && (
                    <button
                      type="button"
                      className="erd-collapse"
                      data-testid="btn-maximize-right"
                      aria-pressed={prefs.rightMaximized}
                      aria-label={prefs.rightMaximized ? 'Restore the code panel width' : 'Widen the code panel'}
                      title={prefs.rightMaximized ? 'Restore the code panel width' : 'Widen the code panel'}
                      onClick={() => patchPrefs({ rightMaximized: !prefs.rightMaximized })}
                    >
                      {prefs.rightMaximized ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 5v14" /><path d="m5 7 5 5-5 5" /><path d="m11 7 5 5-5 5" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 5v14" /><path d="m16 7-5 5 5 5" /><path d="m10 7-5 5 5 5" />
                        </svg>
                      )}
                    </button>
                  )}
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
              </div>

              <div className="min-h-0 flex-1">
                <div className={clsx('h-full', prefs.tab !== 'dbml' && 'hidden')}>
                  <Pane name="DBML editor">
                    <DbmlEditor wrap={prefs.wrap} />
                  </Pane>
                </div>
                <div className={clsx('h-full', prefs.tab !== 'django' && 'hidden')}>
                  <Pane name="Django editor">
                    <DjangoEditor wrap={prefs.wrap} />
                  </Pane>
                </div>
                {prefs.tab === 'demo' && (
                  <div className="h-full">
                    <Pane name="Demo">
                      <DemoPanel wrap={prefs.wrap} />
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
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Pane name="Import dialog">
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      </Pane>
      <Pane name="Export dialog">
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} initialSelectionOnly={exportSelectionOnly} diagramName={diagramName} />
      </Pane>
    </div>
  )
}

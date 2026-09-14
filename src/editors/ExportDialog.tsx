/**
 * Export dialog (M2 / M8): DBML, Postgres, MySQL, SQLite, Django models.py, JSON.
 */
import { useEffect, useMemo, useState } from 'react'
import { python } from '@codemirror/lang-python'
import type { Diagnostic, Layout, Schema } from '@/core/schema'
import { generateDbml } from '@/core/dbml'
import { exportSql } from '@/core/sql'
import { generateDjango } from '@/core/django'
import { useSchemaStore } from '@/store'
import { useCanvasUi } from '@/canvas/uiStore'
import { schemaSubset } from '@/canvas/clipboard'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { dbml } from './dbml-language'
import { CopyButton } from '@/app/CopyButton'
import { Modal } from './Modal'
import { track } from '@/app/analytics'
import { Button } from '@/app/ui'

export type ExportFormat = 'dbml' | 'postgres' | 'mysql' | 'sqlite' | 'django' | 'json'

export interface ExportDialogProps {
  open: boolean
  onClose: () => void
  initialFormat?: ExportFormat
  /** Open with the export scoped to the canvas selection. */
  initialSelectionOnly?: boolean
}

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; file: string; mime: string }> = [
  { id: 'dbml', label: 'DBML', file: 'schema.dbml', mime: 'text/plain' },
  { id: 'postgres', label: 'PostgreSQL', file: 'schema.postgres.sql', mime: 'application/sql' },
  { id: 'mysql', label: 'MySQL', file: 'schema.mysql.sql', mime: 'application/sql' },
  { id: 'sqlite', label: 'SQLite', file: 'schema.sqlite.sql', mime: 'application/sql' },
  { id: 'django', label: 'Django models.py', file: 'models.py', mime: 'text/x-python' },
  { id: 'json', label: 'JSON', file: 'schema.json', mime: 'application/json' },
]

/**
 * Produce the export text + diagnostics for a format. Never throws.
 * Async because the SQL exporters load @dbml/core on demand (it stays out of the main chunk).
 */
export async function renderExport(format: ExportFormat, schema: Schema, layout: Layout): Promise<{ text: string; diagnostics: Diagnostic[] }> {
  try {
    switch (format) {
      case 'dbml':
        return { text: generateDbml(schema), diagnostics: [] }
      case 'postgres':
      case 'mysql':
      case 'sqlite':
        return await exportSql(schema, format)
      case 'django':
        return generateDjango(schema)
      case 'json':
        return { text: JSON.stringify({ schema, layout }, null, 2) + '\n', diagnostics: [] }
    }
  } catch (e) {
    return {
      text: '',
      diagnostics: [{ id: 'export-throw', severity: 'error', source: format === 'django' ? 'django' : format === 'dbml' ? 'dbml' : 'sql', message: (e as Error).message ?? 'export failed' }],
    }
  }
}

export function downloadText(fileName: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ExportDialog({ open, onClose, initialFormat = 'dbml', initialSelectionOnly = false }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat)
  const fullSchema = useSchemaStore((s) => s.schema)
  const selectedIds = useCanvasUi((s) => s.multiSelect)
  const [selectionOnly, setSelectionOnly] = useState(initialSelectionOnly)
  const canScope = selectedIds.length > 0
  // Memoised: schemaSubset builds a new object, and this feeds the render effect's dependencies,
  // so recomputing it every render spun into an endless render loop.
  const selectedKey = selectedIds.join(',')
  const schema = useMemo(
    () => (canScope && selectionOnly ? schemaSubset(fullSchema, selectedIds) : fullSchema),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullSchema, canScope, selectionOnly, selectedKey],
  )
  const layout = useSchemaStore((s) => s.layout)
  const dbmlText = useSchemaStore((s) => s.dbmlText)
  const origin = useSchemaStore((s) => s.origin)

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setFormat(initialFormat)
      setSelectionOnly(initialSelectionOnly)
    }
  }

  // Prefer the user's own DBML formatting when the DBML editor is authoritative.
  const authored = format === 'dbml' && origin === 'dbml' && dbmlText !== null && !(canScope && selectionOnly) ? dbmlText : null
  const [rendered, setRendered] = useState<{ text: string; diagnostics: Diagnostic[] }>({ text: '', diagnostics: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (authored !== null) {
      setLoading(false)
      setRendered({ text: authored, diagnostics: [] })
      return
    }
    // The SQL formats load @dbml/core on demand, which takes a moment the first time. Clear the
    // preview while that runs: showing the previous format's text reads as a wrong export.
    let live = true
    setLoading(true)
    setRendered({ text: '', diagnostics: [] })
    void renderExport(format, schema, layout).then((r) => {
      if (!live) return
      setRendered(r)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [format, schema, layout, authored])

  const { text, diagnostics } = rendered

  const meta = EXPORT_FORMATS.find((f) => f.id === format)!
  const extensions = useMemo(() => {
    if (format === 'dbml') return [dbml(() => schema)]
    if (format === 'django') return [python()]
    return []
  }, [format, schema])

  return (
    <Modal open={open} onClose={onClose} title="Export" testId="export-dialog" widthClass="max-w-4xl">
      <div className="erd-tabbar" role="tablist">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.id}
            role="tab"
            type="button"
            aria-selected={format === f.id}
            data-testid={`export-tab-${f.id}`}
            onClick={() => setFormat(f.id)}
            className="erd-tab"
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <div className="erd-muted flex flex-wrap items-center gap-3 text-xs">
          <span data-testid="export-filename">{meta.file}</span>
          {canScope && (
            <label className="flex items-center gap-1" data-testid="export-selection-only">
              <input className="erd-check" type="checkbox" checked={selectionOnly} onChange={(e) => setSelectionOnly(e.target.checked)} />
              Selected tables only ({selectedIds.length})
            </label>
          )}
          {loading && (
            <span data-testid="export-loading" className="erd-fg">
              Generating {meta.label}…
            </span>
          )}
          <span className="flex-1" />
          <span data-testid="export-copy">
            <CopyButton text={text} label={meta.label} />
          </span>
          <Button
            variant="primary"
            size="sm"
            data-testid="export-download"
            disabled={loading || text === ''}
            onClick={() => {
              track({ name: 'export', format })
              downloadText(meta.file, text, meta.mime)
            }}
          >
            Download
          </Button>
        </div>
        <div className="erd-frame h-[55vh] min-h-48">
          <CodeMirrorEditor testId="export-preview" value={text} readOnly extensions={extensions} diagnostics={diagnostics} />
        </div>
        {diagnostics.length > 0 && (
          <ul data-testid="export-diagnostics" className="max-h-32 space-y-1 overflow-auto text-xs">
            {diagnostics.map((d) => (
              <li key={d.id} className={d.severity === 'error' ? 'erd-sev-error' : 'erd-sev-warning'}>
                <span className="erd-note__kind">{d.severity}</span>
                {d.lossy && <span className="erd-lossy ml-1">lossy</span>}
                <span className="ml-2">{d.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

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
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { dbml } from './dbml-language'
import { CopyButton } from '@/app/CopyButton'
import { Modal } from './Modal'

export type ExportFormat = 'dbml' | 'postgres' | 'mysql' | 'sqlite' | 'django' | 'json'

export interface ExportDialogProps {
  open: boolean
  onClose: () => void
  initialFormat?: ExportFormat
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

export function ExportDialog({ open, onClose, initialFormat = 'dbml' }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat)
  const schema = useSchemaStore((s) => s.schema)
  const layout = useSchemaStore((s) => s.layout)
  const dbmlText = useSchemaStore((s) => s.dbmlText)
  const origin = useSchemaStore((s) => s.origin)

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setFormat(initialFormat)
  }

  // Prefer the user's own DBML formatting when the DBML editor is authoritative.
  const authored = format === 'dbml' && origin === 'dbml' && dbmlText !== null ? dbmlText : null
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
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-2 dark:border-zinc-800" role="tablist">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.id}
            role="tab"
            type="button"
            aria-selected={format === f.id}
            data-testid={`export-tab-${f.id}`}
            onClick={() => setFormat(f.id)}
            className={`-mb-px rounded-t border-b-2 px-3 py-1.5 text-sm ${
              format === f.id
                ? 'border-blue-500 font-medium text-blue-600 dark:text-blue-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span data-testid="export-filename">{meta.file}</span>
          {loading && (
            <span data-testid="export-loading" className="text-blue-600 dark:text-blue-400">
              Generating {meta.label}…
            </span>
          )}
          <span className="flex-1" />
          <span data-testid="export-copy">
            <CopyButton text={text} label={meta.label} />
          </span>
          <button
            type="button"
            data-testid="export-download"
            disabled={loading || text === ''}
            onClick={() => downloadText(meta.file, text, meta.mime)}
            className="rounded bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download
          </button>
        </div>
        <div className="h-[55vh] min-h-48 overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
          <CodeMirrorEditor testId="export-preview" value={text} readOnly extensions={extensions} diagnostics={diagnostics} />
        </div>
        {diagnostics.length > 0 && (
          <ul data-testid="export-diagnostics" className="max-h-32 space-y-1 overflow-auto text-xs">
            {diagnostics.map((d) => (
              <li key={d.id} className={d.severity === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}>
                <span className="font-medium uppercase">{d.severity}</span>
                {d.lossy && <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">lossy</span>}
                <span className="ml-2">{d.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

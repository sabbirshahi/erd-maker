/**
 * Import dialog (M1 / M3): paste or drop DBML, SQL DDL, or Django models.py.
 */
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import type { Diagnostic, Schema } from '@/core/schema'
import { parseDbml } from '@/core/dbml'
import { importSql, type SqlImportDialect } from '@/core/sql'
import { initDjangoParser, parseDjango } from '@/core/django'
import { reconcile } from '@/core/reconcile'
import { useSchemaStore } from '@/store'
import { Modal } from './Modal'
import { toast } from '@/app/toast'

export type ImportKind = 'dbml' | 'sql' | 'django'
export type ImportDialect = SqlImportDialect | 'auto'

export interface ImportDialogProps {
  open: boolean
  onClose: () => void
  /** Initial tab. */
  initialKind?: ImportKind
}

const TABS: Array<{ id: ImportKind; label: string; accept: string; placeholder: string }> = [
  { id: 'dbml', label: 'DBML', accept: '.dbml,.txt', placeholder: 'Table users {\n  id int [pk, increment]\n  email varchar(254) [not null, unique]\n}' },
  { id: 'sql', label: 'SQL', accept: '.sql,.ddl,.txt', placeholder: 'CREATE TABLE users (\n  id serial PRIMARY KEY,\n  email varchar(254) NOT NULL UNIQUE\n);' },
  { id: 'django', label: 'Django models.py', accept: '.py', placeholder: 'from django.db import models\n\nclass User(models.Model):\n    email = models.EmailField(unique=True)' },
]

const DIALECTS: Array<{ id: ImportDialect; label: string }> = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'mssql', label: 'SQL Server' },
]

/** Guess the import kind from a file name. */
export function kindFromFileName(name: string): ImportKind | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.dbml')) return 'dbml'
  if (lower.endsWith('.sql') || lower.endsWith('.ddl')) return 'sql'
  if (lower.endsWith('.py')) return 'django'
  return null
}

export interface ImportOutcome {
  schema?: Schema
  diagnostics: Diagnostic[]
}

/** Run the import pipeline for `kind`. Never throws. */
export async function runImport(kind: ImportKind, text: string, dialect: ImportDialect): Promise<ImportOutcome> {
  try {
    if (kind === 'dbml') return parseDbml(text)
    if (kind === 'sql') {
      const imported = importSql(text, dialect)
      if (!imported.dbml) return { diagnostics: imported.diagnostics }
      const parsed = parseDbml(imported.dbml)
      return { schema: parsed.schema, diagnostics: [...imported.diagnostics, ...parsed.diagnostics] }
    }
    await initDjangoParser()
    return await parseDjango(text)
  } catch (e) {
    return {
      diagnostics: [
        { id: 'import-throw', severity: 'error', source: kind === 'django' ? 'django' : kind === 'sql' ? 'sql' : 'dbml', message: (e as Error).message ?? 'import failed' },
      ],
    }
  }
}

/** Ask worker-2's canvas to place tables that have no layout yet (optional dependency). */
const canvasModules = import.meta.glob<{ autoLayout?: (opts?: { onlyUnplaced?: boolean }) => unknown }>('../canvas/index.{ts,tsx}')
export async function autoLayoutIfAvailable(): Promise<void> {
  const loader = Object.values(canvasModules)[0]
  if (!loader) return
  try {
    const mod = await loader()
    await mod.autoLayout?.({ onlyUnplaced: true })
  } catch {
    // canvas not ready — positions will be assigned when it mounts
  }
}

export function ImportDialog({ open, onClose, initialKind = 'dbml' }: ImportDialogProps) {
  const [kind, setKind] = useState<ImportKind>(initialKind)
  const [text, setText] = useState('')
  const [dialect, setDialect] = useState<ImportDialect>('auto')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Reset the tab each time the dialog opens (state adjustment during render, no effect).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setKind(initialKind)
      setDiagnostics([])
    }
  }

  const tab = TABS.find((t) => t.id === kind)!
  const lines = useMemo(() => text.split('\n'), [text])
  const errors = diagnostics.filter((d) => d.severity === 'error')

  const readFile = useCallback(async (file: File) => {
    const content = await file.text()
    setText(content)
    setFileName(file.name)
    const guessed = kindFromFileName(file.name)
    if (guessed) setKind(guessed)
    setDiagnostics([])
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void readFile(file)
    },
    [readFile],
  )

  const doImport = useCallback(async () => {
    if (!text.trim()) {
      setDiagnostics([{ id: 'empty', severity: 'error', source: 'dbml', message: 'Nothing to import — paste some text or drop a file.' }])
      return
    }
    setBusy(true)
    try {
      const result = await runImport(kind, text, dialect)
      const hasError = result.diagnostics.some((d) => d.severity === 'error')
      if (hasError || !result.schema) {
        setDiagnostics(result.diagnostics.length ? result.diagnostics : [{ id: 'unknown', severity: 'error', source: 'dbml', message: 'Import produced no schema.' }])
        return
      }
      const store = useSchemaStore.getState()
      const merged = reconcile(store.schema, result.schema)
      store.commit('import', merged)
      const source = kind === 'django' ? 'django' : kind === 'sql' ? 'sql' : 'dbml'
      store.setDiagnostics(source, result.diagnostics)
      void autoLayoutIfAvailable()
      toast(`Imported ${merged.tables.length} table${merged.tables.length === 1 ? '' : 's'}`)
      setText('')
      setFileName(null)
      setDiagnostics([])
      onClose()
    } finally {
      setBusy(false)
    }
  }, [kind, text, dialect, onClose])

  return (
    <Modal open={open} onClose={onClose} title="Import" testId="import-dialog">
      <div className="flex gap-1 border-b border-zinc-200 px-4 pt-2 dark:border-zinc-800" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={kind === t.id}
            data-testid={`import-tab-${t.id}`}
            onClick={() => {
              setKind(t.id)
              setDiagnostics([])
            }}
            className={`-mb-px rounded-t border-b-2 px-3 py-1.5 text-sm ${
              kind === t.id
                ? 'border-blue-500 font-medium text-blue-600 dark:text-blue-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`relative rounded border ${dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-300 dark:border-zinc-700'}`}
          data-testid="import-dropzone"
        >
          <textarea
            data-testid="import-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setDiagnostics([])
            }}
            placeholder={tab.placeholder}
            spellCheck={false}
            className="block h-64 w-full resize-y bg-transparent p-3 font-mono text-xs outline-none"
          />
          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-blue-600">
              Drop {tab.label} file
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            ref={fileInput}
            type="file"
            accept={tab.accept}
            className="hidden"
            data-testid="import-file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Choose file…
          </button>
          <span className="text-xs text-zinc-500">{fileName ?? `or drop a ${tab.accept.split(',')[0]} file above`}</span>
          <span className="flex-1" />
          {kind === 'sql' && (
            <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
              Dialect
              <select
                data-testid="import-dialect"
                value={dialect}
                onChange={(e) => setDialect(e.target.value as ImportDialect)}
                className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                {DIALECTS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            data-testid="import-submit"
            disabled={busy}
            onClick={() => void doImport()}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>

        {diagnostics.length > 0 && (
          <ul data-testid="import-errors" className="max-h-48 space-y-1 overflow-auto text-xs">
            {diagnostics.map((d) => (
              <li
                key={d.id}
                className={`rounded border px-2 py-1 ${
                  d.severity === 'error'
                    ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                }`}
              >
                <div>
                  <span className="font-medium uppercase">{d.severity}</span>
                  {d.line !== undefined && <span className="ml-1 text-zinc-500">line {d.line}{d.col !== undefined ? `:${d.col}` : ''}</span>}
                  <span className="ml-2">{d.message}</span>
                </div>
                {d.line !== undefined && lines[d.line - 1] !== undefined && (
                  <pre className="mt-1 overflow-x-auto rounded bg-white/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-black/30 dark:text-zinc-300">
                    {String(d.line).padStart(3)} │ {lines[d.line - 1]}
                  </pre>
                )}
              </li>
            ))}
            {errors.length === 0 && <li className="text-zinc-500">Warnings only — import will proceed.</li>}
          </ul>
        )}
      </div>
    </Modal>
  )
}

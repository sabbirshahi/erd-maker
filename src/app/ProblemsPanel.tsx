/**
 * M6 Problems panel: all diagnostics grouped by severity, filter chips, "lossy only" toggle.
 * Clicking a row selects the table/column and dispatches `erd:goto` ({ view, line, col })
 * on `window` so the owning text editor can scroll to the location (listener: worker-3).
 */
import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import type { Diagnostic, DiagnosticSeverity, DiagnosticSource } from '@/core/schema'
import { findColumn, findTable } from '@/core/schema'
import { useAllDiagnostics, useSchemaStore, type TextView } from '@/store'

export interface GotoEventDetail {
  view: TextView
  line: number
  col?: number
}

export const GOTO_EVENT = 'erd:goto'

const SOURCE_VIEW: Partial<Record<DiagnosticSource, TextView>> = { dbml: 'dbml', django: 'django' }

export function gotoDiagnostic(d: Diagnostic) {
  const store = useSchemaStore.getState()
  if (d.tableId) store.select({ tableId: d.tableId, columnId: d.columnId, refId: d.refId })
  else if (d.refId) store.select({ refId: d.refId })
  const view = SOURCE_VIEW[d.source]
  if (view && d.line) {
    window.dispatchEvent(
      new CustomEvent<GotoEventDetail>(GOTO_EVENT, { detail: { view, line: d.line, col: d.col } }),
    )
  }
}

const ORDER: DiagnosticSeverity[] = ['error', 'warning', 'info']

export function countBySeverity(list: Diagnostic[]): Record<DiagnosticSeverity, number> {
  const out: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 }
  for (const d of list) out[d.severity]++
  return out
}

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  const cls = severity === 'error' ? 'text-red-500' : severity === 'warning' ? 'text-amber-500' : 'text-sky-500'
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={clsx('shrink-0', cls)} aria-label={severity}>
      {severity === 'error' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </>
      )}
      {severity === 'warning' && (
        <>
          <path d="M12 3 2 21h20L12 3z" />
          <path d="M12 10v5M12 18h.01" />
        </>
      )}
      {severity === 'info' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </>
      )}
    </svg>
  )
}

export function ProblemsPanel({ onGoto }: { onGoto?: (view: TextView) => void }) {
  const all = useAllDiagnostics()
  const schema = useSchemaStore((s) => s.schema)
  const [enabled, setEnabled] = useState<Record<DiagnosticSeverity, boolean>>({ error: true, warning: true, info: true })
  const [lossyOnly, setLossyOnly] = useState(false)

  const counts = useMemo(() => countBySeverity(all), [all])
  const visible = useMemo(
    () =>
      ORDER.flatMap((sev) =>
        enabled[sev] ? all.filter((d) => d.severity === sev && (!lossyOnly || d.lossy)) : [],
      ),
    [all, enabled, lossyOnly],
  )

  const location = (d: Diagnostic): string => {
    const parts: string[] = []
    if (d.tableId) {
      const t = findTable(schema, d.tableId)
      if (t) {
        const c = d.columnId ? findColumn(schema, d.tableId, d.columnId) : undefined
        parts.push(c ? `${t.name}.${c.name}` : t.name)
      }
    }
    if (d.line) parts.push(`${d.source}:${d.line}${d.col ? `:${d.col}` : ''}`)
    return parts.join(' · ')
  }

  return (
    <div className="flex h-full flex-col" data-testid="problems-panel">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
        {ORDER.map((sev) => (
          <button
            key={sev}
            type="button"
            data-testid={`filter-${sev}`}
            aria-pressed={enabled[sev]}
            onClick={() => setEnabled((e) => ({ ...e, [sev]: !e[sev] }))}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 capitalize',
              enabled[sev]
                ? 'border-zinc-400 bg-zinc-100 text-zinc-800 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100'
                : 'border-zinc-200 text-zinc-400 dark:border-zinc-700',
            )}
          >
            <SeverityIcon severity={sev} /> {sev}s <span className="tabular-nums">{counts[sev]}</span>
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" data-testid="filter-lossy" checked={lossyOnly} onChange={(e) => setLossyOnly(e.target.checked)} />
          lossy only
        </label>
      </div>
      <div className="flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-400" data-testid="problems-empty">
            {all.length === 0 ? 'No problems. Nice.' : 'Nothing matches the current filters.'}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
            {visible.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  data-testid="problem-row"
                  data-severity={d.severity}
                  onClick={() => {
                    gotoDiagnostic(d)
                    const view = SOURCE_VIEW[d.source]
                    if (view) onGoto?.(view)
                  }}
                  className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <SeverityIcon severity={d.severity} />
                  <span className="rounded bg-zinc-200 px-1 font-mono text-[10px] uppercase text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                    {d.source}
                  </span>
                  {d.lossy && (
                    <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700 dark:bg-sky-900 dark:text-sky-200">lossy</span>
                  )}
                  <span className="flex-1 text-zinc-800 dark:text-zinc-100">{d.message}</span>
                  <span className="shrink-0 font-mono text-zinc-400">{location(d)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

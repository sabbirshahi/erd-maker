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
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 erd-sev--${severity}`} aria-label={severity}>
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

const SOURCE_LABEL: Record<DiagnosticSource, string> = {
  dbml: 'DBML',
  django: 'Django models',
  sql: 'SQL',
  canvas: 'Schema',
  demo: 'Demo',
  typemap: 'Django mapping',
}

/** Renders `backticked` fragments of a message as code chips. */
function Message({ text }: { text: string }) {
  const parts = text.split(/(`[^`]*`)/g).filter(Boolean)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={i} className="erd-code-chip">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
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

  /**
   * Rows grouped by the check that produced them. Several instances of one problem read as a single
   * finding with a count, rather than as a wall of near-identical lines.
   */
  const groups = useMemo(() => {
    const byRule = new Map<string, Diagnostic[]>()
    for (const d of visible) {
      // Without a named check, group by where it came from. Deriving a pseudo-rule from the
      // message text just repeated the row underneath it.
      const key = d.rule ?? SOURCE_LABEL[d.source]
      const list = byRule.get(key)
      if (list) list.push(d)
      else byRule.set(key, [d])
    }
    return [...byRule.entries()]
  }, [visible])

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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
    <div className="erd-problems" data-testid="problems-panel">
      <div className="erd-problems__filters">
        {ORDER.map((sev) => (
          <button
            key={sev}
            type="button"
            data-testid={`filter-${sev}`}
            aria-pressed={enabled[sev]}
            onClick={() => setEnabled((e) => ({ ...e, [sev]: !e[sev] }))}
            className="erd-chip-toggle"
          >
            <SeverityIcon severity={sev} /> {sev}s <span className="tabular-nums">{counts[sev]}</span>
          </button>
        ))}
        <label className="erd-problems__lossy">
          <input type="checkbox" data-testid="filter-lossy" checked={lossyOnly} onChange={(e) => setLossyOnly(e.target.checked)} />
          lossy only
        </label>
      </div>
      <div className="erd-problems__body">
        {visible.length === 0 ? (
          <div className="erd-problems__empty" data-testid="problems-empty">
            {all.length === 0 ? 'No problems. Nice.' : 'Nothing matches the current filters.'}
          </div>
        ) : (
          <div>
            {groups.map(([rule, rows]) => (
              <section key={rule} data-testid="problem-group" data-rule={rule}>
                <button
                  type="button"
                  data-testid="problem-group-header"
                  onClick={() => setCollapsed((c) => ({ ...c, [rule]: !c[rule] }))}
                  className="erd-problems__group"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={clsx('transition-transform', !collapsed[rule] && 'rotate-90')}>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                  {rule}
                  <span className="tabular-nums opacity-70">{rows.length}</span>
                </button>
                {!collapsed[rule] && (
                  <ul className="erd-problems__rows">
                    {rows.map((d) => (
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
                          className="erd-problems__row"
                        >
                          <SeverityIcon severity={d.severity} />
                          <span className="flex-1 leading-relaxed">
                            <Message text={d.message} />
                          </span>
                          {d.lossy && (
                            <span className="erd-problems__lossy-tag">lossy</span>
                          )}
                          <span className="erd-problems__where">{location(d)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

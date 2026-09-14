/**
 * Demo panel: boots real Django + SQLite in the browser (Pyodide worker), seeds fake rows for the
 * current schema, and runs SQL / ORM snippets against them. OWNER: worker-5 (demo). Plan §3 Phase 5.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { python } from '@codemirror/lang-python'
import { generateDjango } from '@/core/django'
import { DEFAULT_ROWS, generateFakeData, type FakeDataset } from '@/core/fake'
import { topologicalTables, type Schema } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { CodeMirrorEditor } from '@/editors'
import { CopyButton } from '@/app/CopyButton'
import { Button } from '@/app/ui'
import { getDemoClient, type DemoClient } from './client'
import { buildSnippets, isUnsupportedDevice } from './util'
import {
  DemoError,
  overallPct,
  STAGE_LABEL,
  type BootResult,
  type BuildResult,
  type ProgressEvent,
  type QueryResult,
} from './protocol'
import { track } from '@/app/analytics'

export interface DemoPanelProps {
  className?: string
  /** Injectable for tests. */
  client?: DemoClient
}

type Phase = 'idle' | 'booting' | 'building' | 'ready' | 'failed'
type Tab = 'sql' | 'orm'

const MIN_SLIDER = 5
const MAX_SLIDER = 200
const ROW_H = 28
const OVERSCAN = 6

function firstTableName(schema: Schema): string | undefined {
  return topologicalTables(schema)[0]?.name
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function DemoPanel({ className, client: injected }: DemoPanelProps) {
  const client = useMemo(() => injected ?? getDemoClient(), [injected])
  const schema = useSchemaStore((s) => s.schema)
  const version = useSchemaStore((s) => s.version)

  const [unsupported] = useState(() => isUnsupportedDevice())
  const [phase, setPhase] = useState<Phase>(() => (client.booted ? 'ready' : 'idle'))
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [boot, setBoot] = useState<BootResult | null>(null)
  const [build, setBuild] = useState<BuildResult | null>(null)
  const [builtVersion, setBuiltVersion] = useState<number | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const [rows, setRows] = useState(DEFAULT_ROWS)
  const [seed, setSeed] = useState(42)
  const [tab, setTab] = useState<Tab>('sql')
  const [sqlText, setSqlText] = useState(
    () => `SELECT * FROM ${firstTableName(schema) ?? 'users'} LIMIT 20;`,
  )
  const [ormText, setOrmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorStdout, setErrorStdout] = useState<string | null>(null)

  const modelsPy = useMemo(() => generateDjango(schema).text, [schema])
  const snippets = useMemo(() => buildSnippets(modelsPy), [modelsPy])

  // Default the ORM editor to the first snippet once models exist.
  useEffect(() => {
    if (!ormText && snippets[0]) setOrmText(snippets[0].code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippets.length > 0])

  useEffect(() => client.onProgress(setProgress), [client])

  const buildArgs = useCallback(
    async (rowsPerTable: number, seedValue: number) => {
      const dataset = await generateFakeData(schema, rowsPerTable, seedValue)
      return {
        modelsPy,
        tableOrder: topologicalTables(schema).map((t) => t.name),
        dataset,
      }
    },
    [schema, modelsPy],
  )

  const doBuild = useCallback(async () => {
    setPhase('building')
    setFatal(null)
    // Counted once per build, which is what "started demo mode" means in practice.
    track({ name: 'demo-started' })
    try {
      const args = await buildArgs(rows, seed)
      const info = await client.build(args)
      setBuild(info)
      setBuiltVersion(version)
      setPhase('ready')
    } catch (e) {
      setFatal((e as Error).message)
      setPhase(client.booted ? 'ready' : 'failed')
    }
  }, [buildArgs, client, rows, seed, version])

  const start = useCallback(async () => {
    setPhase('booting')
    setFatal(null)
    setProgress({ stage: 'download', message: 'Starting worker…' })
    try {
      const info = await client.boot()
      setBoot(info)
    } catch (e) {
      setFatal((e as Error).message)
      setPhase('failed')
      return
    }
    await doBuild()
  }, [client, doBuild])

  const applyReset = useCallback(
    async (dataset?: FakeDataset) => {
      setPhase('building')
      setFatal(null)
      try {
        const info = await client.reset(dataset)
        setBuild(info)
        setPhase('ready')
      } catch (e) {
        setFatal((e as Error).message)
        setPhase('ready')
      }
    },
    [client],
  )

  const regenerate = useCallback(async () => {
    if (builtVersion !== version) return doBuild()
    const dataset = await generateFakeData(schema, rows, seed)
    return applyReset(dataset)
  }, [applyReset, builtVersion, doBuild, rows, schema, seed, version])

  const run = useCallback(async () => {
    if (phase !== 'ready' || busy) return
    setBusy(true)
    setError(null)
    setErrorStdout(null)
    try {
      const r = tab === 'sql' ? await client.sql(sqlText) : await client.orm(ormText)
      setResult(r)
    } catch (e) {
      const err = e as DemoError
      setError(err.message)
      setErrorStdout(err instanceof DemoError && err.stdout ? err.stdout : null)
    } finally {
      setBusy(false)
    }
  }, [busy, client, ormText, phase, sqlText, tab])

  const runRef = useRef(run)
  runRef.current = run
  const runKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              void runRef.current()
              return true
            },
          },
        ]),
      ),
    [],
  )
  const sqlExtensions = useMemo(() => [runKeymap], [runKeymap])
  const ormExtensions = useMemo(() => [runKeymap, python()], [runKeymap])

  const schemaChanged = phase === 'ready' && builtVersion !== null && version !== builtVersion
  const statusText =
    phase === 'idle'
      ? 'Not started'
      : phase === 'failed'
        ? 'Failed'
        : phase === 'ready'
          ? build
            ? `Ready — ${build.appLabel}, ${build.tables.length} tables, ${build.rows} rows, ${build.checks.length === 0 ? 'checks OK' : `${build.checks.length} check issue${build.checks.length === 1 ? '' : 's'}`}`
            : 'Ready'
          : progress
            ? `${STAGE_LABEL[progress.stage]}: ${progress.message}`
            : 'Working…'

  if (unsupported) {
    return (
      <div
        data-testid="demo-unsupported"
        className={clsx('erd-muted flex h-full items-center justify-center p-6 text-center', className)}
      >
        Demo needs a desktop browser — it downloads a 15 MB Python runtime and runs Django in a Web
        Worker.
      </div>
    )
  }

  return (
    <div
      data-testid="demo-panel"
      className={clsx('flex h-full min-h-0 flex-col text-sm', className)}
    >
      {/* Header / status */}
      <div className="erd-bar erd-bar--wrap">
        {phase === 'idle' || phase === 'failed' ? (
          <Button variant="primary" size="sm" data-testid="demo-start" onClick={() => void start()}>
            {phase === 'failed' ? 'Retry demo' : 'Start demo (≈ 15 MB, first time only)'}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              data-testid="demo-regenerate"
              disabled={phase !== 'ready'}
              onClick={() => void regenerate()}
            >
              Regenerate
            </Button>
            <Button
              size="sm"
              data-testid="demo-reset"
              disabled={phase !== 'ready'}
              onClick={() => void applyReset()}
            >
              Reset
            </Button>
          </>
        )}
        <span
          data-testid="demo-status"
          data-checks={build ? build.checks.length : undefined}
          className={clsx(
            'ml-auto truncate',
            phase === 'ready' ? 'erd-sev-ok' : phase === 'failed' ? 'erd-sev-error' : 'erd-muted',
          )}
          title={
            boot
              ? `Pyodide ${boot.pyodide} · Python ${boot.python} · Django ${boot.django} · boot ${boot.bootMs} ms`
              : undefined
          }
        >
          {statusText}
        </span>
      </div>

      {(phase === 'booting' || phase === 'building') && (
        <div
          className="erd-strip erd-muted px-3 py-2 text-xs"
          data-testid="demo-progress"
        >
          <div className="erd-progress">
            <div
              className="erd-progress__fill"
              style={{ width: `${progress ? overallPct(progress) : 2}%` }}
            />
          </div>
          <div className="mt-1 truncate">
            {progress ? `${STAGE_LABEL[progress.stage]} — ${progress.message}` : 'Starting…'}
          </div>
        </div>
      )}

      {build && build.checks.length > 0 && (
        <ul
          data-testid="demo-checks"
          className="erd-strip max-h-32 shrink-0 overflow-auto px-3 py-1.5 text-xs"
        >
          {build.checks.map((c, i) => {
            const isError = c.level === 'ERROR' || c.level === 'CRITICAL'
            return (
              <li
                key={`${c.id}-${i}`}
                data-level={c.level}
                className={clsx('flex gap-2 py-0.5', isError ? 'erd-sev-error' : 'erd-sev-warning')}
              >
                <span className="shrink-0 font-mono">{c.id}</span>
                <span className="min-w-0 flex-1">
                  {c.obj ? <span className="font-mono">{c.obj}: </span> : null}
                  {c.msg}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {schemaChanged && (
        <div
          data-testid="demo-rebuild-banner"
          className="erd-banner erd-banner--row erd-banner--warning"
        >
          <span className="flex-1">Schema changed since the last build.</span>
          <Button size="sm" data-testid="demo-rebuild" onClick={() => void doBuild()}>
            Rebuild
          </Button>
        </div>
      )}

      {fatal && (
        <pre
          data-testid="demo-fatal"
          className="erd-banner erd-banner--danger erd-banner--pre max-h-40"
        >
          {fatal}
        </pre>
      )}

      {/* Seed controls */}
      <div className="erd-bar erd-bar--wrap">
        <label className="flex items-center gap-2">
          <span>Rows / table</span>
          <input
            data-testid="demo-rows"
            type="range"
            min={MIN_SLIDER}
            max={MAX_SLIDER}
            step={5}
            value={rows}
            onChange={(e) => setRows(Number(e.target.value))}
            className="erd-range w-28"
          />
          <span data-testid="demo-rows-value" className="w-8 tabular-nums">
            {rows}
          </span>
        </label>
        <label className="flex items-center gap-2">
          <span>Seed</span>
          <input
            data-testid="demo-seed"
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
            className="erd-field erd-field--sm w-20 tabular-nums"
          />
        </label>
        {build && build.fkViolations > 0 && (
          <span className="erd-sev-warning" data-testid="demo-fk-warning">
            {build.fkViolations} FK violation{build.fkViolations === 1 ? '' : 's'} in seed data
          </span>
        )}
      </div>

      {/* Tabs + editor */}
      <div className="erd-tabbar items-center">
        {(['sql', 'orm'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            data-testid={`demo-tab-${t}`}
            onClick={() => setTab(t)}
            className="erd-tab"
          >
            {t === 'sql' ? 'SQL' : 'ORM'}
          </button>
        ))}
        {tab === 'orm' && snippets.length > 0 && (
          <select
            data-testid="demo-snippets"
            className="erd-field erd-field--sm ml-2 max-w-64"
            value=""
            onChange={(e) => {
              const s = snippets[Number(e.target.value)]
              if (s) setOrmText(s.code)
            }}
          >
            <option value="">Snippets…</option>
            {snippets.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          variant="primary"
          className="ml-auto my-1"
          data-testid="demo-run"
          disabled={phase !== 'ready' || busy}
          onClick={() => void run()}
          title="Run (Ctrl/⌘+Enter)"
        >
          {busy ? 'Running…' : 'Run ▶'}
        </Button>
      </div>
      <div className="erd-strip h-32 shrink-0">
        <div className={clsx('h-full', tab !== 'sql' && 'hidden')}>
          <CodeMirrorEditor
            value={sqlText}
            onChange={setSqlText}
            extensions={sqlExtensions}
            testId="demo-editor-sql"
            placeholder="SELECT …"
          />
        </div>
        <div className={clsx('h-full', tab !== 'orm' && 'hidden')}>
          <CodeMirrorEditor
            value={ormText}
            onChange={setOrmText}
            extensions={ormExtensions}
            testId="demo-editor-orm"
            placeholder="Model.objects.all()"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex min-h-0 flex-1 flex-col">
        {error ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <pre
              data-testid="demo-error"
              className="erd-out erd-out--error"
            >
              {error}
            </pre>
            {errorStdout && (
              <pre className="erd-out erd-strip--top">
                {errorStdout}
              </pre>
            )}
          </div>
        ) : result ? (
          <ResultView result={result} />
        ) : (
          <div className="erd-muted flex flex-1 items-center justify-center px-6 text-center text-xs">
            {phase === 'ready'
              ? 'Run a query to see results here.'
              : 'Start the demo to run SQL and Django ORM queries against seeded data.'}
          </div>
        )}
      </div>
    </div>
  )
}

function ResultView({ result }: { result: QueryResult }) {
  const hasGrid = result.columns.length > 0
  return (
    <>
      <div className="erd-bar">
        <span data-testid="demo-rowcount">
          {result.rowcount} {result.rowcount === 1 ? 'row' : 'rows'}
          {result.truncated ? ' (first 1000 shown)' : ''}
          {hasGrid ? '' : ' affected'}
        </span>
        {result.ms !== undefined && <span>· {result.ms} ms</span>}
        {result.kind && result.kind !== 'queryset' && <span>· {result.kind}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {hasGrid ? <Grid columns={result.columns} rows={result.rows} /> : null}
      </div>
      {result.stdout ? (
        <pre
          data-testid="demo-stdout"
          className="erd-out erd-strip--top max-h-24 shrink-0"
        >
          {result.stdout}
        </pre>
      ) : null}
      {result.sql ? (
        <div className="erd-strip--top shrink-0">
          <div className="erd-bar" style={{ borderBottom: 0 }}>
            <span>Generated SQL</span>
            <CopyButton className="ml-auto" label="SQL" text={result.sql} />
          </div>
          <pre
            data-testid="demo-sql-out"
            className="erd-out max-h-28"
          >
            {result.sql}
          </pre>
        </div>
      ) : null}
    </>
  )
}

/** Windowed grid: only the visible rows (plus overscan) are mounted, so 1000 rows stay snappy. */
function Grid({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(300)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  useEffect(() => {
    // A new result starts at the top; keeping the old offset looked like a broken grid.
    setScrollTop(0)
    if (ref.current) ref.current.scrollTop = 0
  }, [rows, columns])

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const visible = Math.ceil(height / ROW_H) + OVERSCAN * 2
  const end = Math.min(rows.length, start + visible)
  const slice = rows.slice(start, end)

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col" data-testid="demo-result">
        <div className="erd-muted px-3 py-2 text-xs">No rows.</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="demo-result">
      {/*
        One table, not two. The header used to live in its own table above the scroller, so its
        columns could not line up with the body's and the first visible row was clipped by the
        scroll offset. A sticky thead inside the scroller keeps the columns shared, and spacer rows
        carry the virtualised height.
      */}
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="erd-grid">
          <thead className="sticky top-0 z-10">
            <tr style={{ height: ROW_H }}>
              <th className="erd-grid__n">#</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {start > 0 && <tr aria-hidden style={{ height: start * ROW_H }} />}
            {slice.map((r, i) => (
              <tr key={start + i} style={{ height: ROW_H }}>
                <td className="erd-grid__n">{start + i + 1}</td>
                {columns.map((c, ci) => (
                  <td key={c} className={clsx(r[ci] === null && 'erd-grid__null')} title={formatCell(r[ci])}>
                    {formatCell(r[ci])}
                  </td>
                ))}
              </tr>
            ))}
            {end < rows.length && <tr aria-hidden style={{ height: (rows.length - end) * ROW_H }} />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default DemoPanel

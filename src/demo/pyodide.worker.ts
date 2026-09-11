/**
 * Pyodide worker: loads Python + Django from the CDN, runs public/py/{bootstrap,runtime}.py,
 * and answers protocol requests. OWNER: worker-5 (demo). Plan D9/D10/D19.
 */
import {
  DJANGO_REQUIREMENT,
  PYODIDE_INDEX_URL,
  PYODIDE_VERSION,
  type BootResult,
  type ProgressEvent,
  type Request,
  type Response,
  type Stage,
} from './protocol'

/** The subset of the Pyodide API this worker uses (the package is not bundled). */
interface Pyodide {
  version: string
  loadPackage(names: string | string[]): Promise<unknown>
  runPythonAsync(code: string, opts?: { globals?: unknown }): Promise<unknown>
  runPython(code: string, opts?: { globals?: unknown }): unknown
  globals: { get(name: string): unknown; set(name: string, value: unknown): void }
  pyimport(name: string): unknown
  toPy(value: unknown): unknown
}
interface PyodideModule {
  loadPyodide(opts: {
    indexURL: string
    stdout?: (s: string) => void
    stderr?: (s: string) => void
  }): Promise<Pyodide>
}

type Runtime = {
  set_progress_callback(
    cb: (stage: Stage, pct: number | null | undefined, message: string) => void,
  ): void
  build(modelsPy: string, tableOrder: string, dataset: string): string
  reset(dataset?: string | null): string
  run_sql(query: string): string
  run_orm(code: string): string
  status(): string
}

const post = (msg: Response): void => self.postMessage(msg)

function progress(stage: Stage, message: string, pct?: number, id?: number): void {
  const p: ProgressEvent = { stage, message, pct }
  post(id === undefined ? { type: 'progress', progress: p } : { id, type: 'progress', progress: p })
}

let pyodide: Pyodide | null = null
let runtime: Runtime | null = null
let bootInfo: BootResult | null = null

const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
const pyUrl = (file: string): string =>
  new URL(`${base.replace(/\/?$/, '/')}py/${file}`, self.location.origin).href

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

async function boot(id: number): Promise<BootResult> {
  if (bootInfo && pyodide && runtime) return bootInfo
  const started = performance.now()

  progress(
    'download',
    `Downloading Pyodide ${PYODIDE_VERSION} (≈ 15 MB, cached afterwards)`,
    undefined,
    id,
  )
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)) as PyodideModule
  const py = await mod.loadPyodide({
    indexURL: PYODIDE_INDEX_URL,
    stdout: (s) => post({ type: 'log', level: 'info', message: s }),
    stderr: (s) => post({ type: 'log', level: 'error', message: s }),
  })
  progress('download', 'Python runtime ready', 100, id)

  progress('install', 'Loading micropip', 0, id)
  await py.loadPackage('micropip')
  // sqlite3 is part of the stdlib build; some releases ship it as a loadable package.
  try {
    py.runPython('import sqlite3')
  } catch {
    await py.loadPackage('sqlite3')
  }
  progress('install', `Installing ${DJANGO_REQUIREMENT} (pure-Python wheel)`, 20, id)
  const micropip = py.pyimport('micropip') as { install(req: string | string[]): Promise<void> }
  await micropip.install([DJANGO_REQUIREMENT, 'tzdata'])
  progress('install', 'Django installed', 100, id)

  progress('bootstrap', 'Configuring Django settings', 0, id)
  const [bootstrapSrc, runtimeSrc] = await Promise.all([
    fetchText(pyUrl('bootstrap.py')),
    fetchText(pyUrl('runtime.py')),
  ])
  await py.runPythonAsync(bootstrapSrc)
  await py.runPythonAsync(runtimeSrc)
  const rt: Runtime = {
    set_progress_callback: py.globals.get(
      'set_progress_callback',
    ) as Runtime['set_progress_callback'],
    build: py.globals.get('build') as Runtime['build'],
    reset: py.globals.get('reset') as Runtime['reset'],
    run_sql: py.globals.get('run_sql') as Runtime['run_sql'],
    run_orm: py.globals.get('run_orm') as Runtime['run_orm'],
    status: py.globals.get('status') as Runtime['status'],
  }
  rt.set_progress_callback((stage, pct, message) => {
    progress(stage, message, pct === null || pct === undefined ? undefined : Number(pct), currentId)
  })
  const django = String(py.globals.get('DJANGO_VERSION'))
  const python = String(py.globals.get('PYTHON_VERSION'))
  progress('bootstrap', `Django ${django} on Python ${python}`, 100, id)

  pyodide = py
  runtime = rt
  bootInfo = {
    pyodide: py.version,
    python,
    django,
    bootMs: Math.round(performance.now() - started),
  }
  return bootInfo
}

/** Id of the request currently executing, so Python progress callbacks can tag events. */
let currentId: number | undefined

function parseResult(json: string): unknown {
  const parsed = JSON.parse(json) as { ok?: boolean; error?: string; stdout?: string } & Record<
    string,
    unknown
  >
  if (parsed.ok === false) {
    const err = new Error(parsed.error ?? 'Unknown error') as Error & { stdout?: string }
    err.stdout = parsed.stdout
    throw err
  }
  const { ok: _ok, ...rest } = parsed
  void _ok
  return rest
}

function requireRuntime(): Runtime {
  if (!runtime) throw new Error('Demo runtime is not booted yet — click "Start demo" first')
  return runtime
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'boot':
      return boot(req.id)
    case 'build': {
      await boot(req.id)
      const rt = requireRuntime()
      return parseResult(
        rt.build(req.modelsPy, JSON.stringify(req.tableOrder), JSON.stringify(req.dataset)),
      )
    }
    case 'reset': {
      const rt = requireRuntime()
      return parseResult(rt.reset(req.dataset ? JSON.stringify(req.dataset) : null))
    }
    case 'sql':
      return parseResult(requireRuntime().run_sql(req.query))
    case 'orm':
      return parseResult(requireRuntime().run_orm(req.code))
    case 'status': {
      if (!runtime) return { booted: false, appLabel: null, version: 0 }
      return parseResult(runtime.status())
    }
    default:
      throw new Error(`Unknown request type ${(req as { type: string }).type}`)
  }
}

// Requests are serialised: Pyodide is single-threaded and the DB is one connection.
let queue: Promise<void> = Promise.resolve()

self.addEventListener('message', (e: MessageEvent<Request>) => {
  const req = e.data
  if (!req || typeof req.id !== 'number') return
  queue = queue.then(async () => {
    currentId = req.id
    try {
      const result = await handle(req)
      post({ id: req.id, type: 'result', ok: true, result })
    } catch (err) {
      const e = err as Error & { stdout?: string }
      post({
        id: req.id,
        type: 'result',
        ok: false,
        error: e?.message ?? String(err),
        stdout: e?.stdout,
      })
    } finally {
      currentId = undefined
    }
  })
})

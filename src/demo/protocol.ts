/**
 * Message protocol between the demo panel (main thread) and the Pyodide worker.
 * OWNER: worker-5 (demo). Plain JSON only — no proxies cross the boundary.
 */
import type { FakeDataset } from '@/core/fake'

/** Pinned Pyodide release (Python 3.14). Loaded from jsDelivr; nothing is bundled. */
export const PYODIDE_VERSION = '314.0.6'
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
export const DJANGO_REQUIREMENT = 'django==5.2.*'

export type Stage = 'download' | 'install' | 'bootstrap' | 'tables' | 'seed' | 'ready'

export interface ProgressEvent {
  stage: Stage
  /** 0–100 when known; undefined = indeterminate. */
  pct?: number
  message: string
}

export interface BuildArgs {
  /** Full models.py source (from generateDjango). */
  modelsPy: string
  /** db_table names in FK-safe creation order (topologicalTables). */
  tableOrder: string[]
  dataset: FakeDataset
}

export type Request =
  | { id: number; type: 'boot' }
  | ({ id: number; type: 'build' } & BuildArgs)
  | { id: number; type: 'sql'; query: string }
  | { id: number; type: 'orm'; code: string }
  | { id: number; type: 'reset'; dataset?: FakeDataset }
  | { id: number; type: 'status' }

export type RequestType = Request['type']

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  rowcount: number
  /** SQL executed (raw query, or the ORM queries captured via connection.queries). */
  sql?: string
  stdout?: string
  truncated?: boolean
  /** ORM only: what the last expression evaluated to. */
  kind?: 'queryset' | 'instance' | 'dict' | 'list' | 'scalar' | 'none'
  /** ORM only: repr() of a scalar result. */
  repr?: string | null
  ms?: number
}

/** One Django system-check message (django.core.checks), JSON-safe. */
export interface CheckMessage {
  id: string
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | string
  msg: string
  obj: string | null
}

export interface BuildResult {
  appLabel: string
  version: number
  tables: string[]
  models: string[]
  rows: number
  fkViolations: number
  /** Non-silenced `run_checks()` messages for the demo app; empty when the models are clean. */
  checks: CheckMessage[]
  ms: number
}

export interface BootResult {
  pyodide: string
  python: string
  django: string
  bootMs: number
}

export interface StatusResult {
  booted: boolean
  appLabel: string | null
  version: number
  django?: string
  python?: string
}

export interface ResultByType {
  boot: BootResult
  build: BuildResult
  sql: QueryResult
  orm: QueryResult
  reset: BuildResult
  status: StatusResult
}

export type Response =
  | { id: number; type: 'result'; ok: true; result: unknown }
  | { id: number; type: 'result'; ok: false; error: string; stdout?: string }
  | { id?: number; type: 'progress'; progress: ProgressEvent }
  | { type: 'log'; level: 'info' | 'error'; message: string }

/** Thrown by the client when the worker reports `ok: false`. */
export class DemoError extends Error {
  stdout?: string
  constructor(message: string, stdout?: string) {
    super(message)
    this.name = 'DemoError'
    this.stdout = stdout
  }
}

export const STAGE_LABEL: Record<Stage, string> = {
  download: 'Downloading Python runtime',
  install: 'Installing Django',
  bootstrap: 'Configuring Django',
  tables: 'Creating tables',
  seed: 'Seeding rows',
  ready: 'Ready',
}

/** Rough share of the total boot time each stage takes, for a single progress bar. */
export const STAGE_WEIGHT: Record<Stage, [number, number]> = {
  download: [0, 45],
  install: [45, 80],
  bootstrap: [80, 88],
  tables: [88, 94],
  seed: [94, 100],
  ready: [100, 100],
}

export function overallPct(p: ProgressEvent): number {
  const [from, to] = STAGE_WEIGHT[p.stage]
  if (p.pct === undefined) return from
  return Math.round(from + ((to - from) * Math.min(100, Math.max(0, p.pct))) / 100)
}

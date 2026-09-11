/**
 * Promise-based client for the Pyodide demo worker. OWNER: worker-5 (demo).
 *
 * One request at a time is in flight per id; the worker answers with a matching id.
 * `onProgress` receives stage events during `boot` / `build` / `reset`.
 */
import type { FakeDataset } from '@/core/fake'
import {
  DemoError,
  type BuildArgs,
  type ProgressEvent,
  type Request,
  type RequestType,
  type Response,
  type ResultByType,
} from './protocol'

export type ProgressListener = (p: ProgressEvent) => void
export type LogListener = (level: 'info' | 'error', message: string) => void

/** Minimal Worker surface so tests can inject a fake. */
export interface WorkerLike {
  postMessage(msg: unknown): void
  terminate(): void
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void
  addEventListener(type: 'error', fn: (e: ErrorEvent | Event) => void): void
}

export type WorkerFactory = () => WorkerLike

interface Pending {
  type: RequestType
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })
}

export class DemoClient {
  private worker: WorkerLike | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private progressListeners = new Set<ProgressListener>()
  private logListeners = new Set<LogListener>()
  private bootPromise: Promise<ResultByType['boot']> | null = null
  /** True once `boot` resolved and the worker has not been terminated since. */
  booted = false
  private factory: WorkerFactory

  constructor(factory: WorkerFactory = defaultWorkerFactory) {
    this.factory = factory
  }

  onProgress(fn: ProgressListener): () => void {
    this.progressListeners.add(fn)
    return () => this.progressListeners.delete(fn)
  }

  onLog(fn: LogListener): () => void {
    this.logListeners.add(fn)
    return () => this.logListeners.delete(fn)
  }

  get inFlight(): number {
    return this.pending.size
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    const w = this.factory()
    w.addEventListener('message', (e: MessageEvent) => this.handle(e.data as Response))
    w.addEventListener('error', (e) => {
      const msg = (e as ErrorEvent).message ?? 'Worker crashed'
      this.failAll(new Error(msg))
      this.terminate()
    })
    this.worker = w
    return w
  }

  private handle(msg: Response): void {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'progress') {
      for (const fn of this.progressListeners) fn(msg.progress)
      return
    }
    if (msg.type === 'log') {
      for (const fn of this.logListeners) fn(msg.level, msg.message)
      return
    }
    if (msg.type === 'result') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new DemoError(msg.error, msg.stdout))
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.bootPromise = null
    this.booted = false
  }

  private request<T extends RequestType>(
    req: Omit<Extract<Request, { type: T }>, 'id'>,
  ): Promise<ResultByType[T]> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<ResultByType[T]>((resolve, reject) => {
      this.pending.set(id, { type: req.type, resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ ...req, id })
    })
  }

  /** Download Pyodide + Django and configure it. Idempotent while the worker lives. */
  boot(): Promise<ResultByType['boot']> {
    if (!this.bootPromise) {
      this.bootPromise = this.request<'boot'>({ type: 'boot' }).then(
        (r) => {
          this.booted = true
          return r
        },
        (e) => {
          this.bootPromise = null
          throw e
        },
      )
    }
    return this.bootPromise
  }

  build(args: BuildArgs): Promise<ResultByType['build']> {
    return this.request<'build'>({ type: 'build', ...args })
  }

  sql(query: string): Promise<ResultByType['sql']> {
    return this.request<'sql'>({ type: 'sql', query })
  }

  orm(code: string): Promise<ResultByType['orm']> {
    return this.request<'orm'>({ type: 'orm', code })
  }

  /** Recreate the current tables and reseed (with `dataset`, or the last one). */
  reset(dataset?: FakeDataset): Promise<ResultByType['reset']> {
    return this.request<'reset'>(dataset ? { type: 'reset', dataset } : { type: 'reset' })
  }

  status(): Promise<ResultByType['status']> {
    return this.request<'status'>({ type: 'status' })
  }

  /** Kill the worker (D10 fallback / panel unmount). Pending requests reject. */
  terminate(): void {
    this.worker?.terminate()
    this.worker = null
    this.failAll(new Error('Demo worker terminated'))
  }
}

let shared: DemoClient | null = null

/** App-wide client so the runtime survives tab switches. */
export function getDemoClient(): DemoClient {
  if (!shared) shared = new DemoClient()
  return shared
}

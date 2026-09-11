import { describe, expect, it, vi } from 'vitest'
import { DemoClient, type WorkerLike } from './client'
import { DemoError, overallPct, type Request, type Response } from './protocol'

/** In-memory worker double: answers requests through `script`. */
function fakeWorker(script: (req: Request, emit: (r: Response) => void) => void) {
  const listeners: { message: Array<(e: MessageEvent) => void>; error: Array<(e: Event) => void> } =
    {
      message: [],
      error: [],
    }
  const worker: WorkerLike & {
    emit(r: Response): void
    crash(msg: string): void
    terminated: number
    sent: Request[]
  } = {
    sent: [],
    terminated: 0,
    postMessage(msg: unknown) {
      this.sent.push(msg as Request)
      queueMicrotask(() => script(msg as Request, (r) => this.emit(r)))
    },
    terminate() {
      this.terminated++
    },
    addEventListener(type: 'message' | 'error', fn: (e: never) => void) {
      listeners[type].push(fn as never)
    },
    emit(r: Response) {
      for (const fn of listeners.message) fn({ data: r } as MessageEvent)
    },
    crash(message: string) {
      for (const fn of listeners.error) fn({ message } as unknown as ErrorEvent)
    },
  }
  return worker
}

describe('DemoClient', () => {
  it('matches responses to requests by id and resolves typed results', async () => {
    const w = fakeWorker((req, emit) => {
      if (req.type === 'sql')
        emit({
          id: req.id,
          type: 'result',
          ok: true,
          result: { columns: ['n'], rows: [[1]], rowcount: 1 },
        })
      if (req.type === 'status')
        emit({
          id: req.id,
          type: 'result',
          ok: true,
          result: { booted: false, appLabel: null, version: 0 },
        })
    })
    const c = new DemoClient(() => w)
    const [sql, status] = await Promise.all([c.sql('SELECT 1'), c.status()])
    expect(sql.rows).toEqual([[1]])
    expect(status.booted).toBe(false)
    expect(w.sent.map((r) => r.id)).toEqual([1, 2])
    expect(c.inFlight).toBe(0)
  })

  it('rejects with DemoError (carrying stdout) when the worker reports ok:false', async () => {
    const w = fakeWorker((req, emit) =>
      emit({ id: req.id, type: 'result', ok: false, error: 'Traceback…NameError', stdout: 'hi\n' }),
    )
    const c = new DemoClient(() => w)
    const err = await c.orm('nope').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DemoError)
    expect((err as DemoError).message).toContain('NameError')
    expect((err as DemoError).stdout).toBe('hi\n')
  })

  it('forwards progress and log events, boots once, and reports booted', async () => {
    const w = fakeWorker((req, emit) => {
      if (req.type === 'boot') {
        emit({ id: req.id, type: 'progress', progress: { stage: 'download', message: 'dl' } })
        emit({ type: 'log', level: 'info', message: 'hello' })
        emit({
          id: req.id,
          type: 'result',
          ok: true,
          result: { pyodide: 'x', python: '3.14', django: '5.2', bootMs: 1 },
        })
      }
    })
    const c = new DemoClient(() => w)
    const progress = vi.fn()
    const log = vi.fn()
    c.onProgress(progress)
    c.onLog(log)
    const [a, b] = await Promise.all([c.boot(), c.boot()])
    expect(a).toBe(b)
    expect(w.sent).toHaveLength(1)
    expect(c.booted).toBe(true)
    expect(progress).toHaveBeenCalledWith({ stage: 'download', message: 'dl' })
    expect(log).toHaveBeenCalledWith('info', 'hello')
  })

  it('serialises build/reset payloads and omits dataset when absent', async () => {
    const w = fakeWorker((req, emit) =>
      emit({ id: req.id, type: 'result', ok: true, result: { appLabel: 'demo_v1', rows: 0 } }),
    )
    const c = new DemoClient(() => w)
    await c.build({ modelsPy: 'x', tableOrder: ['a'], dataset: { tables: [], joins: [], seed: 1 } })
    await c.reset()
    await c.reset({ tables: [], joins: [], seed: 2 })
    expect(w.sent[0]).toMatchObject({ type: 'build', modelsPy: 'x', tableOrder: ['a'] })
    expect(w.sent[1]).toEqual({ id: 2, type: 'reset' })
    expect(w.sent[2]).toMatchObject({ type: 'reset', dataset: { seed: 2 } })
  })

  it('rejects pending requests when the worker crashes or is terminated, then restarts', async () => {
    const w = fakeWorker(() => {})
    const c = new DemoClient(() => w)
    const p = c.sql('SELECT 1')
    w.crash('boom')
    await expect(p).rejects.toThrow('boom')
    expect(w.terminated).toBe(1)
    const p2 = c.boot()
    c.terminate()
    await expect(p2).rejects.toThrow('terminated')
    expect(c.booted).toBe(false)
    // A new request spins up a fresh worker.
    const p3 = c.status()
    expect(w.sent.length).toBeGreaterThan(2)
    void p3
  })

  it('ignores unknown or unmatched messages', async () => {
    const w = fakeWorker((req, emit) => {
      emit({ id: 999, type: 'result', ok: true, result: null })
      emit(null as unknown as Response)
      emit({ id: req.id, type: 'result', ok: true, result: { columns: [], rows: [], rowcount: 0 } })
    })
    const c = new DemoClient(() => w)
    await expect(c.sql('x')).resolves.toMatchObject({ rowcount: 0 })
  })
})

describe('overallPct', () => {
  it('maps stage-local progress onto one 0–100 bar', () => {
    expect(overallPct({ stage: 'download', message: '' })).toBe(0)
    expect(overallPct({ stage: 'download', pct: 100, message: '' })).toBe(45)
    expect(overallPct({ stage: 'install', pct: 50, message: '' })).toBeGreaterThan(45)
    expect(overallPct({ stage: 'ready', pct: 100, message: '' })).toBe(100)
  })
})

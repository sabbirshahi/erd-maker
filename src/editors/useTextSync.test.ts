import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTextSync, type TextSyncStoreLike } from './useTextSync'
import { emptySchema, newTable, type Schema, type Diagnostic } from '@/core/schema'
import type { Origin, TextView } from '@/store'

type State = ReturnType<TextSyncStoreLike['getState']>

/** Minimal in-memory store mirroring schemaStore semantics. */
function makeStore(initial?: Partial<State>) {
  const listeners = new Set<(s: State, p: State) => void>()
  let state: State
  const set = (patch: Partial<State>) => {
    const prev = state
    state = { ...state, ...patch }
    listeners.forEach((l) => l(state, prev))
  }
  state = {
    schema: emptySchema(),
    origin: 'system' as Origin,
    version: 0,
    focus: null as TextView | null,
    dbmlText: null,
    djangoText: null,
    commit: vi.fn((origin: Origin, schema: Schema, texts?: { dbmlText?: string; djangoText?: string }) =>
      set({
        schema,
        origin,
        version: state.version + 1,
        dbmlText: origin === 'dbml' ? (texts?.dbmlText ?? state.dbmlText) : null,
        djangoText: origin === 'django' ? (texts?.djangoText ?? state.djangoText) : null,
      }),
    ),
    setDiagnostics: vi.fn(),
    setFocus: vi.fn((focus: TextView | null) => set({ focus })),
    ...initial,
  }
  const store: TextSyncStoreLike = {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  /** Simulate a canvas edit. */
  const canvasEdit = (mutate: (s: Schema) => void) => {
    const next = structuredClone(state.schema)
    mutate(next)
    set({ schema: next, origin: 'canvas', version: state.version + 1, dbmlText: null, djangoText: null })
  }
  return { store, canvasEdit }
}

const generate = (s: Schema) => s.tables.map((t) => `Table ${t.name} {}`).join('\n') + '\n'
const parseOk = (text: string) => {
  const s = emptySchema()
  for (const m of text.matchAll(/Table\s+(\w+)/g)) s.tables.push(newTable({ name: m[1] }))
  return { schema: s, diagnostics: [] as Diagnostic[] }
}
const parseErr = (msg = 'boom') => ({
  diagnostics: [{ id: 'x', severity: 'error', source: 'dbml', message: msg, line: 2 }] as Diagnostic[],
})
const passthrough = (_prev: Schema, next: Schema) => next
const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls

describe('createTextSync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows generated text initially and regenerates on external commits', () => {
    const { store, canvasEdit } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    expect(sync.text).toBe('\n')
    const updates = vi.fn()
    sync.onUpdate(updates)
    canvasEdit((s) => s.tables.push(newTable({ name: 'users' })))
    expect(sync.text).toBe('Table users {}\n')
    expect(updates).toHaveBeenCalledTimes(1)
    sync.dispose()
  })

  it('prefers the authoritative own text when origin is self', () => {
    const { store } = makeStore({ origin: 'dbml', dbmlText: '// mine\nTable users {}\n' })
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    expect(sync.text).toBe('// mine\nTable users {}\n')
    sync.dispose()
  })

  it('debounces typing (300 ms) and commits with own origin + text', async () => {
    const { store } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    sync.onFocus()
    expect(store.getState().focus).toBe('dbml')
    sync.onChange('Table a {}')
    sync.onChange('Table ab {}')
    expect(sync.dirty).toBe(true)
    vi.advanceTimersByTime(200)
    expect(store.getState().commit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(store.getState().commit).toHaveBeenCalledTimes(1)
    const [origin, schema, texts] = calls(store.getState().commit)[0]
    expect(origin).toBe('dbml')
    expect((schema as Schema).tables.map((t) => t.name)).toEqual(['ab'])
    expect(texts).toEqual({ dbmlText: 'Table ab {}' })
    // Own commit must not overwrite the typed text.
    expect(sync.text).toBe('Table ab {}')
    expect(sync.dirty).toBe(false)
    expect(store.getState().setDiagnostics).toHaveBeenCalledWith('dbml', [])
    sync.dispose()
  })

  it('does not commit on parse errors but publishes diagnostics', async () => {
    const { store } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: () => parseErr('bad'), generate, reconcile: passthrough })
    sync.onChange('Table {')
    await vi.advanceTimersByTimeAsync(300)
    expect(store.getState().commit).not.toHaveBeenCalled()
    expect(store.getState().setDiagnostics).toHaveBeenCalledTimes(1)
    const diags = calls(store.getState().setDiagnostics)[0][1] as Diagnostic[]
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toBe('bad')
    expect(diags[0].line).toBe(2)
    expect(sync.diagnostics).toEqual(diags)
    sync.dispose()
  })

  it('calls reconcile with the current store schema', async () => {
    const { store, canvasEdit } = makeStore()
    canvasEdit((s) => s.tables.push(newTable({ name: 'users' })))
    const reconcile = vi.fn(passthrough)
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile })
    sync.onChange('Table users {}\nTable posts {}')
    await vi.advanceTimersByTimeAsync(300)
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile.mock.calls[0][0].tables[0].name).toBe('users')
    expect(reconcile.mock.calls[0][1].tables.map((t) => t.name)).toEqual(['users', 'posts'])
    sync.dispose()
  })

  it('defers external regeneration while focused and dirty, applies it on blur when no local commit wins', async () => {
    const { store, canvasEdit } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: () => parseErr(), generate, reconcile: passthrough })
    sync.onFocus()
    sync.onChange('Table broken {')
    canvasEdit((s) => s.tables.push(newTable({ name: 'from_canvas' })))
    // Still showing the user's text.
    expect(sync.text).toBe('Table broken {')
    await sync.onBlur()
    // Parse failed -> no own commit -> deferred external change is applied now.
    expect(sync.text).toBe('Table from_canvas {}\n')
    expect(store.getState().focus).toBeNull()
    sync.dispose()
  })

  it('applies external regeneration immediately when focused but not dirty', () => {
    const { store, canvasEdit } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    sync.onFocus()
    canvasEdit((s) => s.tables.push(newTable({ name: 'x' })))
    expect(sync.text).toBe('Table x {}\n')
    sync.dispose()
  })

  it('blur flushes the pending parse without waiting for the debounce', async () => {
    const { store } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    sync.onFocus()
    sync.onChange('Table quick {}')
    await sync.onBlur()
    expect(store.getState().commit).toHaveBeenCalledTimes(1)
    expect(store.getState().schema.tables[0].name).toBe('quick')
    sync.dispose()
  })

  it('ignores stale async parse results', async () => {
    const { store } = makeStore()
    let resolveFirst!: (v: ReturnType<typeof parseOk>) => void
    const parse = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ReturnType<typeof parseOk>>((r) => (resolveFirst = r)))
      .mockImplementation((t: string) => parseOk(t))
    const sync = createTextSync(store, { view: 'django', parse, generate, reconcile: passthrough })
    sync.onChange('Table first {}')
    await vi.advanceTimersByTimeAsync(300)
    sync.onChange('Table second {}')
    await vi.advanceTimersByTimeAsync(300)
    resolveFirst(parseOk('Table first {}'))
    await Promise.resolve()
    expect(store.getState().commit).toHaveBeenCalledTimes(1)
    expect(store.getState().schema.tables[0].name).toBe('second')
    expect(store.getState().djangoText).toBe('Table second {}')
    sync.dispose()
  })

  it('turns a throwing parser into an error diagnostic', async () => {
    const { store } = makeStore()
    const sync = createTextSync(store, {
      view: 'dbml',
      parse: () => {
        throw new Error('kaboom')
      },
      generate,
      reconcile: passthrough,
    })
    sync.onChange('x')
    await vi.advanceTimersByTimeAsync(300)
    expect(sync.diagnostics[0].message).toBe('kaboom')
    expect(store.getState().commit).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('stops reacting after dispose', () => {
    const { store, canvasEdit } = makeStore()
    const sync = createTextSync(store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    sync.dispose()
    canvasEdit((s) => s.tables.push(newTable({ name: 'late' })))
    expect(sync.text).toBe('\n')
  })
})

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

  describe('no echo loop across views', () => {
    /** Two panes on one store, each with a counted generator, mimicking DbmlEditor + DjangoEditor. */
    function twoPanes(initial?: Partial<State>) {
      const made = makeStore(initial)
      const genDbml = vi.fn((s: Schema) => 'dbml:' + generate(s))
      const genDjango = vi.fn((s: Schema) => 'py:' + generate(s))
      const dbml = createTextSync(made.store, { view: 'dbml', parse: parseOk, generate: genDbml, reconcile: passthrough })
      const django = createTextSync(made.store, { view: 'django', parse: parseOk, generate: genDjango, reconcile: passthrough })
      const dbmlUpdates = vi.fn()
      const djangoUpdates = vi.fn()
      dbml.onUpdate(dbmlUpdates)
      django.onUpdate(djangoUpdates)
      // Both generators ran once for the initial text; count only what happens after this point.
      genDbml.mockClear()
      genDjango.mockClear()
      return { ...made, dbml, django, genDbml, genDjango, dbmlUpdates, djangoUpdates }
    }

    it("a 'canvas' commit regenerates each editor exactly once", () => {
      const t = twoPanes()
      t.canvasEdit((s) => s.tables.push(newTable({ name: 'users' })))
      expect(t.genDbml).toHaveBeenCalledTimes(1)
      expect(t.genDjango).toHaveBeenCalledTimes(1)
      expect(t.dbmlUpdates).toHaveBeenCalledTimes(1)
      expect(t.djangoUpdates).toHaveBeenCalledTimes(1)
      expect(t.dbml.text).toBe('dbml:Table users {}\n')
      expect(t.django.text).toBe('py:Table users {}\n')
      // Nothing echoes back into the store: the panes only commit on their own parses.
      expect(t.store.getState().commit).not.toHaveBeenCalled()
      t.dbml.dispose()
      t.django.dispose()
    })

    it("a 'dbml' commit leaves the DBML editor's text alone but regenerates Django once", async () => {
      const t = twoPanes()
      t.dbml.onChange('Table typed {}')
      await vi.advanceTimersByTimeAsync(300)
      expect(t.store.getState().commit).toHaveBeenCalledTimes(1)
      expect(t.store.getState().origin).toBe('dbml')
      expect(t.genDbml).not.toHaveBeenCalled()
      expect(t.dbml.text).toBe('Table typed {}')
      expect(t.genDjango).toHaveBeenCalledTimes(1)
      expect(t.django.text).toBe('py:Table typed {}\n')
      expect(t.djangoUpdates).toHaveBeenCalledTimes(1)
      // The Django regeneration must not trigger a Django commit (which would in turn rewrite DBML).
      expect(t.store.getState().commit).toHaveBeenCalledTimes(1)
      t.dbml.dispose()
      t.django.dispose()
    })

    it("a 'django' commit regenerates DBML once and leaves the Django editor's text alone", async () => {
      const t = twoPanes()
      t.django.onChange('class Post(models.Model): pass  # Table posts')
      await vi.advanceTimersByTimeAsync(300)
      expect(t.store.getState().commit).toHaveBeenCalledTimes(1)
      expect(t.store.getState().origin).toBe('django')
      expect(t.genDjango).not.toHaveBeenCalled()
      expect(t.django.text).toBe('class Post(models.Model): pass  # Table posts')
      expect(t.genDbml).toHaveBeenCalledTimes(1)
      expect(t.dbml.text).toBe('dbml:Table posts {}\n')
      expect(t.dbmlUpdates).toHaveBeenCalledTimes(1)
      expect(t.store.getState().commit).toHaveBeenCalledTimes(1)
      t.dbml.dispose()
      t.django.dispose()
    })

    it('a focused + dirty editor is never written into, whatever the origin', async () => {
      const t = twoPanes()
      t.dbml.onFocus()
      t.dbml.onChange('Table half-typed {')
      const typed = t.dbml.text
      // External changes from both other origins while the user is mid-edit. The Django commit is
      // issued directly rather than via django.onChange(): typing requires focus in the real UI, so
      // an unfocused-but-dirty pane is not a reachable state, and driving one makes this test about
      // debounce tie-breaks instead of the invariant in its name.
      t.canvasEdit((s) => s.tables.push(newTable({ name: 'from_canvas' })))
      const fromDjango = emptySchema()
      fromDjango.tables.push(newTable({ name: 'from_django' }))
      t.store.getState().commit('django', fromDjango, { djangoText: '# Table from_django' })
      await vi.advanceTimersByTimeAsync(300)
      const commitOrigins = (t.store.getState().commit as unknown as { mock: { calls: Origin[][] } }).mock.calls.map((c) => c[0])
      expect(commitOrigins).toContain('django')
      expect(t.dbml.text).toBe(typed)
      // No regeneration ran for the focused pane, so nothing external was written into it. It may
      // still notify once: its own 300ms flush commits the typed text and clears `dirty`, which is
      // a self-update, not an external write — the text above is still exactly what was typed.
      expect(t.genDbml).not.toHaveBeenCalled()
      // The unfocused Django pane regenerates for each foreign commit it sees: the canvas edit, then
      // the DBML pane's 300ms flush. Its own commit in between does not regenerate it (origin match).
      expect(t.genDjango).toHaveBeenCalledTimes(2)
      // Blur: the pending parse fails (unbalanced brace is parsed as no tables -> still a commit here
      // because parseOk is lenient), so use a parse that reports an error instead for the deferred path.
      t.dbml.dispose()
      t.django.dispose()
    })

    it('after blur, the deferred external text is applied exactly once', async () => {
      const made = makeStore()
      const genDbml = vi.fn(generate)
      const dbml = createTextSync(made.store, { view: 'dbml', parse: () => parseErr(), generate: genDbml, reconcile: passthrough })
      const updates = vi.fn()
      dbml.onUpdate(updates)
      genDbml.mockClear()
      dbml.onFocus()
      dbml.onChange('Table broken {')
      made.canvasEdit((s) => s.tables.push(newTable({ name: 'a' })))
      made.canvasEdit((s) => s.tables.push(newTable({ name: 'b' })))
      expect(genDbml).not.toHaveBeenCalled()
      expect(dbml.text).toBe('Table broken {')
      await dbml.onBlur()
      expect(genDbml).toHaveBeenCalledTimes(1)
      expect(dbml.text).toBe('Table a {}\nTable b {}\n')
      // One update for the parse result (diagnostics) and one for the regenerated text.
      expect(updates).toHaveBeenCalledTimes(2)
      dbml.dispose()
    })
  })
})

describe('detach/attach (React StrictMode safety)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // Regression: the hook used to dispose() on effect cleanup. StrictMode runs mount -> cleanup ->
  // mount in development, which permanently unsubscribed the memoised engine: panes rendered once
  // and then froze, typing never committed, and only a page refresh appeared to fix it. Production
  // builds do not double-invoke effects, so the e2e suite could not see this.
  it('keeps working after a detach/attach cycle', async () => {
    const made = makeStore()
    const gen = vi.fn(generate)
    const sync = createTextSync(made.store, { view: 'dbml', parse: parseOk, generate: gen, reconcile: passthrough })
    sync.detach()
    sync.attach()

    // External commits still reach the pane.
    made.canvasEdit((s) => s.tables.push(newTable({ name: 'after_remount' })))
    expect(sync.text).toContain('after_remount')

    // And the pane can still commit its own edits.
    sync.onChange('Table typed {}')
    await vi.advanceTimersByTimeAsync(300)
    const origins = (made.store.getState().commit as unknown as { mock: { calls: Origin[][] } }).mock.calls.map((c) => c[0])
    expect(origins).toContain('dbml')
    sync.dispose()
  })

  it('catches up on changes committed while detached', () => {
    const made = makeStore()
    const sync = createTextSync(made.store, { view: 'dbml', parse: parseOk, generate, reconcile: passthrough })
    sync.detach()
    made.canvasEdit((s) => s.tables.push(newTable({ name: 'missed_while_detached' })))
    expect(sync.text).not.toContain('missed_while_detached')
    sync.attach()
    expect(sync.text).toContain('missed_while_detached')
    sync.dispose()
  })
})

/**
 * Debounced two-way text sync between a CodeMirror pane and the schema store.
 *
 * The pure scheduling logic lives in `createTextSync` (unit-tested without React);
 * `useTextSync` wires it to the store and a component lifecycle.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Diagnostic, Schema } from '@/core/schema'
import { useSchemaStore, type Origin, type TextView } from '@/store'

export const SYNC_DEBOUNCE_MS = 300

export interface TextSyncParse {
  schema?: Schema
  diagnostics: Diagnostic[]
}

export interface TextSyncOptions {
  /** Which editor this is; also the commit origin and diagnostics source. */
  view: TextView
  /** Parse text → schema (sync or async). Must never throw. */
  parse: (text: string) => TextSyncParse | Promise<TextSyncParse>
  /** Schema → text. */
  generate: (schema: Schema) => string
  /** Merge a freshly parsed schema into the current one so ids survive. */
  reconcile: (prev: Schema, next: Schema) => Schema
  debounceMs?: number
  /** Clock/timers (injectable for tests). */
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void }
}

export interface TextSyncStoreLike {
  getState(): {
    schema: Schema
    origin: Origin
    version: number
    focus: TextView | null
    dbmlText: string | null
    djangoText: string | null
    commit: (origin: Origin, schema: Schema, texts?: { dbmlText?: string; djangoText?: string }) => void
    setDiagnostics: (source: 'dbml' | 'django', diagnostics: Diagnostic[]) => void
    setFocus: (view: TextView | null) => void
  }
  subscribe(listener: (state: ReturnType<TextSyncStoreLike['getState']>, prev: ReturnType<TextSyncStoreLike['getState']>) => void): () => void
}

export interface TextSync {
  /** Text the editor should currently display. */
  readonly text: string
  /** Diagnostics produced by the last parse of this view's text. */
  readonly diagnostics: Diagnostic[]
  /** Whether the editor has unsynced local edits. */
  readonly dirty: boolean
  /** Called on every keystroke. */
  onChange(text: string): void
  onFocus(): void
  /** Blur: flushes any pending parse, then applies a deferred external regeneration. */
  onBlur(): Promise<void>
  /** Run the pending parse now (if any). */
  flush(): Promise<void>
  /** Subscribe to display-text / diagnostics changes. */
  onUpdate(listener: () => void): () => void
  dispose(): void
}

/**
 * Framework-free sync engine. Rules (plan §2):
 *  - regenerate only when `origin !== view`
 *  - never write into a focused+dirty editor; defer until blur
 *  - commit only with zero error diagnostics
 */
export function createTextSync(store: TextSyncStoreLike, opts: TextSyncOptions): TextSync {
  const debounceMs = opts.debounceMs ?? SYNC_DEBOUNCE_MS
  const timers = opts.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const initial = store.getState()
  const ownText = opts.view === 'dbml' ? initial.dbmlText : initial.djangoText
  let text = initial.origin === opts.view && ownText !== null ? ownText : safeGenerate(initial.schema)
  let diagnostics: Diagnostic[] = []
  let dirty = false
  let focused = false
  let pendingText: string | null = null
  let pendingExternal = false
  let timer: unknown = null
  let parseSeq = 0
  let disposed = false

  function safeGenerate(schema: Schema): string {
    try {
      return opts.generate(schema)
    } catch (e) {
      return `// ${opts.view} generation failed: ${(e as Error).message}\n`
    }
  }

  function regenerateFromStore() {
    const s = store.getState()
    const next = safeGenerate(s.schema)
    pendingExternal = false
    dirty = false
    pendingText = null
    if (next !== text) {
      text = next
      notify()
    }
  }

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.version === prev.version) return
    if (s.origin === opts.view) return
    if (focused && dirty) {
      pendingExternal = true
      return
    }
    regenerateFromStore()
  })

  async function runParse(source: string): Promise<void> {
    const seq = ++parseSeq
    let result: TextSyncParse
    try {
      result = await opts.parse(source)
    } catch (e) {
      result = {
        diagnostics: [
          { id: 'parse-throw', severity: 'error', source: opts.view, message: (e as Error).message ?? 'parse failed' },
        ],
      }
    }
    if (disposed || seq !== parseSeq) return
    diagnostics = result.diagnostics.map((d) => ({ ...d, source: opts.view }))
    const hasError = diagnostics.some((d) => d.severity === 'error')
    const state = store.getState()
    state.setDiagnostics(opts.view, diagnostics)
    if (!hasError && result.schema) {
      const merged = opts.reconcile(state.schema, result.schema)
      state.commit(opts.view, merged, opts.view === 'dbml' ? { dbmlText: source } : { djangoText: source })
    }
    // Our own commit doesn't trigger regeneration (origin === view), so the text stays as typed.
    dirty = false
    notify()
  }

  function schedule() {
    if (timer !== null) timers.clear(timer)
    timer = timers.set(() => {
      timer = null
      void flush()
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      timers.clear(timer)
      timer = null
    }
    if (pendingText === null) return
    const source = pendingText
    pendingText = null
    await runParse(source)
  }

  return {
    get text() {
      return text
    },
    get diagnostics() {
      return diagnostics
    },
    get dirty() {
      return dirty
    },
    onChange(next: string) {
      if (next === text) return
      text = next
      dirty = true
      pendingText = next
      schedule()
    },
    onFocus() {
      focused = true
      store.getState().setFocus(opts.view)
    },
    async onBlur() {
      focused = false
      await flush()
      const s = store.getState()
      if (s.focus === opts.view) s.setFocus(null)
      if (pendingExternal && s.origin !== opts.view) regenerateFromStore()
      pendingExternal = false
    },
    flush,
    onUpdate(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      unsubscribe()
      if (timer !== null) timers.clear(timer)
      listeners.clear()
    },
  }
}

/** React binding: returns the current display text + diagnostics and the handlers. */
export function useTextSync(opts: TextSyncOptions) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const sync = useMemo(
    () =>
      createTextSync(useSchemaStore as unknown as TextSyncStoreLike, {
        view: opts.view,
        debounceMs: opts.debounceMs,
        parse: (t) => optsRef.current.parse(t),
        generate: (s) => optsRef.current.generate(s),
        reconcile: (a, b) => optsRef.current.reconcile(a, b),
      }),
    // The sync engine is created once per view; option changes flow through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.view],
  )
  const [, setTick] = useState(0)
  useEffect(() => {
    const off = sync.onUpdate(() => setTick((t) => t + 1))
    return () => {
      off()
      sync.dispose()
    }
  }, [sync])
  return sync
}

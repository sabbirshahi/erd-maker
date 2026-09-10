/**
 * Single source of truth + sync engine. See plan §2 "Sync engine rules".
 *
 * Rules every view must follow:
 *  1. Mutate the schema ONLY through `commit` / `update`. Pass your own `origin`.
 *  2. Regenerate your text ONLY when `origin !== yourself` (subscribe to `version`).
 *  3. While a text editor is focused+dirty (`focus === yourself`), nothing writes into it.
 *  4. Parsers commit only with zero error diagnostics; set diagnostics via `setDiagnostics`.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { temporal } from 'zundo'
import { produce } from 'immer'
import type { Diagnostic, DiagnosticSource, Layout, Schema } from '@/core/schema'
import { emptySchema } from '@/core/schema'

export type Origin = 'canvas' | 'dbml' | 'django' | 'import' | 'system'
export type TextView = 'dbml' | 'django'

export interface Selection {
  tableId?: string
  columnId?: string
  refId?: string
}

export interface SchemaState {
  schema: Schema
  layout: Layout
  /** Who produced the current `schema`. */
  origin: Origin
  /** Monotonic; bumps on every schema commit (not on layout/selection changes). */
  version: number
  /** Authoritative user text when the last commit came from that editor; null => regenerate from schema. */
  dbmlText: string | null
  djangoText: string | null
  /** Text editor currently owning focus (suppresses writes into it). */
  focus: TextView | null
  diagnostics: Record<DiagnosticSource, Diagnostic[]>
  selection: Selection
  /** Table ids currently highlighted (hover/focus). */
  highlight: Set<string>

  // ---- actions ----
  /** Replace the schema wholesale (parsers, imports). `texts` keeps the user's own formatting. */
  commit: (origin: Origin, schema: Schema, texts?: { dbmlText?: string; djangoText?: string }) => void
  /** Mutate a draft (canvas/inspector edits). */
  update: (origin: Origin, mutate: (draft: Schema) => void) => void
  setLayout: (patch: Layout) => void
  setTablePosition: (tableId: string, pos: { x: number; y: number }) => void
  setFocus: (view: TextView | null) => void
  setDiagnostics: (source: DiagnosticSource, diagnostics: Diagnostic[]) => void
  select: (selection: Selection) => void
  setHighlight: (tableIds: Iterable<string>) => void
  /** Load a saved document (schema + layout), e.g. from localStorage or a share link. */
  load: (doc: { schema: Schema; layout?: Layout; dbmlText?: string }) => void
  reset: () => void
}

const emptyDiagnostics = (): Record<DiagnosticSource, Diagnostic[]> => ({
  dbml: [], django: [], sql: [], canvas: [], demo: [], typemap: [],
})

export const useSchemaStore = create<SchemaState>()(
  temporal(
    (set) => ({
      schema: emptySchema(),
      layout: {},
      origin: 'system',
      version: 0,
      dbmlText: null,
      djangoText: null,
      focus: null,
      diagnostics: emptyDiagnostics(),
      selection: {},
      highlight: new Set(),

      commit: (origin, schema, texts) =>
        set((s) => ({
          schema,
          origin,
          version: s.version + 1,
          dbmlText: origin === 'dbml' ? (texts?.dbmlText ?? s.dbmlText) : null,
          djangoText: origin === 'django' ? (texts?.djangoText ?? s.djangoText) : null,
        })),

      update: (origin, mutate) =>
        set((s) => ({
          schema: produce(s.schema, mutate),
          origin,
          version: s.version + 1,
          dbmlText: null,
          djangoText: null,
        })),

      setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
      setTablePosition: (tableId, pos) => set((s) => ({ layout: { ...s.layout, [tableId]: pos } })),
      setFocus: (focus) => set({ focus }),
      setDiagnostics: (source, diagnostics) =>
        set((s) => ({ diagnostics: { ...s.diagnostics, [source]: diagnostics } })),
      select: (selection) => set({ selection }),
      setHighlight: (ids) => set({ highlight: new Set(ids) }),

      load: ({ schema, layout, dbmlText }) =>
        set((s) => ({
          schema,
          layout: layout ?? {},
          origin: 'system',
          version: s.version + 1,
          dbmlText: dbmlText ?? null,
          djangoText: null,
          selection: {},
          highlight: new Set(),
        })),

      reset: () =>
        set((s) => ({
          schema: emptySchema(),
          layout: {},
          origin: 'system',
          version: s.version + 1,
          dbmlText: null,
          djangoText: null,
          selection: {},
          highlight: new Set(),
          diagnostics: emptyDiagnostics(),
        })),
    }),
    {
      // Undo/redo tracks schema + layout only.
      partialize: (s) => ({ schema: s.schema, layout: s.layout }) as unknown as SchemaState,
      limit: 200,
      equality: (a, b) => a.schema === b.schema && a.layout === b.layout,
    },
  ),
)

/** Convenience selectors */
export const useSchema = () => useSchemaStore((s) => s.schema)
export const useLayout = () => useSchemaStore((s) => s.layout)
export const useAllDiagnostics = () =>
  useSchemaStore(useShallow((s) => Object.values(s.diagnostics).flat()))

/** Undo/redo handles (zundo temporal store). */
export const undo = () => useSchemaStore.temporal.getState().undo()
export const redo = () => useSchemaStore.temporal.getState().redo()

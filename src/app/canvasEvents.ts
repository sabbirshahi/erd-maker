/**
 * Window events the shell uses to ask the canvas for something.
 *
 * The canvas owns the React Flow instance, and the shell has no handle on it, so these follow the
 * same pattern as the existing `erd:goto` and `erd:export-selection` events. The `erd:` prefix is
 * the app's internal namespace and is referenced by tests; it stays as it is.
 */
export const FOCUS_TABLE_EVENT = 'erd:focus-table'

export interface FocusTableDetail {
  tableId: string
}

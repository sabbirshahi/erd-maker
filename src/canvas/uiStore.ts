/**
 * Canvas-local UI state that does not belong in the shared schema store:
 * hover/pinned highlight anchors and one-shot focus requests for the inspector.
 */
import { create } from 'zustand'
import { sameAnchor, type Anchor } from './highlight'

export interface FocusRequest {
  tableId: string
  columnId?: string
  field: 'tableName' | 'name' | 'type'
}

export interface CanvasUiState {
  hover: Anchor | null
  pinned: Anchor | null
  focusRequest: FocusRequest | null
  /**
   * Tables selected together (box-select, Ctrl+A, or a paste). The shared store keeps a single
   * selection for the inspector; multi-selection is canvas-only, so it lives here.
   */
  multiSelect: string[]
  setMultiSelect: (ids: string[]) => void
  /**
   * Whether the edit panel is showing. Selecting a table (one click) only highlights it; the panel
   * is opened deliberately, by double-clicking a table or relation, or by creating a table.
   */
  inspectorOpen: boolean
  setInspectorOpen: (open: boolean) => void
  setHover: (a: Anchor | null) => void
  setPinned: (a: Anchor | null) => void
  requestFocus: (r: FocusRequest | null) => void
}

export const useCanvasUi = create<CanvasUiState>()((set, get) => ({
  hover: null,
  pinned: null,
  focusRequest: null,
  inspectorOpen: false,
  setInspectorOpen: (open) => {
    if (get().inspectorOpen !== open) set({ inspectorOpen: open })
  },
  multiSelect: [],
  setMultiSelect: (ids) => {
    const prev = get().multiSelect
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return
    set({ multiSelect: ids })
  },
  setHover: (a) => {
    if (!sameAnchor(get().hover, a)) set({ hover: a })
  },
  setPinned: (a) => {
    if (!sameAnchor(get().pinned, a)) set({ pinned: a })
  },
  requestFocus: (r) => set({ focusRequest: r }),
}))

export const selectAnchor = (s: CanvasUiState): Anchor | null => s.hover ?? s.pinned

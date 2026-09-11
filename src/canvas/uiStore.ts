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
  setHover: (a: Anchor | null) => void
  setPinned: (a: Anchor | null) => void
  requestFocus: (r: FocusRequest | null) => void
}

export const useCanvasUi = create<CanvasUiState>()((set, get) => ({
  hover: null,
  pinned: null,
  focusRequest: null,
  setHover: (a) => {
    if (!sameAnchor(get().hover, a)) set({ hover: a })
  },
  setPinned: (a) => {
    if (!sameAnchor(get().pinned, a)) set({ pinned: a })
  },
  requestFocus: (r) => set({ focusRequest: r }),
}))

export const selectAnchor = (s: CanvasUiState): Anchor | null => s.hover ?? s.pinned

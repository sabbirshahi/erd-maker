/**
 * Imperative canvas actions shared by the toolbar, keyboard shortcuts and other workers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { redo as storeRedo, undo as storeUndo, useSchemaStore } from '@/store'
import { registerAutoLayout } from './autoLayout'
import { elkLayout, estimateTableSize, type Size, type SizeLookup } from './layout'
import { addTable as addTableDraft, removeRef, removeTable } from './mutations'
import { endEditSession, untracked } from './undoGroup'
import { neighbourTableIds } from './highlight'
import { useCanvasUi } from './uiStore'
import type { RefEdgeType, TableNodeType } from './types'

export interface CanvasActions {
  addTable: () => void
  autoLayout: () => Promise<void>
  fitView: () => void
  undo: () => void
  redo: () => void
  deleteSelected: () => void
  renameSelected: () => void
  clearSelection: () => void
  focusTable: (tableId: string) => void
}

export function useCanvasActions(measured: Record<string, Size>): { actions: CanvasActions; busy: boolean } {
  const rf = useReactFlow<TableNodeType, RefEdgeType>()
  const rfStore = useStoreApi<TableNodeType, RefEdgeType>()
  const [busy, setBusy] = useState(false)
  const measuredRef = useRef(measured)
  measuredRef.current = measured

  const sizes = useCallback<SizeLookup>((t) => measuredRef.current[t.id] ?? estimateTableSize(t), [])

  const addTable = useCallback(() => {
    const st = useSchemaStore.getState()
    let created: { id: string; columnId: string } | undefined
    st.update('canvas', (d) => {
      const t = addTableDraft(d)
      created = { id: t.id, columnId: t.columns[0].id }
    })
    if (!created) return
    const { id, columnId } = created
    // Centre of the visible viewport, in flow coordinates.
    const dom = rfStore.getState().domNode
    const rect = dom?.getBoundingClientRect()
    const centre = rect
      ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    const table = useSchemaStore.getState().schema.tables.find((t) => t.id === id)
    const size = table ? estimateTableSize(table) : { width: 240, height: 80 }
    const count = useSchemaStore.getState().schema.tables.length
    const jitter = ((count - 1) % 5) * 24
    untracked(() =>
      useSchemaStore.getState().setTablePosition(id, {
        x: Math.round(centre.x - size.width / 2 + jitter),
        y: Math.round(centre.y - size.height / 2 + jitter),
      }),
    )
    useSchemaStore.getState().select({ tableId: id })
    useCanvasUi.getState().setPinned({ kind: 'table', id })
    useCanvasUi.getState().requestFocus({ tableId: id, columnId, field: 'tableName' })
  }, [rf, rfStore])

  const fitView = useCallback(() => {
    void rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1.25 })
  }, [rf])

  const autoLayout = useCallback(async () => {
    const st = useSchemaStore.getState()
    if (st.schema.tables.length === 0) return
    setBusy(true)
    try {
      const layout = await elkLayout(st.schema, sizes)
      useSchemaStore.getState().setLayout(layout)
      requestAnimationFrame(() => void rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1.25 }))
    } finally {
      setBusy(false)
    }
  }, [rf, sizes])

  useEffect(() => {
    registerAutoLayout(autoLayout)
    return () => registerAutoLayout(null)
  }, [autoLayout])

  const deleteSelected = useCallback(() => {
    const st = useSchemaStore.getState()
    const { tableId, refId } = st.selection
    endEditSession()
    if (refId) st.update('canvas', (d) => removeRef(d, refId))
    else if (tableId) st.update('canvas', (d) => removeTable(d, tableId))
    else return
    useSchemaStore.getState().select({})
    useCanvasUi.getState().setPinned(null)
  }, [])

  const renameSelected = useCallback(() => {
    const { tableId } = useSchemaStore.getState().selection
    if (tableId) useCanvasUi.getState().requestFocus({ tableId, field: 'tableName' })
  }, [])

  const clearSelection = useCallback(() => {
    endEditSession()
    useSchemaStore.getState().select({})
    const ui = useCanvasUi.getState()
    ui.setPinned(null)
    ui.setHover(null)
    const el = document.activeElement
    if (el instanceof HTMLElement) el.blur()
  }, [])

  const focusTable = useCallback(
    (tableId: string) => {
      const ids = neighbourTableIds(useSchemaStore.getState().schema, tableId)
      void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.35, duration: 350, maxZoom: 1.25 })
    },
    [rf],
  )

  const actions = useMemo<CanvasActions>(
    () => ({
      addTable,
      autoLayout,
      fitView,
      undo: () => {
        endEditSession()
        storeUndo()
      },
      redo: () => {
        endEditSession()
        storeRedo()
      },
      deleteSelected,
      renameSelected,
      clearSelection,
      focusTable,
    }),
    [addTable, autoLayout, fitView, deleteSelected, renameSelected, clearSelection, focusTable],
  )

  return { actions, busy }
}

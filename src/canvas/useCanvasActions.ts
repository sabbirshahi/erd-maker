/**
 * Imperative canvas actions shared by the toolbar, keyboard shortcuts and other workers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { redo as storeRedo, undo as storeUndo, useSchemaStore } from '@/store'
import { registerAutoLayout } from './autoLayout'
import { elkLayout, estimateTableSize, type Size, type SizeLookup } from './layout'
import { addTable as addTableDraft, removeRef, removeTable } from './mutations'
import { copySelection, describePayload, pasteInto, type ClipboardPayload } from './clipboard'
import { toast } from '@/app/toast'
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
  /** Copy the selected table(s) to the canvas clipboard (Ctrl/Cmd+C). */
  copySelected: () => void
  /** Copy then delete (Ctrl/Cmd+X). */
  cutSelected: () => void
  /** Paste the clipboard, selecting the new tables (Ctrl/Cmd+V). */
  paste: () => void
  /** Copy + paste the selection in one step (Ctrl/Cmd+D). */
  duplicateSelected: () => void
  /** Select every table (Ctrl/Cmd+A). */
  selectAll: () => void
  clearSelection: () => void
  focusTable: (tableId: string) => void
}

export function useCanvasActions(measured: Record<string, Size>): { actions: CanvasActions; busy: boolean } {
  const rf = useReactFlow<TableNodeType, RefEdgeType>()
  const rfStore = useStoreApi<TableNodeType, RefEdgeType>()
  const [busy, setBusy] = useState(false)
  /** Canvas clipboard. Kept in memory: the system clipboard cannot hold schema objects. */
  const clipboardRef = useRef<ClipboardPayload | null>(null)
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
    // A table the user just created opens its panel so it can be named straight away.
    useCanvasUi.getState().setInspectorOpen(true)
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
    const multi = useCanvasUi.getState().multiSelect
    endEditSession()
    if (multi.length > 0) st.update('canvas', (d) => multi.forEach((id) => removeTable(d, id)))
    else if (refId) st.update('canvas', (d) => removeRef(d, refId))
    else if (tableId) st.update('canvas', (d) => removeTable(d, tableId))
    else return
    useCanvasUi.getState().setMultiSelect([])
    useSchemaStore.getState().select({})
    useCanvasUi.getState().setPinned(null)
  }, [])

  /** Table ids the user currently has selected: React Flow's multi-selection, else the store's one. */
  const selectedTableIds = useCallback((): string[] => {
    const multi = useCanvasUi.getState().multiSelect
    if (multi.length > 0) return multi
    const { tableId } = useSchemaStore.getState().selection
    return tableId ? [tableId] : []
  }, [])

  const copySelected = useCallback((): ClipboardPayload | null => {
    const st = useSchemaStore.getState()
    const payload = copySelection(st.schema, st.layout, selectedTableIds())
    if (!payload) {
      toast('Select a table first')
      return null
    }
    clipboardRef.current = payload
    return payload
  }, [selectedTableIds])

  const paste = useCallback(
    (payload: ClipboardPayload | null = clipboardRef.current, announce = true) => {
      if (!payload) {
        toast('Nothing to paste')
        return
      }
      let result: ReturnType<typeof pasteInto> | undefined
      useSchemaStore.getState().update('canvas', (d) => {
        result = pasteInto(d, payload)
      })
      if (!result) return
      const { tableIds, layout } = result
      untracked(() => useSchemaStore.getState().setLayout(layout))
      // Select the pasted tables so a follow-up move or delete acts on the copy.
      useCanvasUi.getState().setMultiSelect(tableIds.length > 1 ? tableIds : [])
      if (tableIds.length === 1) useSchemaStore.getState().select({ tableId: tableIds[0] })
      if (announce) toast(`Pasted ${describePayload(payload)}`)
    },
    [],
  )

  const cutSelected = useCallback(() => {
    const payload = copySelected()
    if (!payload) return
    endEditSession()
    useSchemaStore.getState().update('canvas', (d) => {
      for (const t of payload.tables) removeTable(d, t.id)
    })
    useSchemaStore.getState().select({})
    useCanvasUi.getState().setMultiSelect([])
    useCanvasUi.getState().setPinned(null)
    toast(`Cut ${describePayload(payload)}`)
  }, [copySelected])

  const duplicateSelected = useCallback(() => {
    const st = useSchemaStore.getState()
    const payload = copySelection(st.schema, st.layout, selectedTableIds())
    if (!payload) {
      toast('Select a table first')
      return
    }
    paste(payload, false)
    toast(`Duplicated ${describePayload(payload)}`)
  }, [paste, selectedTableIds])

  const selectAll = useCallback(() => {
    const ids = useSchemaStore.getState().schema.tables.map((t) => t.id)
    if (ids.length === 0) return
    useCanvasUi.getState().setMultiSelect(ids)
    if (ids.length === 1) useSchemaStore.getState().select({ tableId: ids[0] })
    useCanvasUi.getState().setPinned(null)
  }, [])

  const renameSelected = useCallback(() => {
    const { tableId } = useSchemaStore.getState().selection
    if (tableId) useCanvasUi.getState().requestFocus({ tableId, field: 'tableName' })
  }, [])

  const clearSelection = useCallback(() => {
    endEditSession()
    useCanvasUi.getState().setInspectorOpen(false)
    useCanvasUi.getState().setMultiSelect([])
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
      copySelected: () => void copySelected(),
      cutSelected,
      paste: () => paste(),
      duplicateSelected,
      selectAll,
      clearSelection,
      focusTable,
    }),
    [addTable, autoLayout, fitView, deleteSelected, renameSelected, copySelected, cutSelected, paste, duplicateSelected, selectAll, clearSelection, focusTable],
  )

  return { actions, busy }
}

import '@xyflow/react/dist/style.css'
import './canvas.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type ColorMode,
  type EdgeChange,
  type EdgeMarker,
  type EdgeMouseHandler,
  type IsValidConnection,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnect,
  type XYPosition,
} from '@xyflow/react'
import type { Layout, Ref, RefKind } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { buildRef, validateConnection } from './connection'
import { canvasDiagnostics } from './diagnostics'
import { handleId } from './handles'
import { computeHighlight } from './highlight'
import { Inspector } from './Inspector'
import { estimateTableSize, placeUnpositioned, type Size } from './layout'
import { RefEdge } from './RefEdge'
import { TableNode } from './TableNode'
import { Toolbar } from './Toolbar'
import type { RefEdgeType, TableNodeType } from './types'
import { useCanvasUi, selectAnchor } from './uiStore'
import { untracked } from './undoGroup'
import { useCanvasActions } from './useCanvasActions'
import { useShortcuts } from './useShortcuts'

const nodeTypes = { table: TableNode }
const edgeTypes = { ref: RefEdge }

/** Follows the app shell's `.dark` class on <html>. */
function useColorMode(): ColorMode {
  const read = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light') as ColorMode
  const [mode, setMode] = useState<ColorMode>(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return mode
}

function markersFor(kind: RefKind, color: string): { markerStart?: EdgeMarker; markerEnd?: EdgeMarker } {
  const arrow: EdgeMarker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color }
  switch (kind) {
    case '>':
      return { markerEnd: arrow }
    case '<':
      return { markerStart: arrow }
    case '<>':
      return { markerStart: arrow, markerEnd: arrow }
    case '-':
      return {}
  }
}

function CanvasInner() {
  const schema = useSchemaStore((s) => s.schema)
  const layout = useSchemaStore((s) => s.layout)
  const selection = useSchemaStore((s) => s.selection)
  const select = useSchemaStore((s) => s.select)
  const setLayout = useSchemaStore((s) => s.setLayout)
  const setHighlight = useSchemaStore((s) => s.setHighlight)
  const setDiagnostics = useSchemaStore((s) => s.setDiagnostics)
  const anchor = useCanvasUi(selectAnchor)
  const setHover = useCanvasUi((s) => s.setHover)
  const setPinned = useCanvasUi((s) => s.setPinned)
  const multiSelect = useCanvasUi((s) => s.multiSelect)

  const rf = useReactFlow<TableNodeType, RefEdgeType>()
  const colorMode = useColorMode()
  const rootRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<Record<string, Size>>({})
  const [dragPos, setDragPos] = useState<Record<string, XYPosition>>({})
  const { actions, busy } = useCanvasActions(measured)
  useShortcuts(actions, rootRef)

  // Test hook (the shell sets the same object in main.tsx when ?e2e is present).
  useEffect(() => {
    if (!window.__erd) window.__erd = { store: useSchemaStore }
  }, [])

  // Canvas diagnostics follow the schema.
  useEffect(() => {
    setDiagnostics('canvas', canvasDiagnostics(schema))
  }, [schema, setDiagnostics])

  // Tables without a saved position get one (not an undo step).
  const fallback = useMemo(() => placeUnpositioned(schema, layout), [schema, layout])
  useEffect(() => {
    if (Object.keys(fallback).length) untracked(() => setLayout(fallback))
  }, [fallback, setLayout])

  // M5 highlight sets → store (for other views) + node/edge classes.
  const hl = useMemo(() => computeHighlight(schema, anchor), [schema, anchor])
  useEffect(() => {
    setHighlight(hl.tables)
  }, [hl, setHighlight])

  const nodes = useMemo<TableNodeType[]>(
    () =>
      schema.tables.map((t) => ({
        id: t.id,
        type: 'table',
        position: dragPos[t.id] ?? layout[t.id] ?? fallback[t.id] ?? { x: 0, y: 0 },
        data: { tableId: t.id },
        selected: multiSelect.includes(t.id) || selection.tableId === t.id,
        measured: measured[t.id],
        className: anchor ? (hl.tables.has(t.id) ? 'highlighted' : 'dimmed') : undefined,
      })),
    [schema.tables, layout, fallback, dragPos, measured, selection.tableId, multiSelect, anchor, hl],
  )

  const edgeColor = colorMode === 'dark' ? '#71717a' : '#a1a1aa'
  const edgeColorHl = colorMode === 'dark' ? '#a5b4fc' : '#4f46e5'
  const edges = useMemo<RefEdgeType[]>(() => {
    const centreX = (tableId: string): number | undefined => {
      const t = schema.tables.find((x) => x.id === tableId)
      const p = dragPos[tableId] ?? layout[tableId] ?? fallback[tableId]
      if (!t || !p) return undefined
      const w = measured[tableId]?.width ?? estimateTableSize(t).width
      return p.x + w / 2
    }
    return schema.refs.flatMap((r: Ref): RefEdgeType[] => {
      if (!r.from.columnIds.length || !r.to.columnIds.length) return []
      const fx = centreX(r.from.tableId)
      const tx = centreX(r.to.tableId)
      if (fx === undefined || tx === undefined) return []
      const self = r.from.tableId === r.to.tableId
      const fromSide = self ? 'R' : fx <= tx ? 'R' : 'L'
      const toSide = self ? 'R' : fromSide === 'R' ? 'L' : 'R'
      const isHl = hl.refs.has(r.id)
      const isSel = selection.refId === r.id
      return [
        {
          id: r.id,
          type: 'ref',
          source: r.from.tableId,
          sourceHandle: handleId(r.from.tableId, r.from.columnIds[0], fromSide),
          target: r.to.tableId,
          targetHandle: handleId(r.to.tableId, r.to.columnIds[0], toSide),
          data: { refId: r.id },
          selected: isSel,
          className: ['erd-edge', anchor ? (isHl ? 'highlighted' : 'dimmed') : ''].join(' ').trim(),
          zIndex: isHl || isSel ? 1 : 0,
          ...markersFor(r.kind, isHl || isSel ? edgeColorHl : edgeColor),
        },
      ]
    })
  }, [schema.refs, schema.tables, layout, fallback, dragPos, measured, selection.refId, anchor, hl, edgeColor, edgeColorHl])

  // ---- selection sync (React Flow → store) ----
  const applySelection = useCallback(
    (nodeSel: Map<string, boolean>, edgeSel: Map<string, boolean>) => {
      const st = useSchemaStore.getState()
      let tableId = st.selection.tableId
      let refId = st.selection.refId
      for (const [id, on] of nodeSel) {
        if (on) tableId = id
        else if (tableId === id) tableId = undefined
      }
      for (const [id, on] of edgeSel) {
        if (on) refId = id
        else if (refId === id) refId = undefined
      }
      if ([...nodeSel.values()].some(Boolean)) refId = undefined
      if ([...edgeSel.values()].some(Boolean)) tableId = undefined
      if (tableId !== st.selection.tableId || refId !== st.selection.refId) {
        select({
          tableId,
          columnId: tableId && tableId === st.selection.tableId ? st.selection.columnId : undefined,
          refId,
        })
      }
      setPinned(tableId ? { kind: 'table', id: tableId } : refId ? { kind: 'ref', id: refId } : null)
    },
    [select, setPinned],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<TableNodeType>[]) => {
      const dims: Record<string, Size> = {}
      const moving: Record<string, XYPosition> = {}
      const settled: Layout = {}
      const sel = new Map<string, boolean>()
      for (const ch of changes) {
        if (ch.type === 'dimensions' && ch.dimensions) dims[ch.id] = ch.dimensions
        else if (ch.type === 'position' && ch.position) {
          if (ch.dragging) moving[ch.id] = ch.position
          else settled[ch.id] = { x: Math.round(ch.position.x), y: Math.round(ch.position.y) }
        } else if (ch.type === 'select') sel.set(ch.id, ch.selected)
      }
      if (Object.keys(dims).length) setMeasured((m) => ({ ...m, ...dims }))
      if (Object.keys(moving).length) setDragPos((p) => ({ ...p, ...moving }))
      if (Object.keys(settled).length) {
        const st = useSchemaStore.getState()
        const changed = Object.fromEntries(
          Object.entries(settled).filter(([id, p]) => st.layout[id]?.x !== p.x || st.layout[id]?.y !== p.y),
        )
        if (Object.keys(changed).length) st.setLayout(changed)
        setDragPos((p) => {
          const next = { ...p }
          for (const id of Object.keys(settled)) delete next[id]
          return next
        })
      }
      if (sel.size) {
        // Mirror React Flow's own selection (box-select, shift-click) into the canvas ui store,
        // since `nodes` is derived and would otherwise drop it on the next render.
        const ui = useCanvasUi.getState()
        const next = new Set(ui.multiSelect)
        for (const [id, on] of sel) if (on) next.add(id); else next.delete(id)
        ui.setMultiSelect(next.size > 1 ? [...next] : [])
        applySelection(sel, new Map())
      }
    },
    [applySelection],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RefEdgeType>[]) => {
      const sel = new Map<string, boolean>()
      for (const ch of changes) if (ch.type === 'select') sel.set(ch.id, ch.selected)
      if (sel.size) applySelection(new Map(), sel)
    },
    [applySelection],
  )

  // ---- connect ----
  const isValidConnection = useCallback<IsValidConnection<RefEdgeType>>(
    (c) => validateConnection(useSchemaStore.getState().schema, c).ok,
    [],
  )
  const onConnect = useCallback<OnConnect>((c) => {
    const st = useSchemaStore.getState()
    if (!validateConnection(st.schema, c).ok) return
    const ref = buildRef(st.schema, c)
    if (!ref) return
    st.update('canvas', (d) => {
      d.refs.push(ref)
    })
    useSchemaStore.getState().select({ refId: ref.id })
    useCanvasUi.getState().setPinned({ kind: 'ref', id: ref.id })
  }, [])

  // ---- hover / focus ----
  const onNodeMouseEnter = useCallback<NodeMouseHandler<TableNodeType>>((_, n) => setHover({ kind: 'table', id: n.id }), [setHover])
  const onNodeMouseLeave = useCallback(() => setHover(null), [setHover])
  const onEdgeMouseEnter = useCallback<EdgeMouseHandler<RefEdgeType>>((_, e) => setHover({ kind: 'ref', id: e.id }), [setHover])
  const onEdgeMouseLeave = useCallback(() => setHover(null), [setHover])
  // One click selects and highlights; the edit panel is opened deliberately with a double click.
  const onNodeDoubleClick = useCallback<NodeMouseHandler<TableNodeType>>((_, n) => {
    useSchemaStore.getState().select({ tableId: n.id })
    useCanvasUi.getState().setMultiSelect([])
    useCanvasUi.getState().setInspectorOpen(true)
  }, [])
  const onPaneClick = useCallback(() => {
    if (useSchemaStore.getState().selection.tableId || useSchemaStore.getState().selection.refId) select({})
    const ui = useCanvasUi.getState()
    ui.setInspectorOpen(false)
    ui.setMultiSelect([])
    setPinned(null)
  }, [select, setPinned])

  // Fit the view once nodes are measured after a load (0 → N tables).
  const initialized = useNodesInitialized()
  const pendingFit = useRef(schema.tables.length > 0)
  const prevCount = useRef(schema.tables.length)
  useEffect(() => {
    if (prevCount.current === 0 && schema.tables.length > 0) pendingFit.current = true
    prevCount.current = schema.tables.length
  }, [schema.tables.length])
  useEffect(() => {
    if (initialized && pendingFit.current && schema.tables.length > 0) {
      pendingFit.current = false
      requestAnimationFrame(() => void rf.fitView({ padding: 0.2, maxZoom: 1 }))
    }
  }, [initialized, schema.tables.length, rf])

  return (
    <div ref={rootRef} className="erd-canvas" data-testid="canvas">
      <ReactFlow<TableNodeType, RefEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={(_, e) => {
          useSchemaStore.getState().select({ refId: e.id })
          useCanvasUi.getState().setInspectorOpen(true)
        }}
        onPaneClick={onPaneClick}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        elevateEdgesOnSelect
        elevateNodesOnSelect
        colorMode={colorMode}
        minZoom={0.1}
        maxZoom={2}
        fitView={schema.tables.length > 0}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'ref' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={2} className="erd-minimap" />
        <Toolbar actions={actions} busy={busy} />
      </ReactFlow>
      <Inspector />
    </div>
  )
}

/** Full-size ERD canvas bound to the schema store. Needs a sized parent. */
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

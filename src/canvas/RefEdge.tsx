import { memo, useMemo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, type EdgeProps } from '@xyflow/react'
import type { RefAction, RefKind } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { REF_KINDS, refKindLabel, refKindName } from './connection'
import { removeRef } from './mutations'
import { freeChannelX, type Rect } from './routing'
import { REF_ACTIONS } from './types'
import type { RefEdgeType } from './types'

function RefEdgeImpl({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerStart,
  markerEnd,
}: EdgeProps<RefEdgeType>) {
  const ref = useSchemaStore((s) => s.schema.refs.find((r) => r.id === id))
  const update = useSchemaStore((s) => s.update)
  const select = useSchemaStore((s) => s.select)

  // Every other table is an obstacle; the two this edge connects are not, since it starts and
  // ends on their borders by definition.
  const obstacles = useStore((s) => {
    const out: Rect[] = []
    for (const n of s.nodeLookup.values()) {
      if (n.id === source || n.id === target) continue
      const w = n.measured?.width
      const h = n.measured?.height
      if (!w || !h) continue
      out.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h })
    }
    return out
  }, (a, b) => a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height))

  const centerX = useMemo(
    () => freeChannelX(sourceX, sourceY, targetX, targetY, obstacles),
    [sourceX, sourceY, targetX, targetY, obstacles],
  )

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
    offset: 24,
    ...(centerX === undefined ? {} : { centerX }),
  })
  if (!ref) return null

  const setKind = (kind: RefKind) =>
    update('canvas', (d) => {
      const r = d.refs.find((x) => x.id === id)
      if (r) r.kind = kind
    })
  const setOnDelete = (v: string) =>
    update('canvas', (d) => {
      const r = d.refs.find((x) => x.id === id)
      if (!r) return
      if (v === '') delete r.onDelete
      else r.onDelete = v as RefAction
    })
  const del = () => {
    update('canvas', (d) => removeRef(d, id))
    select({})
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={18}
        className="erd-edge__path"
      />
      <EdgeLabelRenderer>
        <div
          className="erd-edge__label nodrag nopan"
          data-testid="edge-label"
          title={refKindName(ref.kind)}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {refKindLabel(ref.kind)}
        </div>
        {selected && (
          <div
            className="erd-edge__toolbar nodrag nopan"
            data-testid="edge-toolbar"
            style={{ transform: `translate(-50%, 0) translate(${labelX}px, ${labelY + 14}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            <select
              className="erd-select"
              aria-label="Relation kind"
              data-testid="edge-kind"
              value={ref.kind}
              onChange={(e) => setKind(e.target.value as RefKind)}
            >
              {REF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {refKindLabel(k)} {refKindName(k)}
                </option>
              ))}
            </select>
            <select
              className="erd-select"
              aria-label="On delete"
              data-testid="edge-on-delete"
              value={ref.onDelete ?? ''}
              onChange={(e) => setOnDelete(e.target.value)}
            >
              <option value="">on delete: default</option>
              {REF_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  on delete: {a}
                </option>
              ))}
            </select>
            <button type="button" className="erd-btn erd-btn--danger" data-testid="edge-delete" onClick={del} title="Delete relation">
              Delete
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}

export const RefEdge = memo(RefEdgeImpl)

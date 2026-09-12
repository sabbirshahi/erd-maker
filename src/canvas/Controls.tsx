/**
 * Canvas view controls, gathered at the two bottom corners instead of scattered around the edges.
 *
 * Bottom-left: zoom out / level / zoom in / fit. Bottom-right: a small minimap that can be folded
 * away, because on a big schema it was covering the diagram it was meant to help navigate.
 */
import { useState } from 'react'
import { MiniMap, Panel, useReactFlow, useStore, type ColorMode } from '@xyflow/react'
import { useTokens } from './tokens'
import type { Schema } from '@/core/schema'

const MINIMAP_W = 82
const MINIMAP_H = 54

function Icon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export function ZoomPill({ onFit }: { onFit: () => void }) {
  const zoom = useStore((s) => s.transform[2])
  const { zoomIn, zoomOut, zoomTo } = useReactFlow()
  const pct = Math.round(zoom * 100)

  return (
    <Panel position="bottom-left" className="erd-zoom" data-testid="zoom-controls">
      <button type="button" className="erd-zoom__btn" data-testid="zoom-out" aria-label="Zoom out" title="Zoom out" onClick={() => zoomOut()}>
        <Icon d="M3.5 8h9" />
      </button>
      <button
        type="button"
        className="erd-zoom__level"
        data-testid="zoom-level"
        title="Reset to 100%"
        aria-label={`Zoom ${pct}%, click to reset`}
        onClick={() => zoomTo(1)}
      >
        {pct}%
      </button>
      <button type="button" className="erd-zoom__btn" data-testid="zoom-in" aria-label="Zoom in" title="Zoom in" onClick={() => zoomIn()}>
        <Icon d="M8 3.5v9M3.5 8h9" />
      </button>
      <button type="button" className="erd-zoom__btn" data-testid="zoom-fit" aria-label="Fit to screen" title="Fit to screen" onClick={onFit}>
        <Icon d="M2.5 6V2.5H6M14 6V2.5h-3.5M2.5 10v3.5H6M14 10v3.5h-3.5" />
      </button>
    </Panel>
  )
}

/**
 * Rendered as a plain absolutely-positioned element rather than a React Flow <Panel>, so the
 * toggle and the map stack together. MiniMap normally positions itself as a panel; `position:
 * relative` in its style hands that job back to this wrapper.
 */
export function CollapsibleMiniMap({ schema, colorMode }: { schema: Schema; colorMode: ColorMode }) {
  const [open, setOpen] = useState(true)
  const t = useTokens(['--erd-hairline-strong', '--erd-text-muted', '--erd-bg'] as const, colorMode)

  return (
    <div className="erd-minimap__wrap">
      <button
        type="button"
        className="erd-minimap__toggle"
        data-testid="minimap-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon d={open ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'} />
        Map
      </button>
      {open && (
        <MiniMap
          pannable
          zoomable
          className="erd-minimap"
          style={{ position: 'relative', inset: 'auto', width: MINIMAP_W, height: MINIMAP_H, margin: 0 }}
          nodeStrokeWidth={2}
          nodeColor={(n) => schema.tables.find((x) => x.id === n.id)?.headerColor ?? t['--erd-hairline-strong']}
          nodeStrokeColor={t['--erd-text-muted']}
          maskColor={`color-mix(in srgb, ${t['--erd-bg']} 60%, transparent)`}
        />
      )}
    </div>
  )
}

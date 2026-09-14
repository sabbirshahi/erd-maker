/** M7 examples gallery — cards with SVG thumbnails sketched from the DBML. */
import { useMemo } from 'react'
import { examples, loadExample, type Example } from '@/examples'
import { sketchDbml } from '@/examples/sketch'
import { useSchemaStore } from '@/store'
import { toast } from './toast'
import { Modal } from './ui'
import { track } from './analytics'

export async function applyExample(example: Example): Promise<boolean> {
  const res = await loadExample(example)
  if (!res.ok) {
    toast(`Could not load "${example.title}": ${res.error}`, 'error')
    return false
  }
  useSchemaStore.getState().load(res.doc)
  track({ name: 'example-opened', example: example.id })
  toast(`Loaded example: ${example.title}`)
  return true
}

const W = 160
const H = 96

export function ExampleThumb({ dbml, className }: { dbml: string; className?: string }) {
  const sketch = useMemo(() => sketchDbml(dbml), [dbml])
  const n = Math.max(1, sketch.tables.length)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const cellW = W / cols
  const cellH = H / rows
  const boxW = Math.min(cellW * 0.7, 48)
  const centers = sketch.tables.map((_, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return { x: c * cellW + cellW / 2, y: r * cellH + cellH / 2 }
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
      {sketch.refs.map(([a, b], i) => {
        const p = centers[a]
        const q = centers[b]
        if (!p || !q) return null
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="erd-thumb__ref" strokeWidth={1.2} />
      })}
      {sketch.tables.map((t, i) => {
        const c = centers[i]
        const boxH = Math.min(cellH * 0.7, 8 + Math.min(t.columns, 6) * 4)
        const x = c.x - boxW / 2
        const y = c.y - boxH / 2
        return (
          <g key={t.name}>
            <rect x={x} y={y} width={boxW} height={boxH} rx={2} className="erd-thumb__box" />
            <rect x={x} y={y} width={boxW} height={5} rx={2} className="erd-thumb__cap" />
            {Array.from({ length: Math.min(t.columns, 6) }).map((_, k) => (
              <rect key={k} x={x + 4} y={y + 8 + k * 4} width={boxW * 0.6} height={1.5} className="erd-thumb__line" />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

export function ExamplesGallery({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Examples" width="max-w-3xl" testId="examples-gallery">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {examples.map((ex) => {
          const sk = sketchDbml(ex.dbml)
          return (
            <button
              key={ex.id}
              type="button"
              data-testid={`example-${ex.id}`}
              onClick={() => {
                void applyExample(ex).then((ok) => {
                  if (ok) onClose()
                })
              }}
              className="erd-card"
            >
              <div className="erd-card__thumb">
                <ExampleThumb dbml={ex.dbml} className="h-24 w-full" />
              </div>
              <div className="erd-card__body">
                <div className="erd-card__title">{ex.title}</div>
                <div className="erd-card__desc">{ex.description}</div>
                <div className="erd-card__meta">
                  {sk.tables.length} tables · {sk.refs.length} refs
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

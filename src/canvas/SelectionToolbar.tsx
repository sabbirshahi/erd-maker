/**
 * Floating bar shown while several tables are selected.
 *
 * With a multi-selection the inspector is hidden (it can only describe one table), so this is where
 * bulk actions live: recolour every selected header, duplicate or delete them together, and export
 * just this part of the diagram.
 */
import { useSchemaStore } from '@/store'
import { useCanvasUi } from './uiStore'
import type { CanvasActions } from './useCanvasActions'

/** Same palette the inspector offers for a single table. */
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#475569']

export interface SelectionToolbarProps {
  actions: CanvasActions
  /** Opens the export dialog scoped to the current selection. */
  onExportSelection: () => void
}

export function SelectionToolbar({ actions, onExportSelection }: SelectionToolbarProps) {
  const selected = useCanvasUi((s) => s.multiSelect)
  const update = useSchemaStore((s) => s.update)
  if (selected.length < 2) return null

  const setColor = (color: string | undefined) => {
    update('canvas', (d) => {
      for (const id of selected) {
        const t = d.tables.find((x) => x.id === id)
        if (t) t.headerColor = color
      }
    })
  }

  return (
    <div className="erd-selection-bar" data-testid="selection-toolbar" role="toolbar" aria-label="Selected tables">
      <span className="erd-selection-bar__count" data-testid="selection-count">
        {selected.length} tables selected
      </span>

      <span className="erd-selection-bar__sep" />
      <span className="erd-selection-bar__label">Colour</span>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title={`Colour ${c}`}
          data-testid={`selection-color-${c.slice(1)}`}
          onClick={() => setColor(c)}
          className="erd-swatch"
          style={{ background: c }}
        />
      ))}
      <button type="button" title="No colour" data-testid="selection-color-none" onClick={() => setColor(undefined)} className="erd-swatch erd-swatch--none" />

      <span className="erd-selection-bar__sep" />
      <button type="button" className="erd-btn" data-testid="selection-duplicate" onClick={actions.duplicateSelected}>
        Duplicate
      </button>
      <button type="button" className="erd-btn" data-testid="selection-export" onClick={onExportSelection}>
        Export selection…
      </button>
      <button type="button" className="erd-btn erd-btn--danger" data-testid="selection-delete" onClick={actions.deleteSelected}>
        Delete
      </button>
    </div>
  )
}

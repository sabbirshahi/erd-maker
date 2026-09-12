/**
 * Floating bar shown while several tables are selected.
 *
 * With a multi-selection the inspector is hidden (it can only describe one table), so this is where
 * bulk actions live: recolour every selected header, duplicate or delete them together, and export
 * just this part of the diagram.
 */
import { useSchemaStore } from '@/store'
import { useCanvasUi } from './uiStore'
import { TABLE_COLORS } from './palette'
import type { CanvasActions } from './useCanvasActions'

export interface SelectionToolbarProps {
  actions: CanvasActions
  /** Opens the export dialog scoped to the current selection. */
  onExportSelection: () => void
}

export function SelectionToolbar({ actions, onExportSelection }: SelectionToolbarProps) {
  const selected = useCanvasUi((s) => s.multiSelect)
  const update = useSchemaStore((s) => s.update)
  const tables = useSchemaStore((s) => s.schema.tables)
  const setHover = useCanvasUi((s) => s.setHover)
  if (selected.length < 2) return null

  const names = selected.map((id) => tables.find((t) => t.id === id)?.name ?? '?')
  const shown = names.slice(0, 3)
  const rest = names.length - shown.length

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
        {selected.length} selected
      </span>
      <span className="erd-selection-bar__names" data-testid="selection-names" title={names.join(', ')}>
        {shown.map((n, i) => (
          <span
            key={selected[i]}
            className="erd-selection-chip"
            onMouseEnter={() => setHover({ kind: 'table', id: selected[i] })}
            onMouseLeave={() => setHover(null)}
          >
            {n}
          </span>
        ))}
        {rest > 0 && <span className="erd-selection-bar__label">+{rest} more</span>}
      </span>

      <span className="erd-selection-bar__sep" />
      <span className="erd-selection-bar__label">Colour</span>
      {TABLE_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.label}
          data-testid={`selection-color-${c.hex.slice(1)}`}
          onClick={() => setColor(c.hex)}
          className="erd-swatch"
          style={{ background: `var(${c.token})` }}
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

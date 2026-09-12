/**
 * Cmd/Ctrl+K: find a table or column by name and jump to it.
 *
 * On a four-table diagram this earns nothing; past about thirty tables, hunting for one by eye is
 * the slowest thing in the app. Selecting a result centres the canvas on that table and its
 * neighbours, which is more useful than centring the table alone.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSchemaStore } from '@/store'
import { searchSchema, type SearchHit } from './search'
import { FOCUS_TABLE_EVENT, type FocusTableDetail } from './canvasEvents'

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const schema = useSchemaStore((s) => s.schema)
  const select = useSchemaStore((s) => s.select)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const hits = useMemo(() => searchSchema(schema, query), [schema, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    // Focus after the dialog is in the DOM, or the caret lands nowhere.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => setActive(0), [query])

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return
    select({ tableId: hit.tableId, columnId: hit.columnId })
    window.dispatchEvent(
      new CustomEvent<FocusTableDetail>(FOCUS_TABLE_EVENT, { detail: { tableId: hit.tableId } }),
    )
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(hits[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="erd-palette__scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Find a table or column" className="erd-palette" data-testid="command-palette">
        <input
          ref={inputRef}
          className="erd-palette__input"
          data-testid="palette-input"
          placeholder="Find a table or column…"
          role="combobox"
          aria-expanded
          aria-controls="erd-palette-results"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {hits.length === 0 ? (
          <div className="erd-palette__empty" data-testid="palette-empty">
            Nothing matches “{query}”
          </div>
        ) : (
          <ul ref={listRef} id="erd-palette-results" role="listbox" className="erd-palette__list" data-testid="palette-results">
            {hits.map((hit, i) => (
              <li key={`${hit.tableId}-${hit.columnId ?? 'table'}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className="erd-palette__row"
                  data-testid="palette-result"
                  data-kind={hit.kind}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                >
                  <span className="erd-palette__kind">{hit.kind === 'table' ? 'Table' : 'Column'}</span>
                  <span className="erd-palette__name">{hit.kind === 'table' ? hit.tableName : hit.columnName}</span>
                  {hit.kind === 'column' && <span className="erd-palette__in">in {hit.tableName}</span>}
                  {hit.detail && <span className="erd-palette__detail">{hit.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

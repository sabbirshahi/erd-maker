import { memo, useEffect, useMemo } from 'react'
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { useCanvasUi } from './uiStore'
import { inkFor } from './contrast'
import { fkSide, type Column } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { handleId } from './handles'
import type { TableNodeType } from './types'

/**
 * Keys get a chip, flags do not. PK and FK say something structural about the column, so they earn
 * a filled shape; "unique" and "not null" are annotations and stay as quiet monospace letters.
 */
function Badge({ children, title, tone }: { children: string; title: string; tone: 'pk' | 'fk' }) {
  return (
    <span title={title} data-testid={`badge-${tone}`} className={`erd-badge erd-badge--${tone}`}>
      {children}
    </span>
  )
}

function Flag({ children, title, tone }: { children: string; title: string; tone: 'u' | 'nn' }) {
  return (
    <span title={title} data-testid={`badge-${tone}`} className="erd-flagmark">
      {children}
    </span>
  )
}

function ColumnRow({
  tableId,
  column,
  isFk,
  selected,
}: {
  tableId: string
  column: Column
  isFk: boolean
  selected: boolean
}) {
  const select = useSchemaStore((s) => s.select)
  return (
    <li
      data-testid="column-row"
      data-column-name={column.name}
      data-column-id={column.id}
      className={clsx('erd-row', selected && 'erd-row--selected')}
      onClick={() => select({ tableId, columnId: column.id })}
    >
      <Handle
        type="source"
        position={Position.Left}
        id={handleId(tableId, column.id, 'L')}
        className="erd-handle"
        data-testid="handle-L"
      />
      <span className="erd-row__name" title={column.note ? `${column.name} — ${column.note}` : column.name}>
        {column.name || <span className="erd-row__empty italic">unnamed</span>}
      </span>
      <span className="erd-row__type" title={column.type}>
        {column.type}
      </span>
      <span className="erd-row__badges">
        {column.pk && <Badge tone="pk" title="Primary key">PK</Badge>}
        {isFk && <Badge tone="fk" title="Foreign key">FK</Badge>}
        {column.unique && !column.pk && <Flag tone="u" title="Unique">U</Flag>}
        {column.notNull && !column.pk && <Flag tone="nn" title="Not null">NN</Flag>}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id={handleId(tableId, column.id, 'R')}
        className="erd-handle"
        data-testid="handle-R"
      />
    </li>
  )
}

function TableNodeImpl({ id, selected }: NodeProps<TableNodeType>) {
  const table = useSchemaStore((s) => s.schema.tables.find((t) => t.id === id))
  const refs = useSchemaStore((s) => s.schema.refs)
  const selectedColumnId = useSchemaStore((s) => (s.selection.tableId === id ? s.selection.columnId : undefined))
  const updateNodeInternals = useUpdateNodeInternals()

  const fkColumnIds = useMemo(() => {
    const set = new Set<string>()
    for (const r of refs) {
      if (r.kind === '<>') {
        if (r.from.tableId === id) r.from.columnIds.forEach((c) => set.add(c))
        if (r.to.tableId === id) r.to.columnIds.forEach((c) => set.add(c))
      } else {
        const { fk } = fkSide(r)
        if (fk.tableId === id) fk.columnIds.forEach((c) => set.add(c))
      }
    }
    return set
  }, [refs, id])

  // Column order/count changes move the handles: tell React Flow to re-measure them.
  const columns = table?.columns
  useEffect(() => {
    updateNodeInternals(id)
  }, [columns, id, updateNodeInternals])

  const multiSelect = useCanvasUi((s) => s.multiSelect)

  if (!table) return null
  // Part of a multi-selection: worth marking explicitly, since a ring alone is easy to lose track
  // of once several tables are picked.
  const multi = selected && multiSelect.includes(id)
  // "Header colour" tints the header, the way dbdiagram.io does and the way the field reads. The
  // tint is a literal hex from the document, identical in both themes, so its ink has to be earned
  // rather than taken from a token; inkFor picks whichever of white/black clears 4.5:1 on it. A
  // value we cannot measure (an imported document may hold anything) leaves the header neutral and
  // keeps the dot, which is where the colour used to show.
  const ink = table.headerColor ? inkFor(table.headerColor) : null
  const headerStyle = ink ? { background: table.headerColor, color: `var(--erd-tint-ink-${ink})` } : undefined
  const dotStyle = table.headerColor ? { background: table.headerColor } : undefined

  return (
    <div
      data-testid="table-node"
      data-table-name={table.name}
      data-table-id={table.id}
      className={clsx('erd-table', selected && 'erd-table--selected', multi && 'erd-table--multi')}
    >
      {multi && (
        <span className="erd-table__check" data-testid="table-selected-badge" aria-label="Selected">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        </span>
      )}
      <div
        className={clsx('erd-table__header', ink && 'erd-table__header--tinted')}
        style={headerStyle}
        data-testid="table-header"
      >
        {/* The dot said "this table has a colour" when the header could not. A tinted header says
            it across its whole width, so the dot would only repeat it in miniature. */}
        {!ink && <span className="erd-table__dot" style={dotStyle} data-testid="table-dot" aria-hidden />}
        <span className="truncate" title={table.schema ? `${table.schema}.${table.name}` : table.name}>
          {table.name || <span className="erd-table__placeholder italic">unnamed</span>}
        </span>
        {table.alias && <span className="erd-row__type truncate">as {table.alias}</span>}
        {table.note && (
          <svg
            aria-label="Has note"
            className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <title>{table.note}</title>
            <path d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
            <path d="M5 8h6M5 11h6" />
          </svg>
        )}
      </div>
      <ul className="erd-table__rows">
        {table.columns.map((c) => (
          <ColumnRow
            key={c.id}
            tableId={id}
            column={c}
            isFk={fkColumnIds.has(c.id)}
            selected={selectedColumnId === c.id}
          />
        ))}
        {table.columns.length === 0 && <li className="erd-row erd-row__empty italic">no columns</li>}
      </ul>
    </div>
  )
}

export const TableNode = memo(TableNodeImpl)

import { memo, useEffect, useMemo } from 'react'
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { useCanvasUi } from './uiStore'
import { fkSide, type Column } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { handleId } from './handles'
import type { TableNodeType } from './types'

/** Pick black or white text for a hex background. */
export function contrastText(hex: string | undefined): string | undefined {
  if (!hex) return undefined
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#18181b' : '#fafafa'
}

function Badge({ children, title, tone }: { children: string; title: string; tone: 'pk' | 'fk' | 'u' | 'nn' }) {
  return (
    <span
      title={title}
      data-testid={`badge-${tone}`}
      className={clsx(
        'rounded px-1 text-[9px] font-bold leading-4 tracking-wide',
        tone === 'pk' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
        tone === 'fk' && 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
        tone === 'u' && 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
        tone === 'nn' && 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
      )}
    >
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
        {column.name || <span className="italic text-zinc-400">unnamed</span>}
      </span>
      <span className="erd-row__type" title={column.type}>
        {column.type}
      </span>
      <span className="erd-row__badges">
        {column.pk && <Badge tone="pk" title="Primary key">PK</Badge>}
        {isFk && <Badge tone="fk" title="Foreign key">FK</Badge>}
        {column.unique && !column.pk && <Badge tone="u" title="Unique">U</Badge>}
        {column.notNull && !column.pk && <Badge tone="nn" title="Not null">NN</Badge>}
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
  const headerStyle = table.headerColor
    ? { background: table.headerColor, color: contrastText(table.headerColor) }
    : undefined

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
      <div className="erd-table__header" style={headerStyle} data-testid="table-header">
        <span className="truncate" title={table.schema ? `${table.schema}.${table.name}` : table.name}>
          {table.name || <span className="italic opacity-60">unnamed</span>}
        </span>
        {table.alias && <span className="ml-1 truncate text-[10px] font-normal opacity-70">as {table.alias}</span>}
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
        {table.columns.length === 0 && <li className="erd-row italic text-zinc-400">no columns</li>}
      </ul>
    </div>
  )
}

export const TableNode = memo(TableNodeImpl)

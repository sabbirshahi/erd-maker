import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import type { Column, Ref, RefAction, RefKind, Table } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { REF_KINDS, refKindLabel, refKindName } from './connection'
import { addColumn, isBlankColumn, moveColumn, removeColumn, removeRef, removeTable } from './mutations'
import { TABLE_COLORS } from './palette'
import { TypeCombobox } from './TypeCombobox'
import { REF_ACTIONS, TYPE_SUGGESTIONS } from './types'
import { beginEditSession, endEditSession, sessionUpdate } from './undoGroup'
import { useCanvasUi } from './uiStore'

/** Focus/blur handlers that open/close an undo-coalescing edit session. */
function useEditSession() {
  const focused = useRef(false)
  useEffect(
    () => () => {
      if (focused.current) endEditSession()
    },
    [],
  )
  return {
    onFocus: () => {
      focused.current = true
      beginEditSession()
    },
    onBlur: () => {
      focused.current = false
      endEditSession()
    },
  }
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx('erd-muted flex flex-col gap-0.5 text-[11px]', className)}>
      {label}
      {children}
    </label>
  )
}

function Flag({
  on,
  label,
  title,
  onToggle,
  testId,
}: {
  on: boolean
  label: string
  title: string
  onToggle: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      data-testid={testId}
      className={clsx('erd-flag', on && 'erd-flag--on')}
      onClick={onToggle}
    >
      {label}
    </button>
  )
}

interface ColumnEditorProps {
  table: Table
  column: Column
  index: number
  isLast: boolean
  typeSuggestions: readonly string[]
  onDragStart: (index: number) => void
  onDropOn: (index: number) => void
  focusRow: (index: number, field: 'name' | 'type') => void
  addAfterLast: () => void
}

function ColumnEditor({ table, column, index, isLast, typeSuggestions, onDragStart, onDropOn, focusRow, addAfterLast }: ColumnEditorProps) {
  const update = useSchemaStore((s) => s.update)
  const select = useSchemaStore((s) => s.select)
  const selected = useSchemaStore((s) => s.selection.tableId === table.id && s.selection.columnId === column.id)
  const session = useEditSession()

  const edit = (mutate: (c: Column) => void) =>
    sessionUpdate((d) => {
      const c = d.tables.find((t) => t.id === table.id)?.columns.find((x) => x.id === column.id)
      if (c) mutate(c)
    })
  const toggle = (mutate: (c: Column) => void) =>
    update('canvas', (d) => {
      const c = d.tables.find((t) => t.id === table.id)?.columns.find((x) => x.id === column.id)
      if (c) mutate(c)
    })
  const remove = (focusPrev: boolean) => {
    endEditSession()
    update('canvas', (d) => removeColumn(d, table.id, column.id))
    if (focusPrev && index > 0) focusRow(index - 1, 'name')
  }

  const onNavKey = (e: KeyboardEvent<HTMLInputElement>, field: 'name' | 'type') => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isLast) addAfterLast()
      else focusRow(index + 1, 'name')
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.blur()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && field === 'name' && e.currentTarget.value === '' && isBlankColumn(column)) {
      e.preventDefault()
      remove(true)
      return
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const to = e.key === 'ArrowUp' ? index - 1 : index + 1
      update('canvas', (d) => moveColumn(d, table.id, index, to))
      focusRow(Math.max(0, Math.min(table.columns.length - 1, to)), field)
    }
  }

  return (
    <li
      data-testid="inspector-column"
      data-column-id={column.id}
      className={clsx('erd-col', selected && 'erd-col--selected')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropOn(index)
      }}
      onFocus={() => {
        if (!selected) select({ tableId: table.id, columnId: column.id })
      }}
    >
      <div className="flex items-center gap-1">
        <span
          className="erd-grip"
          title="Drag to reorder (Alt+↑/↓ with the keyboard)"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(index))
            onDragStart(index)
          }}
          aria-hidden
        >
          ⋮⋮
        </span>
        <input
          className="erd-input min-w-0 flex-1"
          aria-label="Column name"
          data-testid="inspector-col-name"
          data-field="name"
          value={column.name}
          spellCheck={false}
          placeholder="column name"
          onChange={(e) => edit((c) => (c.name = e.target.value))}
          onKeyDown={(e) => onNavKey(e, 'name')}
          {...session}
        />
        <TypeCombobox
          className="w-[7.5rem] shrink-0"
          aria-label="Column type"
          data-testid="inspector-col-type"
          data-field="type"
          value={column.type}
          suggestions={typeSuggestions}
          placeholder="type"
          onChange={(v) => edit((c) => (c.type = v))}
          onKeyDown={(e) => onNavKey(e, 'type')}
          {...session}
        />
        <button
          type="button"
          className="erd-icon-btn"
          title="Remove column"
          aria-label="Remove column"
          data-testid="inspector-col-remove"
          onClick={() => remove(false)}
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1 pl-4">
        <Flag on={column.pk} label="PK" title="Primary key" testId="inspector-col-pk" onToggle={() => toggle((c) => (c.pk = !c.pk))} />
        <Flag on={column.unique} label="U" title="Unique" testId="inspector-col-unique" onToggle={() => toggle((c) => (c.unique = !c.unique))} />
        <Flag on={column.notNull} label="NN" title="Not null" testId="inspector-col-notnull" onToggle={() => toggle((c) => (c.notNull = !c.notNull))} />
        <Flag on={column.increment} label="AI" title="Auto increment" testId="inspector-col-increment" onToggle={() => toggle((c) => (c.increment = !c.increment))} />
        <input
          className="erd-input min-w-0 flex-1 font-mono"
          aria-label="Default"
          data-testid="inspector-col-default"
          data-field="default"
          value={column.default ?? ''}
          spellCheck={false}
          placeholder="default"
          onChange={(e) => edit((c) => (e.target.value === '' ? delete c.default : (c.default = e.target.value)))}
          {...session}
        />
        <input
          className="erd-input min-w-0 flex-1"
          aria-label="Note"
          data-testid="inspector-col-note"
          data-field="note"
          value={column.note ?? ''}
          placeholder="note"
          onChange={(e) => edit((c) => (e.target.value === '' ? delete c.note : (c.note = e.target.value)))}
          {...session}
        />
      </div>
    </li>
  )
}

function TableInspector({ table }: { table: Table }) {
  const update = useSchemaStore((s) => s.update)
  const select = useSchemaStore((s) => s.select)
  const enumNames = useSchemaStore((s) => s.schema.enums.map((e) => e.name).join('\u0000'))
  const focusRequest = useCanvasUi((s) => s.focusRequest)
  const requestFocus = useCanvasUi((s) => s.requestFocus)
  const setPinned = useCanvasUi((s) => s.setPinned)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragIndex = useRef<number | null>(null)
  const session = useEditSession()

  const typeSuggestions = useMemo(
    () => [...TYPE_SUGGESTIONS, ...enumNames.split('\u0000').filter(Boolean)],
    [enumNames],
  )

  const editTable = (mutate: (t: Table) => void) =>
    sessionUpdate((d) => {
      const t = d.tables.find((x) => x.id === table.id)
      if (t) mutate(t)
    })
  const setTable = (mutate: (t: Table) => void) =>
    update('canvas', (d) => {
      const t = d.tables.find((x) => x.id === table.id)
      if (t) mutate(t)
    })

  const focusRow = useCallback(
    (index: number, field: 'name' | 'type') => {
      const col = useSchemaStore.getState().schema.tables.find((t) => t.id === table.id)?.columns[index]
      if (col) requestFocus({ tableId: table.id, columnId: col.id, field })
    },
    [table.id, requestFocus],
  )

  const addColumnAndFocus = useCallback(() => {
    endEditSession()
    let created: string | undefined
    update('canvas', (d) => {
      created = addColumn(d, table.id)?.id
    })
    if (created) {
      select({ tableId: table.id, columnId: created })
      requestFocus({ tableId: table.id, columnId: created, field: 'name' })
    }
  }, [table.id, update, select, requestFocus])

  // One-shot focus requests (from Add table, F2, Enter-on-last-row, …).
  useEffect(() => {
    if (!focusRequest || focusRequest.tableId !== table.id || !rootRef.current) return
    const sel =
      focusRequest.field === 'tableName'
        ? '[data-field="tableName"]'
        : `[data-column-id="${focusRequest.columnId}"] [data-field="${focusRequest.field}"]`
    const el = rootRef.current.querySelector<HTMLInputElement>(sel)
    if (el) {
      el.focus()
      el.select()
      requestFocus(null)
    }
  }, [focusRequest, table.id, table.columns.length, requestFocus])

  const deleteTable = () => {
    endEditSession()
    update('canvas', (d) => removeTable(d, table.id))
    select({})
    setPinned(null)
  }

  const onTableNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (table.columns.length) focusRow(table.columns.length - 1, 'name')
      else addColumnAndFocus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.blur()
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3" data-testid="inspector-table">
      <div className="flex items-start gap-2">
        <Field label="Table" className="min-w-0 flex-1">
          <input
            className="erd-input font-semibold"
            data-testid="inspector-table-name"
            data-field="tableName"
            value={table.name}
            spellCheck={false}
            placeholder="table name"
            onChange={(e) => editTable((t) => (t.name = e.target.value))}
            onKeyDown={onTableNameKey}
            {...session}
          />
        </Field>
        <Field label="Class name" className="w-28">
          <input
            className="erd-input"
            data-testid="inspector-class-name"
            value={table.django?.className ?? ''}
            spellCheck={false}
            placeholder="auto"
            onChange={(e) =>
              editTable((t) => {
                const v = e.target.value.trim()
                if (!v) {
                  if (t.django) delete t.django.className
                } else {
                  t.django = { ...(t.django ?? {}), className: v }
                }
              })
            }
            {...session}
          />
        </Field>
      </div>
      <Field label="Note">
        <textarea
          className="erd-input min-h-[2.25rem] resize-y"
          data-testid="inspector-table-note"
          rows={1}
          value={table.note ?? ''}
          onChange={(e) => editTable((t) => (e.target.value === '' ? delete t.note : (t.note = e.target.value)))}
          {...session}
        />
      </Field>
      <div className="flex items-center gap-1.5">
        <span className="erd-muted text-[11px]">Header</span>
        {TABLE_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.label}
            aria-label={`Header colour ${c.label}`}
            data-testid="inspector-color"
            className={clsx('erd-swatch', table.headerColor === c.hex && 'erd-swatch--on')}
            style={{ background: `var(${c.token})` }}
            onClick={() => setTable((t) => (t.headerColor = c.hex))}
          />
        ))}
        <input
          type="color"
          aria-label="Custom header colour"
          className="erd-swatch cursor-pointer p-0"
          value={table.headerColor ?? TABLE_COLORS[0].hex}
          onChange={(e) => editTable((t) => (t.headerColor = e.target.value))}
          {...session}
        />
        {table.headerColor && (
          <button type="button" className="erd-icon-btn" title="Clear colour" onClick={() => setTable((t) => delete t.headerColor)}>
            ×
          </button>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="erd-muted text-[11px]">
            Columns ({table.columns.length})
          </span>
          <button type="button" className="erd-btn" data-testid="inspector-add-column" onClick={addColumnAndFocus}>
            + Column
          </button>
        </div>
        <ul className="flex flex-col gap-1" data-testid="inspector-columns">
          {table.columns.map((c, i) => (
            <ColumnEditor
              key={c.id}
              table={table}
              column={c}
              index={i}
              isLast={i === table.columns.length - 1}
              typeSuggestions={typeSuggestions}
              onDragStart={(idx) => (dragIndex.current = idx)}
              onDropOn={(idx) => {
                const from = dragIndex.current
                dragIndex.current = null
                if (from !== null && from !== idx) update('canvas', (d) => moveColumn(d, table.id, from, idx))
              }}
              focusRow={focusRow}
              addAfterLast={addColumnAndFocus}
            />
          ))}
        </ul>
        <p className="erd-muted mt-1 text-[10px]">
          Enter adds a column · Tab moves on · Delete on an empty row removes it · Alt+↑/↓ reorders
        </p>
      </div>

      <div className="erd-strip--top flex justify-end pt-2">
        <button type="button" className="erd-btn erd-btn--danger" data-testid="inspector-delete-table" onClick={deleteTable}>
          Delete table
        </button>
      </div>
    </div>
  )
}

function RefInspector({ relation }: { relation: Ref }) {
  const update = useSchemaStore((s) => s.update)
  const select = useSchemaStore((s) => s.select)
  const tables = useSchemaStore((s) => s.schema.tables)
  const setPinned = useCanvasUi((s) => s.setPinned)
  const session = useEditSession()

  const label = (ep: Ref['from']) => {
    const t = tables.find((x) => x.id === ep.tableId)
    const cols = ep.columnIds.map((id) => t?.columns.find((c) => c.id === id)?.name ?? '?').join(', ')
    return `${t?.name ?? '?'}.${ep.columnIds.length > 1 ? `(${cols})` : cols}`
  }
  const edit = (mutate: (r: Ref) => void) =>
    update('canvas', (d) => {
      const r = d.refs.find((x) => x.id === relation.id)
      if (r) mutate(r)
    })
  const editText = (mutate: (r: Ref) => void) =>
    sessionUpdate((d) => {
      const r = d.refs.find((x) => x.id === relation.id)
      if (r) mutate(r)
    })

  return (
    <div className="flex flex-col gap-3" data-testid="inspector-ref">
      <div className="text-xs">
        <div className="font-mono" data-testid="inspector-ref-from">{label(relation.from)}</div>
        <div className="erd-muted my-0.5 text-center">{refKindLabel(relation.kind)}</div>
        <div className="font-mono" data-testid="inspector-ref-to">{label(relation.to)}</div>
      </div>
      <Field label="Kind">
        <select className="erd-select" data-testid="inspector-ref-kind" value={relation.kind} onChange={(e) => edit((r) => (r.kind = e.target.value as RefKind))}>
          {REF_KINDS.map((k) => (
            <option key={k} value={k}>
              {refKindLabel(k)} — {refKindName(k)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="On delete">
          <select
            className="erd-select"
            data-testid="inspector-ref-on-delete"
            value={relation.onDelete ?? ''}
            onChange={(e) => edit((r) => (e.target.value === '' ? delete r.onDelete : (r.onDelete = e.target.value as RefAction)))}
          >
            <option value="">default</option>
            {REF_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="On update">
          <select
            className="erd-select"
            data-testid="inspector-ref-on-update"
            value={relation.onUpdate ?? ''}
            onChange={(e) => edit((r) => (e.target.value === '' ? delete r.onUpdate : (r.onUpdate = e.target.value as RefAction)))}
          >
            <option value="">default</option>
            {REF_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Name (optional)">
        <input
          className="erd-input"
          data-testid="inspector-ref-name"
          value={relation.name ?? ''}
          spellCheck={false}
          onChange={(e) => editText((r) => (e.target.value === '' ? delete r.name : (r.name = e.target.value)))}
          {...session}
        />
      </Field>
      <div className="erd-strip--top flex justify-end pt-2">
        <button
          type="button"
          className="erd-btn erd-btn--danger"
          data-testid="inspector-delete-ref"
          onClick={() => {
            update('canvas', (d) => removeRef(d, relation.id))
            select({})
            setPinned(null)
          }}
        >
          Delete relation
        </button>
      </div>
    </div>
  )
}

/** Right-hand overlay shown while a table or relation is selected. */
export function Inspector() {
  const tableId = useSchemaStore((s) => s.selection.tableId)
  const refId = useSchemaStore((s) => s.selection.refId)
  const table = useSchemaStore((s) => (tableId ? s.schema.tables.find((t) => t.id === tableId) : undefined))
  const relation = useSchemaStore((s) => (refId ? s.schema.refs.find((r) => r.id === refId) : undefined))
  const select = useSchemaStore((s) => s.select)
  const open = useCanvasUi((s) => s.inspectorOpen)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => () => endEditSession(), [])
  if (!open || (!table && !relation)) return null

  return (
    <aside
      data-inspector
      data-testid="inspector"
      className={clsx(
        'erd-inspector nodrag nopan nowheel',
        collapsed && 'erd-inspector--collapsed',
      )}
      onKeyDown={(e) => {
        // keep canvas-level Delete/Escape handlers from firing for keys used inside the panel
        if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation()
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="erd-muted text-xs">
          {table ? 'Table' : 'Relation'}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className="erd-icon-btn" title={collapsed ? 'Expand' : 'Collapse'} data-testid="inspector-collapse" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className="erd-icon-btn"
            title="Close (Esc)"
            aria-label="Close inspector"
            data-testid="inspector-close"
            onClick={() => {
              endEditSession()
              select({})
              useCanvasUi.getState().setPinned(null)
            }}
          >
            ×
          </button>
        </div>
      </div>
      {!collapsed && (table ? <TableInspector table={table} /> : relation ? <RefInspector relation={relation} /> : null)}
    </aside>
  )
}

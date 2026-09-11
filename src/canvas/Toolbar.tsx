import { Panel } from '@xyflow/react'
import clsx from 'clsx'
import { useStore } from 'zustand'
import { useSchemaStore } from '@/store'
import type { CanvasActions } from './useCanvasActions'

function ToolButton({
  label,
  shortcut,
  onClick,
  disabled,
  testId,
  danger,
  children,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  testId: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={clsx('erd-tool', danger && 'erd-tool--danger')}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const I = ({ d }: { d: string }) => (
  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

export function Toolbar({ actions, busy }: { actions: CanvasActions; busy: boolean }) {
  const hasSelection = useSchemaStore((s) => Boolean(s.selection.tableId || s.selection.refId))
  const tableCount = useSchemaStore((s) => s.schema.tables.length)
  const past = useStore(useSchemaStore.temporal, (s) => s.pastStates.length)
  const future = useStore(useSchemaStore.temporal, (s) => s.futureStates.length)

  return (
    <Panel position="top-left" className="erd-toolbar" data-testid="canvas-toolbar">
      <ToolButton label="Add table" shortcut="Ctrl+Shift+T" onClick={actions.addTable} testId="tb-add-table">
        <I d="M2.5 3.5h11v9h-11zM2.5 6.5h11M8 3.5v9" />
        <span className="hidden sm:inline">Table</span>
      </ToolButton>
      <span className="erd-toolbar__sep" />
      <ToolButton label="Auto-layout" onClick={() => void actions.autoLayout()} disabled={busy || tableCount === 0} testId="tb-auto-layout">
        <I d="M2.5 2.5h4v4h-4zM9.5 9.5h4v4h-4zM9.5 2.5h4v4h-4zM6.5 4.5h3M4.5 6.5v3h5" />
        <span className="hidden sm:inline">{busy ? 'Layout…' : 'Layout'}</span>
      </ToolButton>
      <ToolButton label="Fit view" onClick={actions.fitView} disabled={tableCount === 0} testId="tb-fit">
        <I d="M2.5 6v-3.5h3.5M13.5 6v-3.5h-3.5M2.5 10v3.5h3.5M13.5 10v3.5h-3.5" />
      </ToolButton>
      <span className="erd-toolbar__sep" />
      <ToolButton label="Undo" shortcut="Ctrl+Z" onClick={actions.undo} disabled={past === 0} testId="tb-undo">
        <I d="M6 4.5L3 7.5l3 3M3 7.5h6.5a3 3 0 0 1 0 6H8" />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={actions.redo} disabled={future === 0} testId="tb-redo">
        <I d="M10 4.5l3 3-3 3M13 7.5H6.5a3 3 0 0 0 0 6H8" />
      </ToolButton>
      <span className="erd-toolbar__sep" />
      <ToolButton label="Delete selected" shortcut="Delete" onClick={actions.deleteSelected} disabled={!hasSelection} testId="tb-delete" danger>
        <I d="M3 4.5h10M6 4.5v-1h4v1M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v4M9.2 7v4" />
      </ToolButton>
    </Panel>
  )
}

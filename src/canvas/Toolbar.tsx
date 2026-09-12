/**
 * Canvas toolbar: one segmented pill, top-left.
 *
 * Undo and redo used to sit here as well as in the top bar. Two identical controls in one screen
 * is a coin toss for the user, so they live in the header only. Fit-to-screen moved to the zoom
 * pill in the bottom-left, next to the other view controls.
 */
import { Panel } from '@xyflow/react'
import clsx from 'clsx'
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
  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

export function Toolbar({ actions, busy }: { actions: CanvasActions; busy: boolean }) {
  const hasSelection = useSchemaStore((s) => Boolean(s.selection.tableId || s.selection.refId))
  const tableCount = useSchemaStore((s) => s.schema.tables.length)

  return (
    <Panel position="top-left" className="erd-toolbar" data-testid="canvas-toolbar">
      <ToolButton label="Add table" shortcut="Ctrl+Shift+T" onClick={actions.addTable} testId="tb-add-table">
        <I d="M2.5 3.5h11v9h-11zM2.5 6.5h11M8 3.5v9" />
        <span>Table</span>
      </ToolButton>
      <ToolButton label="Arrange tables" onClick={() => void actions.autoLayout()} disabled={busy || tableCount === 0} testId="tb-auto-layout">
        <I d="M2.5 2.5h4v4h-4zM9.5 9.5h4v4h-4zM9.5 2.5h4v4h-4zM6.5 4.5h3M4.5 6.5v3h5" />
        <span>{busy ? 'Arranging…' : 'Arrange'}</span>
      </ToolButton>
      <span className="erd-toolbar__sep" />
      <ToolButton label="Delete selected" shortcut="Delete" onClick={actions.deleteSelected} disabled={!hasSelection} testId="tb-delete" danger>
        <I d="M3 4.5h10M6 4.5v-1h4v1M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v4M9.2 7v4" />
      </ToolButton>
    </Panel>
  )
}

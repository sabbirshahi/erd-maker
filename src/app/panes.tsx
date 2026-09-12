/**
 * Lazy panes for sibling workers' components (worker-2 canvas, worker-3 editors, worker-5 demo).
 * Every pane is code-split with React.lazy so xyflow / codemirror / pyodide stay out of the entry chunk,
 * and the shell wraps each one in Suspense + ErrorBoundary so a broken pane never kills the app.
 */
import { lazy } from 'react'

export function Placeholder({ name, hint }: { name: string; hint?: string }) {
  return (
    <div
      data-testid={`placeholder-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      className="erd-placeholder flex h-full w-full flex-col items-center justify-center gap-1 p-6 text-center"
    >
      <div>{name}</div>
      <div>{hint ?? 'This pane has not landed yet.'}</div>
    </div>
  )
}

export interface DialogProps {
  open: boolean
  onClose: () => void
}

export const Canvas = lazy(() => import('@/canvas').then((m) => ({ default: m.Canvas })))
export const DbmlEditor = lazy(() => import('@/editors').then((m) => ({ default: m.DbmlEditor })))
export const DjangoEditor = lazy(() => import('@/editors').then((m) => ({ default: m.DjangoEditor })))
export const ImportDialog = lazy(() => import('@/editors').then((m) => ({ default: m.ImportDialog })))
export const ExportDialog = lazy(() => import('@/editors').then((m) => ({ default: m.ExportDialog })))
export const DemoPanel = lazy(() => import('@/demo').then((m) => ({ default: m.DemoPanel })))

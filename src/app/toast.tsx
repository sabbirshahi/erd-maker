/**
 * Minimal toast system (M8). `toast(message)` from anywhere; `<Toaster/>` renders them.
 * Pure module-level store so non-React code (e.g. share.ts) can call it too.
 */
import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()
const DURATION_MS = 2000

function emit() {
  for (const l of listeners) l(toasts)
}

/** Show a toast for ~2 s. Returns the toast id. */
export function toast(message: string, kind: Toast['kind'] = 'info'): number {
  const id = nextId++
  toasts = [...toasts, { id, message, kind }]
  emit()
  if (typeof setTimeout === 'function') {
    setTimeout(() => dismiss(id), kind === 'error' ? DURATION_MS * 2 : DURATION_MS)
  }
  return id
}

export function dismiss(id: number) {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Test helper. */
export function clearToasts() {
  toasts = []
  emit()
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const getSnapshot = () => toasts

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function Toaster() {
  const items = useToasts()
  return (
    <div
      aria-live="polite"
      data-testid="toaster"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="toast"
          className={
            'pointer-events-auto rounded-md px-3 py-2 text-sm shadow-lg ring-1 ' +
            (t.kind === 'error'
              ? 'bg-red-600 text-white ring-red-700'
              : 'bg-zinc-900 text-zinc-50 ring-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-300')
          }
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

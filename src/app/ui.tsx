/** Small Tailwind building blocks shared by the shell. OWNER: worker-6. */
import { clsx } from 'clsx'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'

export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        variant === 'default' &&
          'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
        variant === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400',
        variant === 'ghost' && 'text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-500',
        className,
      )}
    />
  )
}

export function IconButton({
  className,
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-200/70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-800',
        className,
      )}
    >
      {children}
    </button>
  )
}

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  badge?: number
  testId?: string
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={clsx('flex items-end gap-1', className)}>
      {items.map((it) => {
        const active = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={it.testId ?? `tab-${it.id}`}
            onClick={() => onChange(it.id)}
            className={clsx(
              'inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-sm font-medium',
              active
                ? 'border-indigo-600 text-zinc-900 dark:border-indigo-400 dark:text-zinc-50'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {it.label}
            {it.badge !== undefined && it.badge > 0 && (
              <span
                data-testid={`${it.testId ?? `tab-${it.id}`}-badge`}
                className="rounded-full bg-zinc-200 px-1.5 text-[10px] leading-4 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
              >
                {it.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  testId,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  width?: string
  testId?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        className={clsx(
          'w-full rounded-lg bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700',
          width,
        )}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </IconButton>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 font-mono text-[10px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </kbd>
  )
}

export class ErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-red-600 dark:text-red-400">
          <div className="font-semibold">{this.props.name} failed to render</div>
          <pre className="max-w-full overflow-auto text-xs text-zinc-500">{String(this.state.error.message)}</pre>
          <Button size="sm" onClick={() => this.setState({ error: null })}>
            Retry
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

/** Simple dropdown menu anchored to a trigger button. */
export function Menu({
  trigger,
  items,
  align = 'left',
  testId,
}: {
  trigger: (props: { onClick: () => void; open: boolean }) => ReactNode
  items: { id: string; label: ReactNode; onSelect: () => void; disabled?: boolean; hint?: ReactNode }[]
  align?: 'left' | 'right'
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Capture phase: the canvas stops mousedown from bubbling while it starts a pan or a drag, so
    // a bubbling listener never sees clicks on the canvas and the menu would stay open over it.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), open })}
      {open && (
        <div
          role="menu"
          data-testid={testId}
          className={clsx(
            'absolute z-40 mt-1 min-w-48 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              data-testid={`menu-${it.id}`}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
              className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              <span>{it.label}</span>
              {it.hint && <span className="text-xs text-zinc-400">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

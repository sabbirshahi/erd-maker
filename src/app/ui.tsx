/**
 * Small building blocks shared by the shell.
 *
 * Colour, radius and weight come from src/app/shell.css (which reads src/tokens.css). Only layout
 * utilities are inline here. OWNER: worker-6.
 */
import { clsx } from 'clsx'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'

export function Button({
  className,
  variant = 'outline',
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'outline' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      {...props}
      className={clsx('erd-b', `erd-b--${variant}`, size === 'sm' && 'erd-b--sm', className)}
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
    <button type="button" aria-label={label} title={label} {...props} className={clsx('erd-iconbtn', className)}>
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
    <div role="tablist" className={clsx('erd-tabs', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          data-testid={it.testId ?? `tab-${it.id}`}
          onClick={() => onChange(it.id)}
          className="erd-tab"
        >
          {it.label}
          {it.badge !== undefined && it.badge > 0 && (
            <span data-testid={`${it.testId ?? `tab-${it.id}`}-badge`} className="erd-tab__badge">
              {it.badge}
            </span>
          )}
        </button>
      ))}
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
      className="erd-modal__scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" data-testid={testId} className={clsx('erd-modal', width)}>
        {title !== undefined && (
          <div className="erd-modal__head">
            <h2 className="erd-modal__title">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
  return <kbd className="erd-kbd">{children}</kbd>
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
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs" style={{ color: 'var(--erd-danger)' }}>
          <div>{this.props.name} failed to render</div>
          <pre className="max-w-full overflow-auto" style={{ color: 'var(--erd-text-muted)' }}>{String(this.state.error.message)}</pre>
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
        <div role="menu" data-testid={testId} className={clsx('erd-menu', align === 'right' ? 'right-0' : 'left-0')}>
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
              className="erd-menuitem"
            >
              <span>{it.label}</span>
              {it.hint && <span className="erd-menuitem__hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

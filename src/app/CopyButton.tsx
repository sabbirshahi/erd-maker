/**
 * M8 copy primitive: writes `text` to the clipboard and toasts "Copied {label}".
 * Falls back to a hidden textarea + execCommand when the async clipboard API is unavailable.
 */
import { clsx } from 'clsx'
import { toast } from './toast'

export interface CopyButtonProps {
  text: string | (() => string)
  label: string
  className?: string
  /** Visual size. */
  size?: 'sm' | 'md'
  /** Optional custom children (defaults to "Copy"). */
  children?: React.ReactNode
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function CopyButton({ text, label, className, size = 'sm', children }: CopyButtonProps) {
  const onClick = async () => {
    const value = typeof text === 'function' ? text() : text
    const ok = await copyText(value)
    if (ok) toast(`Copied ${label}`)
    else toast(`Could not copy ${label}`, 'error')
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={clsx(
        'inline-flex items-center gap-1 rounded border border-zinc-300 bg-white font-medium text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm',
        className,
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {children ?? 'Copy'}
    </button>
  )
}

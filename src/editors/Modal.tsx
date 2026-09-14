/** Minimal accessible modal used by the Import/Export dialogs. Colour comes from src/app/shell.css. */
import { useEffect, type ReactNode } from 'react'
import '@/app/shell.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  testId?: string
  widthClass?: string
}

export function Modal({ open, onClose, title, children, testId, widthClass = 'max-w-3xl' }: ModalProps) {
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
      data-testid={testId ? `${testId}-backdrop` : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={`erd-modal erd-modal--flow ${widthClass}`}
      >
        <div className="erd-modal__head">
          <h2 className="erd-modal__title">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="erd-iconbtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="erd-modal__body">{children}</div>
      </div>
    </div>
  )
}

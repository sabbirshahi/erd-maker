import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import clsx from 'clsx'

export interface TypeComboboxProps {
  value: string
  onChange: (value: string) => void
  suggestions: readonly string[]
  inputRef?: Ref<HTMLInputElement>
  className?: string
  placeholder?: string
  'aria-label'?: string
  'data-testid'?: string
  'data-field'?: string
  onFocus?: () => void
  onBlur?: () => void
  /** Called for keys the combobox did not consume (Enter/Escape/Tab/…). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Minimal accessible combobox: free text plus a filtered suggestion list.
 * Arrow keys move, Enter accepts the active suggestion, Escape closes the list.
 * Keys the list does not use are forwarded to `onKeyDown` so the inspector can
 * implement its row navigation.
 */
export function TypeCombobox({ value, onChange, suggestions, inputRef, className, onKeyDown, ...rest }: TypeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return [...suggestions]
    const starts = suggestions.filter((s) => s.toLowerCase().startsWith(q))
    const contains = suggestions.filter((s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q))
    return [...starts, ...contains]
  }, [value, suggestions])

  useEffect(() => {
    if (active >= filtered.length) setActive(filtered.length - 1)
  }, [filtered.length, active])

  const pick = (s: string) => {
    onChange(s)
    setOpen(false)
    setActive(-1)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive((a) => (filtered.length ? (a + 1) % filtered.length : -1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive((a) => (filtered.length ? (a <= 0 ? filtered.length - 1 : a - 1) : -1))
      return
    }
    if (e.key === 'Enter' && open && active >= 0 && filtered[active] !== undefined) {
      e.preventDefault()
      pick(filtered[active])
      return
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setActive(-1)
      return
    }
    if (e.key === 'Tab') setOpen(false)
    onKeyDown?.(e)
  }

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={rest['aria-label']}
        data-testid={rest['data-testid']}
        data-field={rest['data-field']}
        placeholder={rest.placeholder}
        className="erd-input w-full font-mono"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => rest.onFocus?.()}
        onBlur={() => {
          setOpen(false)
          setActive(-1)
          rest.onBlur?.()
        }}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-20 mt-0.5 max-h-44 w-max min-w-full overflow-auto rounded border border-zinc-200 bg-white py-0.5 font-mono text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          data-testid="type-suggestions"
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={clsx(
                'cursor-pointer px-2 py-0.5',
                i === active ? 'bg-indigo-500 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700',
              )}
              onMouseDown={(e) => {
                e.preventDefault() // keep input focus
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

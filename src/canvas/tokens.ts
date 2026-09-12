/**
 * Read design tokens from the DOM.
 *
 * Some canvas colours have to be handed to React Flow as plain strings (SVG marker fills, minimap
 * props) where `var(--x)` is not accepted. Rather than duplicating hex values in TypeScript, this
 * resolves them from the stylesheet, so tokens.css stays the only place they are written down.
 */
import { useEffect, useState } from 'react'

export function readToken(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Resolve tokens, re-reading whenever `themeKey` changes (light <-> dark). */
export function useTokens<T extends readonly string[]>(names: T, themeKey: string): Record<T[number], string> {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const n of names) next[n] = readToken(n)
    setValues(next)
    // `names` is a literal array at every call site; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey])
  return values as Record<T[number], string>
}

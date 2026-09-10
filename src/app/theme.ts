/** Dark mode — class strategy on <html>, persisted in localStorage. */
import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
export const THEME_KEY = 'erd-maker:theme'

const listeners = new Set<(t: Theme) => void>()

export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function getTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(theme: Theme, persist = true) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore quota / privacy mode */
    }
  }
  for (const l of listeners) l(theme)
}

/** Call once before first render. */
export function initTheme(): Theme {
  const t = readStoredTheme() ?? systemTheme()
  applyTheme(t, false)
  return t
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === 'undefined' ? 'light' : getTheme(),
  )
  useEffect(() => {
    listeners.add(setTheme)
    return () => {
      listeners.delete(setTheme)
    }
  }, [])
  return [theme, toggleTheme]
}

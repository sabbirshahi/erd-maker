import { useSyncExternalStore } from 'react'

/**
 * Tracks a CSS media query from React.
 *
 * The narrow layout is almost entirely CSS, but two things cannot be done with a media query
 * alone: a control that is hidden from the top bar has to reappear inside the overflow menu, and
 * a menu's items are built in JSX. Rendering both sets and hiding one with CSS would leave the
 * hidden copy in the accessibility tree and reachable by keyboard, so the decision is made here.
 *
 * matchMedia is missing in a non-browser render, so the server snapshot reports the wide layout:
 * the desktop bar is the one that degrades gracefully if the first paint guesses wrong.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/**
 * The width at which the two panes stop fitting side by side and start taking turns. Must stay in
 * step with the matching `max-width: 860px` block in shell.css.
 */
export const STACKED = '(max-width: 860px)'

/**
 * The width at which the top bar runs out of room and its overflow moves into the More menu.
 * It must stay in step with the matching `max-width: 640px` block in shell.css, which hides the
 * same controls: if the two drift apart a control is either listed twice or not at all.
 */
export const NARROW = '(max-width: 640px)'

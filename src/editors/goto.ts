/**
 * `erd:goto` listener: the Problems panel (worker-6) dispatches
 * `new CustomEvent('erd:goto', { detail: { view: 'dbml' | 'django', line, col? } })`
 * on `window`; the matching editor scrolls to and focuses that line.
 */
import { useEffect, type RefObject } from 'react'
import type { TextView } from '@/store'
import type { CodeMirrorEditorHandle } from './CodeMirrorEditor'

export interface GotoDetail {
  view: TextView
  line: number
  col?: number
}

export const GOTO_EVENT = 'erd:goto'

export function useGotoLine(view: TextView, handle: RefObject<CodeMirrorEditorHandle | null>): void {
  useEffect(() => {
    const onGoto = (e: Event) => {
      const detail = (e as CustomEvent<GotoDetail>).detail
      if (!detail || detail.view !== view || typeof detail.line !== 'number') return
      handle.current?.gotoLine(detail.line, detail.col)
    }
    window.addEventListener(GOTO_EVENT, onGoto)
    return () => window.removeEventListener(GOTO_EVENT, onGoto)
  }, [view, handle])
}

/** Helper for callers: jump an editor to a line. */
export function gotoLine(view: TextView, line: number, col?: number): void {
  window.dispatchEvent(new CustomEvent<GotoDetail>(GOTO_EVENT, { detail: { view, line, col } }))
}

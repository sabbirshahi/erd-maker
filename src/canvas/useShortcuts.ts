/**
 * Canvas keyboard shortcuts. Undo/redo keys are handled by the app shell (worker-6);
 * we only handle Ctrl+Shift+T, Delete/Backspace, F2 and Escape, and stay out of the way
 * of inputs, CodeMirror and the inspector.
 */
import { useEffect } from 'react'
import type { CanvasActions } from './useCanvasActions'

export const isEditableTarget = (el: EventTarget | null): boolean =>
  el instanceof Element && el.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null

export function useShortcuts(actions: CanvasActions, root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const target = e.target
      const inEditor = target instanceof Element && target.closest('.cm-editor') !== null
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.shiftKey && (e.code === 'KeyT' || e.key.toLowerCase() === 't')) {
        if (inEditor) return
        e.preventDefault()
        actions.addTable()
        return
      }
      if (isEditableTarget(target)) return

      const inInspector = target instanceof Element && target.closest('[data-inspector]') !== null
      const inCanvas =
        target === document.body ||
        target === document.documentElement ||
        (target instanceof Element && root.current?.contains(target))

      if (e.key === 'Escape') {
        actions.clearSelection()
        return
      }
      if (!inCanvas) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInspector) {
        e.preventDefault()
        actions.deleteSelected()
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        actions.renameSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions, root])
}

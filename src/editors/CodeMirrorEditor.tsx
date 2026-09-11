/**
 * Thin React wrapper around CodeMirror 6. Owns the EditorView; the parent owns the text.
 * External `value` changes are applied as a minimal diff so the selection and scroll
 * position survive regenerations.
 */
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { EditorState, EditorSelection, ChangeSet, Compartment, Annotation, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { lintGutter, setDiagnostics as cmSetDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { Diagnostic } from '@/core/schema'

/** Marks transactions that mirror an external (store) change. */
export const externalChange = Annotation.define<boolean>()

export interface CodeMirrorEditorHandle {
  view: EditorView | null
  /** Replace the document with `text` preserving scroll and (when possible) the cursor. */
  setValue(text: string): void
  getValue(): string
  focus(): void
  /** Scroll to and place the cursor on a 1-based line. */
  gotoLine(line: number, col?: number): void
}

export interface CodeMirrorEditorProps {
  value: string
  onChange?: (text: string) => void
  extensions?: Extension[]
  diagnostics?: Diagnostic[]
  onFocus?: () => void
  onBlur?: () => void
  readOnly?: boolean
  className?: string
  placeholder?: string
  /** Attribute for e2e selectors. */
  testId?: string
  /** Imperative handle. */
  ref?: Ref<CodeMirrorEditorHandle>
}

/** Compute the minimal single-range change that turns `oldText` into `newText`. */
export function minimalChange(oldText: string, newText: string): { from: number; to: number; insert: string } | null {
  if (oldText === newText) return null
  let prefix = 0
  const max = Math.min(oldText.length, newText.length)
  while (prefix < max && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  )
    suffix++
  return { from: prefix, to: oldText.length - suffix, insert: newText.slice(prefix, newText.length - suffix) }
}

/** Convert IR diagnostics (1-based line/col) to CodeMirror diagnostics (offsets) for `doc`. */
export function toCmDiagnostics(doc: string, diagnostics: Diagnostic[]): CmDiagnostic[] {
  const lines = doc.split('\n')
  const lineStart: number[] = [0]
  for (let i = 0; i < lines.length - 1; i++) lineStart.push(lineStart[i] + lines[i].length + 1)
  const clampLine = (l: number) => Math.min(Math.max(1, l), lines.length)
  const out: CmDiagnostic[] = []
  for (const d of diagnostics) {
    const line = clampLine(d.line ?? 1)
    const lineText = lines[line - 1] ?? ''
    const start = lineStart[line - 1] ?? 0
    // When no line is given, mark the first line so the marker is at least visible.
    const col = d.col !== undefined ? Math.min(Math.max(1, d.col), lineText.length + 1) : 1
    let from = start + col - 1
    let to: number
    if (d.endLine !== undefined) {
      const el = clampLine(d.endLine)
      const elText = lines[el - 1] ?? ''
      const ec = d.endCol !== undefined ? Math.min(Math.max(1, d.endCol), elText.length + 1) : elText.length + 1
      to = (lineStart[el - 1] ?? 0) + ec - 1
    } else if (d.endCol !== undefined) {
      to = start + Math.min(Math.max(1, d.endCol), lineText.length + 1) - 1
    } else {
      // Whole line (at least one char so the marker paints; skip leading whitespace).
      const firstNonWs = lineText.search(/\S/)
      if (d.col === undefined && firstNonWs > 0) from = start + firstNonWs
      to = start + lineText.length
    }
    if (to <= from) to = Math.min(from + 1, doc.length)
    if (from > doc.length) from = doc.length
    if (to > doc.length) to = doc.length
    if (to < from) to = from
    out.push({
      from,
      to,
      severity: d.severity,
      message: d.message,
      source: d.source,
    })
  }
  return out
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
  '.cm-content': { minHeight: '100%' },
  '&.cm-focused': { outline: 'none' },
})

export function CodeMirrorEditor({
  value,
  onChange,
  extensions,
  diagnostics,
  onFocus,
  onBlur,
  readOnly = false,
  className,
  placeholder,
  testId,
  ref,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyComp = useRef(new Compartment())
  const extComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const onBlurRef = useRef(onBlur)
  const valueRef = useRef(value)
  onChangeRef.current = onChange
  onFocusRef.current = onFocus
  onBlurRef.current = onBlur

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current
      },
      setValue(text: string) {
        applyValue(viewRef.current, text)
      },
      getValue() {
        return viewRef.current?.state.doc.toString() ?? ''
      },
      focus() {
        viewRef.current?.focus()
      },
      gotoLine(line: number, col = 1) {
        const view = viewRef.current
        if (!view) return
        const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
        const pos = Math.min(l.from + Math.max(0, col - 1), l.to)
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
        view.focus()
      },
    }),
    [],
  )

  // Create the view once.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        basicSetup,
        lintGutter(),
        keymap.of([indentWithTab]),
        baseTheme,
        readOnlyComp.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        extComp.current.of(extensions ?? []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            valueRef.current = text
            onChangeRef.current?.(text)
          }
          if (update.focusChanged) {
            if (update.view.hasFocus) onFocusRef.current?.()
            else onBlurRef.current?.()
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    // Test hook: lets Playwright inspect selection/doc (`el.__cmView.state`).
    ;(host as HTMLDivElement & { __cmView?: EditorView }).__cmView = view
    if (placeholder) host.dataset.placeholder = placeholder
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External value changes → minimal diff.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === valueRef.current) return
    valueRef.current = value
    applyValue(view, value)
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyComp.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: extComp.current.reconfigure(extensions ?? []) })
  }, [extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(cmSetDiagnostics(view.state, toCmDiagnostics(view.state.doc.toString(), diagnostics ?? [])))
  }, [diagnostics, value])

  return (
    <div
      ref={hostRef}
      data-testid={testId}
      data-readonly={readOnly ? 'true' : undefined}
      className={className ?? 'h-full min-h-0 w-full overflow-hidden'}
    />
  )
}

/**
 * Replace the document with `text` as a minimal edit, explicitly carrying the caret and the
 * scroll position across the change. Exported for tests.
 *
 * - The selection is mapped through the ChangeSet (so a cursor after an inserted block moves with
 *   its text, and a cursor before it stays put) and clamped to the new document length.
 * - The scroll offsets are captured before and restored after the dispatch, and CodeMirror is told
 *   not to scroll the (mapped) selection into view.
 */
export function applyValue(view: EditorView | null, text: string): void {
  if (!view) return
  const current = view.state.doc.toString()
  const change = minimalChange(current, text)
  if (!change) return
  const changes = ChangeSet.of(change, current.length)
  const newLength = changes.newLength
  const clamp = (pos: number) => Math.min(Math.max(0, pos), newLength)
  const mapped = view.state.selection.map(changes)
  const selection = EditorSelection.create(
    mapped.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))),
    mapped.mainIndex,
  )
  const { scrollTop, scrollLeft } = view.scrollDOM
  view.dispatch({
    changes,
    selection,
    scrollIntoView: false,
    // Keep the transaction out of the undo history: it mirrors an external edit.
    annotations: [externalChange.of(true)],
  })
  view.scrollDOM.scrollTop = scrollTop
  view.scrollDOM.scrollLeft = scrollLeft
}

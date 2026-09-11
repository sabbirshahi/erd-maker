import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { applyValue, externalChange, minimalChange, toCmDiagnostics } from './CodeMirrorEditor'

describe('minimalChange', () => {
  it('returns null for identical text', () => {
    expect(minimalChange('abc', 'abc')).toBeNull()
  })
  it('finds the changed middle', () => {
    expect(minimalChange('Table a {}\nTable b {}', 'Table a {}\nTable bb {}')).toEqual({
      from: 18,
      to: 18,
      insert: 'b',
    })
    expect(minimalChange('hello world', 'hello')).toEqual({ from: 5, to: 11, insert: '' })
    expect(minimalChange('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' })
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
  })
})

describe('toCmDiagnostics', () => {
  const doc = 'Table t {\n  id itn\n}\n'
  it('maps line/col to offsets', () => {
    const [d] = toCmDiagnostics(doc, [
      { id: '1', severity: 'error', source: 'dbml', message: 'm', line: 2, col: 6, endCol: 9 },
    ])
    expect(d.from).toBe(15)
    expect(d.to).toBe(18)
    expect(d.severity).toBe('error')
    expect(d.message).toBe('m')
  })
  it('marks the whole trimmed line when only a line is given', () => {
    const [d] = toCmDiagnostics(doc, [{ id: '1', severity: 'warning', source: 'dbml', message: 'm', line: 2 }])
    expect(doc.slice(d.from, d.to)).toBe('id itn')
  })
  it('clamps out-of-range positions and never yields inverted ranges', () => {
    const [d] = toCmDiagnostics(doc, [
      { id: '1', severity: 'error', source: 'dbml', message: 'm', line: 99, col: 99 },
    ])
    expect(d.from).toBeLessThanOrEqual(doc.length)
    expect(d.to).toBeGreaterThanOrEqual(d.from)
    const [e] = toCmDiagnostics('', [{ id: '2', severity: 'error', source: 'dbml', message: 'm' }])
    expect(e.from).toBe(0)
    expect(e.to).toBe(0)
  })
  it('spans multiple lines with endLine', () => {
    const [d] = toCmDiagnostics(doc, [
      { id: '1', severity: 'info', source: 'dbml', message: 'm', line: 1, col: 1, endLine: 3, endCol: 2 },
    ])
    expect(doc.slice(d.from, d.to)).toBe('Table t {\n  id itn\n}')
  })
})

describe('applyValue (jsdom EditorView)', () => {
  beforeAll(() => {
    // jsdom has no layout; CodeMirror only needs these to exist to measure.
    const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })
    if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect as unknown as () => DOMRect
    if (!('getClientRects' in Element.prototype)) (Element.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = () => [] as unknown as DOMRectList
  })

  const views: EditorView[] = []
  afterEach(() => {
    for (const v of views.splice(0)) v.destroy()
  })

  function makeView(doc: string, head: number, anchor = head) {
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
      parent: document.body,
    })
    views.push(view)
    return view
  }

  const DOC = 'Table users {\n  id int [pk]\n}\n\nTable posts {\n  id int [pk]\n}\n'
  const posOf = (doc: string, needle: string) => doc.indexOf(needle)

  it('keeps the caret on its text when the change is after it', () => {
    const head = posOf(DOC, 'id int [pk]') + 2 // inside "id" of users
    const view = makeView(DOC, head)
    const next = DOC.replace('Table posts {\n  id int [pk]\n', 'Table posts {\n  id int [pk]\n  title varchar(200)\n')
    applyValue(view, next)
    expect(view.state.doc.toString()).toBe(next)
    expect(view.state.selection.main.head).toBe(head)
    expect(view.state.selection.main.empty).toBe(true)
  })

  it('moves the caret with its text when the change is before it', () => {
    const head = posOf(DOC, 'Table posts') // start of the posts table
    const view = makeView(DOC, head)
    const inserted = '  email varchar(254)\n'
    const next = DOC.replace('  id int [pk]\n}\n\nTable posts', '  id int [pk]\n' + inserted + '}\n\nTable posts')
    applyValue(view, next)
    expect(view.state.selection.main.head).toBe(head + inserted.length)
    expect(next.slice(view.state.selection.main.head)).toMatch(/^Table posts/)
  })

  it('clamps the caret to the new document length when the tail is deleted', () => {
    const view = makeView(DOC, DOC.length) // caret at EOF
    const next = 'Table users {\n  id int [pk]\n}\n'
    applyValue(view, next)
    expect(view.state.doc.toString()).toBe(next)
    expect(view.state.selection.main.head).toBe(next.length)
    expect(view.state.selection.main.head).toBeLessThanOrEqual(view.state.doc.length)
  })

  it('maps a non-empty selection range too', () => {
    const anchor = posOf(DOC, 'Table posts')
    const head = anchor + 'Table posts'.length
    const view = makeView(DOC, head, anchor)
    const next = '// header\n' + DOC
    applyValue(view, next)
    const sel = view.state.selection.main
    expect(next.slice(sel.from, sel.to)).toBe('Table posts')
  })

  it('preserves the scroll offsets and marks the transaction external / not undoable', () => {
    const view = makeView(DOC, 0)
    // jsdom has no layout so scrollTop is inert; stub the scroll properties to observe writes.
    let top = 120
    let left = 7
    Object.defineProperty(view.scrollDOM, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true })
    Object.defineProperty(view.scrollDOM, 'scrollLeft', { get: () => left, set: (v: number) => (left = v), configurable: true })
    let sawExternal = false
    let sawScrollIntoView = false
    const stop = EditorView.updateListener.of((u) => {
      for (const tr of u.transactions) {
        if (tr.annotation(externalChange)) sawExternal = true
        if (tr.scrollIntoView) sawScrollIntoView = true
      }
    })
    view.dispatch({ effects: [] })
    view.setState(EditorState.create({ doc: DOC, extensions: [stop] }))
    applyValue(view, DOC + 'Table extra {}\n')
    expect(top).toBe(120)
    expect(left).toBe(7)
    expect(sawExternal).toBe(true)
    expect(sawScrollIntoView).toBe(false)
  })

  it('is a no-op for identical text (no transaction, caret untouched)', () => {
    const view = makeView(DOC, 5)
    let transactions = 0
    view.setState(EditorState.create({ doc: DOC, selection: EditorSelection.single(5), extensions: [EditorView.updateListener.of(() => transactions++)] }))
    applyValue(view, DOC)
    expect(transactions).toBe(0)
    expect(view.state.selection.main.head).toBe(5)
  })
})

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodeMirrorEditor } from './CodeMirrorEditor'

const LONG = 'Table orders {\n  id integer [pk, note: "a very long line that runs well past any panel width"]\n}\n'

/**
 * Soft wrap is a preference the shell stores and hands down, so the thing worth pinning is that
 * the prop reaches CodeMirror and can be turned back off again — `cm-lineWrapping` is the class
 * EditorView.lineWrapping puts on the content element.
 */
describe('CodeMirrorEditor wrap', () => {
  it('scrolls long lines sideways by default', () => {
    const { container } = render(<CodeMirrorEditor value={LONG} />)
    expect(container.querySelector('.cm-lineWrapping')).toBeNull()
  })

  it('wraps when asked', () => {
    const { container } = render(<CodeMirrorEditor value={LONG} wrap />)
    expect(container.querySelector('.cm-lineWrapping')).not.toBeNull()
  })

  it('follows the preference both ways without remounting the editor', () => {
    const { container, rerender } = render(<CodeMirrorEditor value={LONG} />)
    const view = (container.firstChild as HTMLElement & { __cmView?: unknown }).__cmView

    rerender(<CodeMirrorEditor value={LONG} wrap />)
    expect(container.querySelector('.cm-lineWrapping')).not.toBeNull()

    rerender(<CodeMirrorEditor value={LONG} wrap={false} />)
    expect(container.querySelector('.cm-lineWrapping')).toBeNull()

    // Same view throughout: toggling the preference must not cost the document or the caret.
    expect((container.firstChild as HTMLElement & { __cmView?: unknown }).__cmView).toBe(view)
  })
})

import { describe, it, expect } from 'vitest'
import { MIN_CANVAS_WIDTH, MIN_PANE_WIDTH, clampPaneWidth, paneWidthCss, paneWidthFromPointer } from './paneSize'

describe('clampPaneWidth', () => {
  it('leaves a width that suits both panes alone', () => {
    expect(clampPaneWidth(460, 1440)).toBe(460)
  })

  it('holds both floors', () => {
    expect(clampPaneWidth(10, 1440)).toBe(MIN_PANE_WIDTH)
    expect(clampPaneWidth(5000, 1440)).toBe(1440 - MIN_CANVAS_WIDTH)
  })

  it('gives the panel its floor when the window is too small for both', () => {
    // 500px cannot hold 280 + 320. The panel's floor wins rather than the result going negative,
    // which is what the old `innerWidth - 320` produced.
    expect(clampPaneWidth(400, 500)).toBe(MIN_PANE_WIDTH)
    expect(clampPaneWidth(400, 100)).toBe(MIN_PANE_WIDTH)
  })

  it('returns whole pixels', () => {
    expect(clampPaneWidth(460.4, 1440)).toBe(460)
  })
})

describe('paneWidthFromPointer', () => {
  it('measures from the right edge, so the panel starts under the pointer', () => {
    expect(paneWidthFromPointer(1000, 1440)).toBe(440)
  })

  it('clamps at both ends of the drag', () => {
    expect(paneWidthFromPointer(1430, 1440)).toBe(MIN_PANE_WIDTH)
    expect(paneWidthFromPointer(0, 1440)).toBe(1440 - MIN_CANVAS_WIDTH)
  })
})

describe('paneWidthCss', () => {
  it('uses the stored width when the panel is not widened', () => {
    expect(paneWidthCss(460, false)).toBe('460px')
  })

  it('leaves the canvas its minimum when widened, as a percentage rather than a pixel count', () => {
    expect(paneWidthCss(460, true)).toBe(`calc(100% - ${MIN_CANVAS_WIDTH}px)`)
  })

  it('does not consume the stored width while widened, so restore returns to it', () => {
    const chosen = 620
    expect(paneWidthCss(chosen, true)).not.toContain(String(chosen))
    expect(paneWidthCss(chosen, false)).toBe('620px')
  })
})

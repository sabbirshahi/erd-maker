/**
 * Geometry for the resizable code panel.
 *
 * Kept out of the component and pure: the rules that decide a width — what a drag on the divider
 * means, what the panel may never be narrower than, what "widened" resolves to — are the part
 * worth testing, and none of them need a layout to answer.
 *
 * The two floors below are also written into shell.css (`.erd-rightpane`). They have to stay in
 * step: the CSS enforces them when the window is resized, this file when the user drags.
 */

/** Below this the code panel cannot hold a line of DBML next to its gutter. */
export const MIN_PANE_WIDTH = 280

/** What the canvas keeps whatever the panel does. A diagram off screen is not a diagram. */
export const MIN_CANVAS_WIDTH = 320

/** Keep `width` inside the two floors, with the panel's floor winning on a window too small for both. */
export function clampPaneWidth(width: number, viewport: number): number {
  const max = Math.max(MIN_PANE_WIDTH, viewport - MIN_CANVAS_WIDTH)
  return Math.min(Math.max(Math.round(width), MIN_PANE_WIDTH), max)
}

/** The width a drag implies: the panel starts where the pointer is. */
export function paneWidthFromPointer(clientX: number, viewport: number): number {
  return clampPaneWidth(viewport - clientX, viewport)
}

/**
 * The CSS width for the panel.
 *
 * Widened is a percentage rather than a pixel count on purpose: it goes on leaving the canvas its
 * minimum as the window is resized, with no listener to keep in step. `width` itself is left
 * alone while widened, which is what lets restore come back to the width the user chose rather
 * than to the default.
 */
export function paneWidthCss(width: number, maximized: boolean): string {
  return maximized ? `calc(100% - ${MIN_CANVAS_WIDTH}px)` : `${Math.round(width)}px`
}

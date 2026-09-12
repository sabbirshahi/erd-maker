/**
 * What `?embed=1` renders: the diagram and nothing else.
 *
 * No top bar, no code panes, no problems panel, and no editing. The only chrome is a small link
 * back to DBridge, so a reader can find out what they are looking at.
 */
import './shell.css'
import { Suspense } from 'react'
import { Canvas } from './panes'
import { ErrorBoundary } from './ui'

export function EmbedView() {
  return (
    <div className="erd-embed" data-testid="embed-view">
      <ErrorBoundary name="Canvas">
        <Suspense fallback={<div className="erd-placeholder p-6">Loading…</div>}>
          <Canvas readOnly />
        </Suspense>
      </ErrorBoundary>
      <a className="erd-embed__mark" href="https://dbridge.vercel.app" target="_blank" rel="noreferrer">
        Made with DBridge
      </a>
    </div>
  )
}

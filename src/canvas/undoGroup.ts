/**
 * Undo grouping on top of zundo. zundo records history *after* each `set`, so the
 * pattern is: let the first write be recorded, then pause tracking for the follow-ups.
 *
 * - `untracked(fn)`: run writes that must not create undo steps (auto-placement).
 * - Edit sessions: while a text input is focused, only its first keystroke becomes an
 *   undo step; `endEditSession` (on blur/unmount) resumes tracking.
 */
import type { Schema } from '@/core/schema'
import { useSchemaStore } from '@/store'

const temporal = () => useSchemaStore.temporal.getState()

export function untracked(fn: () => void): void {
  const t = temporal()
  const wasTracking = t.isTracking
  if (wasTracking) t.pause()
  try {
    fn()
  } finally {
    if (wasTracking) temporal().resume()
  }
}

let session: { paused: boolean } | null = null

export function beginEditSession(): void {
  if (session?.paused) temporal().resume()
  session = { paused: false }
}

export function endEditSession(): void {
  if (session?.paused) temporal().resume()
  session = null
}

export const hasEditSession = (): boolean => session !== null

/** Schema update from the inspector; coalesces into one undo step while a session is open. */
export function sessionUpdate(mutate: (draft: Schema) => void): void {
  useSchemaStore.getState().update('canvas', mutate)
  if (session && !session.paused) {
    temporal().pause()
    session.paused = true
  }
}

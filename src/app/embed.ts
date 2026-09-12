/**
 * Embed mode: `?embed=1` renders the canvas alone, read-only, and writes nothing.
 *
 * The rule that matters is the storage one. An embedded diagram sits on someone else's page, in
 * front of a visitor who never chose to use this app. Writing to their localStorage would create a
 * project index in their browser and, worse, could collide with diagrams they actually have. So
 * embed mode is enforced at the persistence layer — projects.ts, saveController.ts, theme.ts and
 * the shell's UI preferences all consult this — rather than by hiding the buttons that would have
 * triggered a write. Hidden UI is a convention; a guard in the writer is a guarantee.
 */
export const EMBED_PARAM = 'embed'

/** Overridable for tests, which cannot change `location`. */
let override: boolean | null = null

export function setEmbedForTesting(value: boolean | null): void {
  override = value
}

export function isEmbed(search?: string): boolean {
  if (override !== null) return override
  const query = search ?? (typeof location === 'undefined' ? '' : location.search)
  try {
    const value = new URLSearchParams(query).get(EMBED_PARAM)
    return value !== null && value !== '0' && value !== 'false'
  } catch {
    return false
  }
}

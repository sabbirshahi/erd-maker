/**
 * Keeping relationship lines off the table cards.
 *
 * Orthogonal edges turn once, in a vertical channel half way between the two cards. When another
 * table happens to sit in that channel the line is drawn straight over it and becomes impossible to
 * follow, so this picks the nearest channel that is actually free and hands it to the path builder.
 *
 * Pure geometry: no store, no React, so it can be unit-tested on its own.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Clearance kept between a line and a card it passes. */
export const CHANNEL_PAD = 16

/** How far from the midpoint a detour may go before a straight line is the lesser evil. */
export const MAX_DETOUR = 260

/**
 * @returns an x for the edge's vertical segment, or undefined when the midpoint is already clear
 *          (in which case the caller should let the default routing stand).
 */
export function freeChannelX(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  obstacles: Rect[],
): number | undefined {
  const mid = (sourceX + targetX) / 2
  const top = Math.min(sourceY, targetY)
  const bottom = Math.max(sourceY, targetY)

  // Only cards the line actually passes vertically can be in the way.
  const inSpan = obstacles.filter((r) => r.y < bottom && r.y + r.height > top)
  if (inSpan.length === 0) return undefined

  const blocked = (x: number) => inSpan.some((r) => x > r.x - CHANNEL_PAD && x < r.x + r.width + CHANNEL_PAD)
  if (!blocked(mid)) return undefined

  // Slip past either side of every blocking card, closest detour first.
  const candidates = inSpan
    .flatMap((r) => [r.x - CHANNEL_PAD - 1, r.x + r.width + CHANNEL_PAD + 1])
    .filter((x) => Math.abs(x - mid) <= MAX_DETOUR)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))

  for (const x of candidates) {
    if (!blocked(x)) return x
  }
  // Everything nearby is occupied: a straight line beats a wild detour.
  return undefined
}

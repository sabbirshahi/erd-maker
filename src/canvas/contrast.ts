/**
 * Colour maths for the one value the app does not choose: a table's header tint.
 *
 * Every other colour comes from tokens.css, picked by hand for both themes. A table's tint is
 * different — it is stored in the document as a literal hex (DBML `[headercolor: #xxxxxx]`), the
 * Inspector's colour input accepts any hex at all, and the same value is used in both themes.
 *
 * The header does not paint that hex at full strength. It mixes a thin wash of it into the app's
 * own surface colour (`color-mix(in oklab, <tint> ${HEADER_TINT_PERCENT}%, var(--erd-node-bg))`,
 * see TableNode.tsx) and keeps the app's ordinary text colour on top. Because the wash stays close
 * to the surface, that ordinary text clears WCAG AA against it no matter what hex the tint is —
 * mixOklab and the sweep in contrast.test.ts prove that, rather than assume it.
 */

/** How much of a header's wash is the table's own hex; the rest is the theme's surface. */
export const HEADER_TINT_PERCENT = 16

/** `#rgb` or `#rrggbb` to channels 0–255. Anything else is null, and the caller skips the tint. */
export function parseHexColor(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const digits = match[1]
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return [r, g, b]
}

function channelToHex(c: number): string {
  return Math.round(Math.max(0, Math.min(255, c)))
    .toString(16)
    .padStart(2, '0')
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two relative luminances, 1:1 to 21:1. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** Contrast ratio between two `#rrggbb` colours. Exported so it can be asserted, not assumed. */
export function contrastBetween(hexA: string, hexB: string): number {
  const a = parseHexColor(hexA)
  const b = parseHexColor(hexB)
  if (!a || !b) return 1
  return contrastRatio(relativeLuminance(a), relativeLuminance(b))
}

// sRGB <-> OKLab, matching the CSS `color-mix(in oklab, …)` the header actually renders with.
// (Björn Ottosson's OKLab: https://bottosson.github.io/posts/oklab/)

function srgbChannelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function linearChannelToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c))
  const s = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  return s * 255
}

type Lab = [number, number, number]

function rgbToOklab([r, g, b]: [number, number, number]): Lab {
  const [lr, lg, lb] = [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)]
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ]
}

function oklabToRgb([L, A, B]: Lab): [number, number, number] {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3]
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  return [linearChannelToSrgb(r), linearChannelToSrgb(g), linearChannelToSrgb(b)]
}

/**
 * `color-mix(in oklab, tintHex <percent>%, baseHex)`, computed in TS so tests can sweep every
 * possible tint against both themes' surfaces without a browser. Keep this in step with how
 * TableNode.tsx builds the CSS string, or the two stop meaning the same thing.
 */
export function mixOklab(tintHex: string, baseHex: string, percent: number): string {
  const tint = parseHexColor(tintHex)
  const base = parseHexColor(baseHex)
  if (!tint || !base) return baseHex
  const p = percent / 100
  const tintLab = rgbToOklab(tint)
  const baseLab = rgbToOklab(base)
  const mixed = tintLab.map((c, i) => p * c + (1 - p) * baseLab[i]) as Lab
  const [r, g, b] = oklabToRgb(mixed)
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`
}

/**
 * Contrast maths for the one colour the app does not choose: a table's header tint.
 *
 * Every other colour comes from tokens.css, where the light and dark values are picked by hand. A
 * table's tint is different — it is stored in the document as a literal hex (DBML
 * `[headercolor: #xxxxxx]`), the Inspector's colour input accepts any hex at all, and the same
 * value is used in both themes. So the ink that sits on it has to be derived at render time.
 *
 * Pure white and pure black are used on purpose: they are the only pair that clears WCAG AA
 * (4.5:1) against *every* possible tint. The worst case is where the two are equal, at a relative
 * luminance of √(1.05 × 0.05) − 0.05 ≈ 0.179, and there both reach 4.58:1. Softening the black to
 * the app's near-black --erd-text would open a band of mid-tones where neither side reaches 4.5:1.
 */

/** Ink for a tinted surface: `light` is white text, `dark` is black text. */
export type Ink = 'light' | 'dark'

/** Relative luminance of the two inks, so the choice is a comparison and not a magic threshold. */
const INK_LUMINANCE: Record<Ink, number> = { light: 1, dark: 0 }

/** `#rgb` or `#rrggbb` to channels 0–255. Anything else is null, and the caller skips the tint. */
export function parseHexColor(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const digits = match[1]
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return [r, g, b]
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

/** Whichever ink reads better on `hex`, or null when `hex` is not a colour we can measure. */
export function inkFor(hex: string): Ink | null {
  const rgb = parseHexColor(hex)
  if (!rgb) return null
  const tint = relativeLuminance(rgb)
  return contrastRatio(tint, INK_LUMINANCE.light) >= contrastRatio(tint, INK_LUMINANCE.dark)
    ? 'light'
    : 'dark'
}

/** Contrast of an ink against a tint. Exported so the 4.5:1 rule can be asserted, not assumed. */
export function inkContrast(hex: string, ink: Ink): number {
  const rgb = parseHexColor(hex)
  if (!rgb) return 1
  return contrastRatio(relativeLuminance(rgb), INK_LUMINANCE[ink])
}

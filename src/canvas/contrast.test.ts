import { describe, it, expect } from 'vitest'
import { HEADER_TINT_PERCENT, contrastBetween, contrastRatio, mixOklab, parseHexColor, relativeLuminance } from './contrast'
import { TABLE_COLORS } from './palette'

/**
 * The header tint is the only colour in the app that is not chosen by a designer: it comes from the
 * document, the user can type any hex into the Inspector's colour input, and the same value has to
 * work in both themes. These tests hold the line that the header text always clears WCAG AA against
 * the wash that hex produces — using the exact color-mix TableNode.tsx renders, not a stand-in.
 */

/** Mirrors tokens.css: the two themes' surface and ordinary text, which is what a tinted header
 *  actually mixes and sits its text on (see TableNode.tsx and canvas.css's `--tinted` rules). */
const THEMES = [
  { name: 'light', surface: '#ffffff', text: '#18181b' },
  { name: 'dark', surface: '#18181b', text: '#fafafa' },
] as const

/** The dark-theme twins of the palette, which a user in dark mode can pick with the colour input. */
const DARK_TWINS = ['#818cf8', '#2dd4bf', '#34d399', '#fbbf24', '#c084fc', '#94a3b8']

const AA = 4.5

describe('parseHexColor', () => {
  it('reads six-digit hex', () => {
    expect(parseHexColor('#6366f1')).toEqual([0x63, 0x66, 0xf1])
  })

  it('expands three-digit hex', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255])
    expect(parseHexColor('#048')).toEqual([0x00, 0x44, 0x88])
  })

  it('accepts uppercase and surrounding space', () => {
    expect(parseHexColor('  #A855F7 ')).toEqual([0xa8, 0x55, 0xf7])
  })

  it('rejects anything it cannot measure', () => {
    // An imported document can carry any string here, and alpha would change the maths.
    for (const bad of ['', 'rebeccapurple', '6366f1', '#12', '#12345', '#6366f1ff', '#gggggg']) {
      expect(parseHexColor(bad), bad).toBeNull()
    }
  })
})

describe('relativeLuminance', () => {
  it('spans black to white', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10)
  })

  it('uses the linear ramp below the sRGB knee', () => {
    // #0a is under 0.04045 once normalised, so it divides by 12.92 instead of taking the power.
    expect(relativeLuminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 10)
  })

  it('weights green above red above blue', () => {
    const [r, g, b] = ([[255, 0, 0], [0, 255, 0], [0, 0, 255]] as const).map((c) =>
      relativeLuminance([...c] as [number, number, number]),
    )
    expect(g).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
  })
})

describe('contrastRatio', () => {
  it('is 21:1 between black and white, either way round', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 10)
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 10)
  })

  it('is 1:1 against itself', () => {
    expect(contrastRatio(0.3, 0.3)).toBe(1)
  })
})

describe('mixOklab', () => {
  it('returns the base colour untouched at 0%', () => {
    expect(mixOklab('#6366f1', '#ffffff', 0)).toBe('#ffffff')
  })

  it('returns the tint untouched at 100%', () => {
    expect(mixOklab('#6366f1', '#ffffff', 100)).toBe('#6366f1')
  })

  it('falls back to the base colour for an unmeasurable tint', () => {
    expect(mixOklab('cornflowerblue', '#ffffff', 16)).toBe('#ffffff')
  })

  it('moves a light surface only a little at header strength', () => {
    // A sixteen-percent wash should read as "barely tinted", not "recoloured".
    const mixed = mixOklab('#000000', '#ffffff', HEADER_TINT_PERCENT)
    const rgb = parseHexColor(mixed)!
    expect(relativeLuminance(rgb)).toBeGreaterThan(0.55)
  })
})

describe('header tint contrast', () => {
  it('clears AA for every palette colour, in both themes', () => {
    for (const theme of THEMES) {
      for (const c of TABLE_COLORS) {
        const bg = mixOklab(c.hex, theme.surface, HEADER_TINT_PERCENT)
        expect(contrastBetween(bg, theme.text), `${theme.name} ${c.label} ${c.hex}`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  it('clears AA for the dark-theme twins of the palette, in dark mode', () => {
    const dark = THEMES[1]
    for (const hex of DARK_TWINS) {
      const bg = mixOklab(hex, dark.surface, HEADER_TINT_PERCENT)
      expect(contrastBetween(bg, dark.text), hex).toBeGreaterThanOrEqual(AA)
    }
  })

  it('clears AA for pure white, pure black and a saturated mid-tone, in both themes', () => {
    for (const theme of THEMES) {
      for (const hex of ['#ffffff', '#000000', '#06b6d4']) {
        const bg = mixOklab(hex, theme.surface, HEADER_TINT_PERCENT)
        expect(contrastBetween(bg, theme.text), `${theme.name} ${hex}`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  it('clears AA across the whole grey ramp, in both themes', () => {
    for (const theme of THEMES) {
      for (let v = 0; v <= 255; v++) {
        const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`
        const bg = mixOklab(hex, theme.surface, HEADER_TINT_PERCENT)
        expect(contrastBetween(bg, theme.text), `${theme.name} ${hex}`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  it('clears AA for any hex the colour input can produce, in both themes', () => {
    // A 16-step sweep of the whole cube: 4096 tints, the worst of which must still reach 4.5:1.
    for (const theme of THEMES) {
      let worst = { hex: '', ratio: Infinity }
      for (let r = 0; r < 256; r += 17) {
        for (let g = 0; g < 256; g += 17) {
          for (let b = 0; b < 256; b += 17) {
            const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
            const bg = mixOklab(hex, theme.surface, HEADER_TINT_PERCENT)
            const ratio = contrastBetween(bg, theme.text)
            if (ratio < worst.ratio) worst = { hex, ratio }
          }
        }
      }
      expect(worst.ratio, `${theme.name} ${worst.hex}`).toBeGreaterThanOrEqual(AA)
    }
  })
})

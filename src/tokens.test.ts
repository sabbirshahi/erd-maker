import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const SRC = join(process.cwd(), 'src') + sep

/**
 * tokens.css is meant to be the only place a colour is chosen. Nothing enforced that, so the
 * secondary panels quietly kept picking colours from Tailwind's palette and had to be re-checked
 * by hand in dark mode. These two checks make the rule hold on its own.
 */

/** palette.ts is the one deliberate exception: headercolor round-trips through DBML as a literal. */
const HEX_ALLOWED = new Set(['tokens.css', 'canvas/palette.ts', 'tokens.test.ts'])

const PALETTE = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose', 'white', 'black',
].join('|')
const UTILITY = new RegExp(
  `\\b(?:dark:|hover:|focus:|active:|odd:|even:|group-hover:)*` +
    `(?:bg|text|border|ring|outline|divide|placeholder|from|via|to|fill|stroke|accent|shadow|decoration)` +
    `-(?:${PALETTE})\\b`,
)
const HEX = /#[0-9a-fA-F]{3,8}\b/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const files = walk(SRC).map((full) => ({ rel: full.slice(SRC.length).split(sep).join('/'), text: readFileSync(full, 'utf8') }))

describe('design tokens', () => {
  it('is the only place a colour is written down', () => {
    const offenders = files.filter((f) => !HEX_ALLOWED.has(f.rel) && HEX.test(f.text)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('leaves no component taking colour from Tailwind instead', () => {
    const offenders = files.filter((f) => UTILITY.test(f.text)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('defines every token in both themes', () => {
    const css = files.find((f) => f.rel === 'tokens.css')!.text
    const [, light = '', dark = ''] = css.split(/:root(?:\.dark)?\s*\{/)
    const names = (block: string) => new Set(block.match(/--erd-[a-z0-9-]+(?=\s*:)/g) ?? [])
    // The dark block only overrides what differs, so it must not introduce a token light lacks.
    const onlyDark = [...names(dark)].filter((n) => !names(light).has(n))
    expect(onlyDark).toEqual([])
  })
})

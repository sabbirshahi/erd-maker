import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SHORTCUTS, isMac, renderKey } from './shortcuts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('shortcuts', () => {
  it('renders modifiers for the platform', () => {
    expect(renderKey('mod', true)).toBe('⌘')
    expect(renderKey('mod', false)).toBe('Ctrl')
    expect(renderKey('F2', false)).toBe('F2')
    expect(isMac('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true)
    expect(isMac('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })

  it('lists no duplicate binding twice in one group', () => {
    for (const group of SHORTCUTS) {
      const seen = group.items.map((s) => `${s.keys.join('+')}|${s.description}`)
      expect(new Set(seen).size).toBe(seen.length)
    }
  })

  /**
   * A shortcut list that has drifted from the code is worse than none, so the keys claimed here
   * are checked against the handlers that implement them.
   */
  it('matches the handlers that actually implement the keys', () => {
    const canvas = read('../canvas/useShortcuts.ts')
    const shell = read('./Shell.tsx')

    expect(canvas).toContain("e.key === 'F2'")
    expect(canvas).toContain("e.key === 'Escape'")
    expect(canvas).toContain("e.key === 'Delete'")
    // Ctrl/Cmd + c / x / v / d / a
    expect(canvas).toMatch(/key === 'c' \|\| key === 'x' \|\| key === 'v' \|\| key === 'd' \|\| key === 'a'/)
    expect(canvas).toMatch(/mod && e\.shiftKey && \(e\.code === 'KeyT'/)

    expect(shell).toMatch(/e\.key\.toLowerCase\(\) === 's'/)
    expect(shell).toMatch(/e\.key\.toLowerCase\(\) === 'z'/)
    expect(shell).toMatch(/e\.key\.toLowerCase\(\) === 'y'/)
    expect(shell).toContain("e.key === '?'")

    const listed = SHORTCUTS.flatMap((g) => g.items.map((s) => s.keys.join('+')))
    for (const expected of ['mod+Shift+T', 'mod+A', 'Delete', 'F2', 'Escape', 'mod+C', 'mod+X', 'mod+V', 'mod+D', 'mod+Z', 'mod+Shift+Z', 'mod+Y', 'mod+S', '?']) {
      expect(listed).toContain(expected)
    }
  })
})

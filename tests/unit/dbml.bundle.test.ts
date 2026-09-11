/**
 * Guards the chunk graph: the DBML editing path (`src/core/dbml`) must never statically import
 * @dbml/core (15 MB of ANTLR SQL grammars). Only `src/core/sql` may reference it, and only through a
 * dynamic `import()` so Vite emits it as a separate, lazily loaded chunk.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..', 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

const STATIC_IMPORT = /^\s*(?:import|export)\s[^;]*?\sfrom\s+['"]@dbml\/core['"]/m
const DYNAMIC_IMPORT = /\bimport\(\s*['"]@dbml\/core['"]\s*\)/
const TYPE_ONLY = /^\s*(?:import\s+type\b[^;]*?\sfrom\s+['"]@dbml\/core['"]|type\s+\w+\s*=\s*typeof\s+import\(\s*['"]@dbml\/core['"]\s*\))/m
const rel = (p: string) => p.slice(SRC.length + 1)
/** Source with comments removed, so prose that mentions a package does not count as a reference. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('bundle boundaries for @dbml/core', () => {
  const files = walk(SRC)

  it('src/core/dbml never references @dbml/core and parses with @dbml/parse', () => {
    const dbml = files.filter((f) => rel(f).startsWith('core/dbml/'))
    expect(dbml.length).toBeGreaterThan(0)
    for (const f of dbml) expect(code(f), rel(f)).not.toMatch(/@dbml\/core/)
    expect(readFileSync(join(SRC, 'core/dbml/parse.ts'), 'utf8')).toMatch(/from '@dbml\/parse'/)
  })

  it('nothing in src statically imports @dbml/core; src/core/sql loads it with a dynamic import()', () => {
    const offenders = files.filter((f) => STATIC_IMPORT.test(code(f)))
    expect(offenders.map(rel)).toEqual([])
    const sqlIndex = readFileSync(join(SRC, 'core/sql/index.ts'), 'utf8')
    expect(sqlIndex).toMatch(DYNAMIC_IMPORT)
    const others = files.filter((f) => !rel(f).startsWith('core/sql/') && /@dbml\/core/.test(code(f)))
    // Type-only references elsewhere are fine; runtime references are not.
    for (const f of others) {
      const runtime = code(f).split('\n').filter((l) => /@dbml\/core/.test(l) && !TYPE_ONLY.test(l))
      expect(runtime, rel(f)).toEqual([])
    }
  })
})

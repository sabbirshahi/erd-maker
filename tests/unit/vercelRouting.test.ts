import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Guards the SPA catch-all in vercel.json against swallowing the share API.
 *
 * Vercel already protects this on its own: "precedence is given to the filesystem prior to rewrites
 * being applied" (vercel.com/docs/project-configuration/vercel-json), and a Vercel Function in
 * `api/` is part of that filesystem. The exclusion in `source` is belt and braces — it states the
 * intent in the config, and it keeps the rule if anyone ever converts these `rewrites` into the
 * lower-level `routes`, which do bypass the filesystem.
 *
 * This models how Vercel compiles `source`; it cannot stand in for a deployment. The claim it
 * defends is narrow and worth having: the pattern excludes /api and still catches every app route.
 */
const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../vercel.json'), 'utf8'),
) as { rewrites: Array<{ source: string; destination: string }> }

describe('vercel SPA rewrite', () => {
  const spa = config.rewrites.find((r) => r.destination === '/index.html')

  it('is still the single catch-all', () => {
    expect(spa).toBeDefined()
    expect(config.rewrites).toHaveLength(1)
  })

  it('does not capture the share API, but does capture every app route', () => {
    const match = (path: string) => new RegExp(`^${spa!.source}$`).test(path)

    // Must reach the function, not index.html.
    expect(match('/api/share')).toBe(false)
    expect(match('/api/share?id=abc')).toBe(false)
    expect(match('/api/anything/else')).toBe(false)

    // Must reach the app.
    expect(match('/')).toBe(true)
    expect(match('/s/AAAAAAAAAAAAAAAAAAAAAA')).toBe(true)
    expect(match('/assets/index-abc123.js')).toBe(true)
    // "api" only matters as a path segment at the root.
    expect(match('/apis')).toBe(true)
    expect(match('/s/api/x')).toBe(true)
  })
})

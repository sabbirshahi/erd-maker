import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { analyticsEnabled, eventPayload, initAnalytics, track } from './analytics'

const SCRIPT = '#dbridge-analytics'

describe('analytics', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    delete window.plausible
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does nothing at all without a configured domain', () => {
    expect(analyticsEnabled()).toBe(false)
    initAnalytics()
    expect(document.querySelector(SCRIPT)).toBeNull()

    const spy = vi.fn()
    window.plausible = spy as never
    track({ name: 'demo-started' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('adds the script once when a domain is configured', () => {
    vi.stubEnv('VITE_ANALYTICS_DOMAIN', 'dbridge.example')
    expect(analyticsEnabled()).toBe(true)
    initAnalytics()
    initAnalytics()
    const tags = document.querySelectorAll(SCRIPT)
    expect(tags).toHaveLength(1)
    expect(tags[0].getAttribute('data-domain')).toBe('dbridge.example')
    expect(tags[0].getAttribute('src')).toContain('plausible.io')
  })

  it('sends the event name with only its enum and count properties', () => {
    vi.stubEnv('VITE_ANALYTICS_DOMAIN', 'dbridge.example')
    const spy = vi.fn()
    window.plausible = spy as never

    track({ name: 'export', format: 'postgres' })
    expect(spy).toHaveBeenCalledWith('export', { props: { format: 'postgres' } })

    track({ name: 'share-created', tables: 7 })
    expect(spy).toHaveBeenCalledWith('share-created', { props: { tables: 7 } })

    track({ name: 'demo-started' })
    expect(spy).toHaveBeenCalledWith('demo-started', undefined)
  })

  it('carries no free-form content: every property is an enum or a number', () => {
    for (const event of [
      { name: 'import', kind: 'sql' },
      { name: 'export', format: 'django' },
      { name: 'share-created', tables: 3 },
      { name: 'example-opened', example: 'blog' },
      { name: 'demo-started' },
    ] as const) {
      const [, props] = eventPayload(event)
      for (const value of Object.values(props)) {
        expect(typeof value === 'number' || (typeof value === 'string' && value.length <= 32)).toBe(true)
      }
    }
  })

  it('never lets a failing tracker break the caller', () => {
    vi.stubEnv('VITE_ANALYTICS_DOMAIN', 'dbridge.example')
    window.plausible = (() => {
      throw new Error('blocked by an ad blocker')
    }) as never
    expect(() => track({ name: 'demo-started' })).not.toThrow()
  })
})

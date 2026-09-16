import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SHORT_MAX_PAYLOAD_BYTES,
  buildShortUrl,
  fetchPayload,
  shortIdFromPath,
  storePayload,
} from './shortLink'

const ID = 'AbCdEfGhIjKlMnOpQrStUv'

/** A fetch that answers once with the given status and body. */
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('short link ids', () => {
  it('reads an id out of the path and rejects anything else', () => {
    expect(shortIdFromPath(`/s/${ID}`)).toBe(ID)
    expect(shortIdFromPath(`/s/${ID}/`)).toBe(ID)
    expect(shortIdFromPath('/')).toBeNull()
    expect(shortIdFromPath('/s/')).toBeNull()
    expect(shortIdFromPath('/s/too-short')).toBeNull()
    expect(shortIdFromPath(`/s/${ID}extra`)).toBeNull()
    // A traversal attempt is simply not an id.
    expect(shortIdFromPath('/s/../../etc/passwd')).toBeNull()
    expect(shortIdFromPath(`/other/${ID}`)).toBeNull()
  })

  it('builds a short URL that drops the query and hash of the page it came from', () => {
    expect(buildShortUrl(ID, 'https://dbridge-app.vercel.app/?p=abc#d=payload')).toBe(
      `https://dbridge-app.vercel.app/s/${ID}`,
    )
  })
})

describe('storePayload', () => {
  it('returns the id the API minted', async () => {
    const fn = stubFetch(201, { id: ID, expiresInDays: 7 })
    await expect(storePayload('AAAA')).resolves.toEqual({ ok: true, id: ID })
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe('/api/share')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('AAAA')
  })

  it('refuses an oversized payload without making a request at all', async () => {
    const fn = stubFetch(201, { id: ID })
    const huge = 'A'.repeat(SHORT_MAX_PAYLOAD_BYTES + 1)
    await expect(storePayload(huge)).resolves.toEqual({ ok: false, reason: 'too-large' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('reports the server-side size rejection', async () => {
    stubFetch(413, { error: 'payload-too-large' })
    await expect(storePayload('AAAA')).resolves.toEqual({ ok: false, reason: 'too-large' })
  })

  it('treats a missing store as unavailable rather than an error', async () => {
    stubFetch(503, { error: 'storage-not-configured' })
    await expect(storePayload('AAAA')).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('treats a dead network as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(storePayload('AAAA')).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('rejects a 200 that is not actually the API', async () => {
    // What `vite dev` or a misrouted host hands back: the SPA shell, with a cheerful status.
    stubFetch(200, {})
    await expect(storePayload('AAAA')).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('fetchPayload', () => {
  it('returns the stored payload', async () => {
    const fn = stubFetch(200, { p: 'PAYLOAD' })
    await expect(fetchPayload(ID)).resolves.toEqual({ ok: true, payload: 'PAYLOAD' })
    expect(fn.mock.calls[0][0]).toBe(`/api/share?id=${ID}`)
  })

  it('reports an expired or unknown id as missing', async () => {
    stubFetch(404, { error: 'not-found' })
    await expect(fetchPayload(ID)).resolves.toEqual({ ok: false, reason: 'missing' })
  })

  it('does not call the API for a malformed id', async () => {
    const fn = stubFetch(200, { p: 'PAYLOAD' })
    await expect(fetchPayload('nope')).resolves.toEqual({ ok: false, reason: 'missing' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('separates an unreachable store from a missing diagram', async () => {
    stubFetch(502, { error: 'storage-unavailable' })
    await expect(fetchPayload(ID)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })
})

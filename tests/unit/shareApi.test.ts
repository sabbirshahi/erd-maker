import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

/**
 * The share endpoint is the only code in this project that accepts writes from strangers, so the
 * rules that keep it cheap and quiet are worth pinning: a size cap, a per-address write budget, an
 * id nobody can guess, and no payload in any response.
 *
 * Redis is replaced with a recording fake — these assert the handler's own logic, not Upstash's.
 */
const ENV = { KV_REST_API_URL: 'https://redis.test', KV_REST_API_TOKEN: 'token' }

let commands: (string | number)[][]
let store: Map<string, string>

async function handler() {
  // Imported after the env is in place: the module reads process.env when it handles a request.
  return (await import('../../api/share.ts')).default
}

beforeEach(() => {
  commands = []
  store = new Map()
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const args = JSON.parse(String(init.body)) as (string | number)[]
    commands.push(args)
    const [op, key] = [String(args[0]), String(args[1])]
    if (op === 'SET') { store.set(key, String(args[2])); return Response.json({ result: 'OK' }) }
    if (op === 'GET') return Response.json({ result: store.get(key) ?? null })
    if (op === 'INCR') { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return Response.json({ result: n }) }
    if (op === 'EXPIRE') return Response.json({ result: 1 })
    return Response.json({ result: null })
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const post = (body: string, ip = '1.2.3.4') =>
  new Request('https://x/api/share', { method: 'POST', body, headers: { 'x-forwarded-for': ip } })

describe('share endpoint', () => {
  it('stores a payload under an unguessable id and lets it be read back', async () => {
    const h = await handler()
    const created = await h.fetch(post('ABC123'))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)

    const read = await h.fetch(new Request(`https://x/api/share?id=${id}`))
    expect(read.status).toBe(200)
    expect((await read.json()) as { p: string }).toEqual({ p: 'ABC123' })
  })

  it('lets the store expire the data rather than relying on a cleanup job', async () => {
    const h = await handler()
    await h.fetch(post('ABC123'))
    const set = commands.find((c) => c[0] === 'SET')!
    expect(set).toContain('EX')
    expect(set[set.indexOf('EX') + 1]).toBe(7 * 24 * 60 * 60)
  })

  it('refuses a payload over the cap without writing anything', async () => {
    const h = await handler()
    const res = await h.fetch(post('A'.repeat(128 * 1024 + 1)))
    expect(res.status).toBe(413)
    expect(commands.filter((c) => c[0] === 'SET')).toHaveLength(0)
  })

  it('spends no Redis command on a malformed payload', async () => {
    const h = await handler()
    expect((await h.fetch(post('not a share payload!'))).status).toBe(400)
    expect(commands).toHaveLength(0)
  })

  it('caps how many links one address can create', async () => {
    const h = await handler()
    for (let i = 0; i < 20; i++) expect((await h.fetch(post('ABC123'))).status).toBe(201)
    const blocked = await h.fetch(post('ABC123'))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('600')
  })

  it('budgets each address separately', async () => {
    const h = await handler()
    for (let i = 0; i < 21; i++) await h.fetch(post('ABC123', '1.1.1.1'))
    expect((await h.fetch(post('ABC123', '2.2.2.2'))).status).toBe(201)
  })

  it('answers a guessed or malformed id with a plain 404', async () => {
    const h = await handler()
    expect((await h.fetch(new Request('https://x/api/share?id=short'))).status).toBe(404)
    expect((await h.fetch(new Request('https://x/api/share?id=aaaaaaaaaaaaaaaaaaaaaa'))).status).toBe(404)
  })

  it('tells the client there is no storage instead of pretending to work', async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    const h = (await import('../../api/share.ts')).default
    expect((await h.fetch(post('ABC123'))).status).toBe(503)
  })
})

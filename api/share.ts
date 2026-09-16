/**
 * Short-link storage for share URLs.
 *
 * `POST /api/share` takes a compressed share payload and returns an unguessable id.
 * `GET  /api/share?id=…` returns the payload, or 404 once it is gone.
 *
 * This is the one part of DBridge that holds user content outside the browser, so the rules it
 * follows are deliberately narrow:
 *
 *  - **The store expires the data, not us.** The value is written with Redis `EX`, so the 7-day
 *    lifetime is enforced by the database itself. There is no cleanup job to forget to run and no
 *    window where an expired diagram is still readable.
 *  - **Nothing here logs a payload.** Failures return an opaque code. A stack trace containing
 *    somebody's schema is exactly the leak this endpoint must not have.
 *  - **Ids are capabilities.** 128 bits from a CSPRNG, so the id cannot be walked or guessed, and
 *    knowing it is the only way to read the diagram.
 *
 * Runs as a Vercel Function: a non-framework project exposes `api/<name>.ts` with a default export
 * whose `fetch` takes a Web `Request` (see vercel.com/docs/functions/quickstart, "framework=other").
 */

/** Kept in step with SHARE_TTL_DAYS in src/app/shortLink.ts — a network apart, so both state it. */
const TTL_SECONDS = 7 * 24 * 60 * 60

/** Kept in step with SHORT_MAX_PAYLOAD_BYTES in src/app/shortLink.ts. */
const MAX_PAYLOAD_BYTES = 128 * 1024

/**
 * Per-IP write budget.
 *
 * This endpoint takes writes from anyone, with no account and no key, and the repository is public
 * — so the URL is not a secret. Without a ceiling a single script can drain the Redis free tier in
 * minutes or park megabytes of arbitrary text in someone else's store. Twenty links in ten minutes
 * is far more than a person sharing diagrams will ever need and useless as free storage.
 *
 * Reads are not limited: they are capped by the 22-character id being unguessable, and the GET is
 * edge-cached, so a popular link does not reach Redis at all.
 */
const RATE_LIMIT_WRITES = 20
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60
const RATE_PREFIX = 'rl:'

/** 16 bytes → 128 bits of entropy → 22 base64url characters. */
const ID_BYTES = 16
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
const KEY_PREFIX = 'share:'

/**
 * The payload is lz-string's URI-safe output, whose alphabet this is. Rejecting anything else will
 * not stop a determined abuser (the alphabet is wide enough to smuggle base64 through), but it does
 * keep the endpoint from accepting arbitrary bytes, which is the cheap half of the problem.
 */
const PAYLOAD_PATTERN = /^[A-Za-z0-9+\-$]+$/

interface Store {
  url: string
  token: string
}

/**
 * Credentials come from the Marketplace Redis integration. Vercel's own integration injects the
 * `KV_*` pair; Upstash's native naming is the `UPSTASH_*` pair. Accepting both means the function
 * works whichever way the store was attached.
 */
function store(): Store | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : null
}

/** One Redis command over the REST API. Arguments travel in the body, never in the URL path. */
async function command(s: Store, args: (string | number)[]): Promise<unknown> {
  const res = await fetch(s.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`redis responded ${res.status}`)
  const body = (await res.json()) as { result?: unknown; error?: string }
  if (body.error) throw new Error('redis rejected the command')
  return body.result ?? null
}

function newId(): string {
  const bytes = new Uint8Array(ID_BYTES)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Vercel always sets `x-forwarded-for`, and its leftmost entry is the client as the platform saw
 * it. If some other host ever serves this without the header, every caller shares one bucket —
 * which fails closed, throttling everyone rather than nobody.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/** True once the caller is over budget. One extra round trip per write, none per read. */
async function overWriteBudget(s: Store, ip: string): Promise<boolean> {
  const key = RATE_PREFIX + ip
  const hits = await command(s, ['INCR', key])
  // Only the first write in a window sets the expiry, so the window slides forward from that write
  // rather than being pushed out by every subsequent one.
  if (hits === 1) await command(s, ['EXPIRE', key, RATE_LIMIT_WINDOW_SECONDS])
  return typeof hits === 'number' && hits > RATE_LIMIT_WRITES
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

async function put(s: Store, request: Request): Promise<Response> {
  const payload = await request.text()
  if (payload.length === 0) return json({ error: 'empty-payload' }, 400)
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES)
    return json({ error: 'payload-too-large', maxBytes: MAX_PAYLOAD_BYTES }, 413)
  if (!PAYLOAD_PATTERN.test(payload)) return json({ error: 'payload-not-a-share' }, 400)

  // Counted after the free checks above, so a flood of malformed requests costs no Redis command
  // and cannot burn a legitimate caller's budget from the same address.
  if (await overWriteBudget(s, clientIp(request)))
    return json({ error: 'rate-limited' }, 429, { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) })

  const id = newId()
  await command(s, ['SET', KEY_PREFIX + id, payload, 'EX', TTL_SECONDS])
  return json({ id, expiresInDays: TTL_SECONDS / 86400 }, 201)
}

async function get(s: Store, request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  // A malformed id is a miss rather than a 400: it tells a prober nothing the 404 does not.
  if (!ID_PATTERN.test(id)) return json({ error: 'not-found' }, 404)

  const result = await command(s, ['GET', KEY_PREFIX + id])
  if (typeof result !== 'string') return json({ error: 'not-found' }, 404)
  // The id is the capability and the value never changes, so an edge cache keyed on it is safe
  // and keeps a popular link from hitting Redis on every open.
  return json({ p: result }, 200, { 'Cache-Control': 'public, max-age=300' })
}

export default {
  async fetch(request: Request): Promise<Response> {
    const s = store()
    // The client reads this as "no storage here" and falls back to a self-contained link.
    if (!s) return json({ error: 'storage-not-configured' }, 503)

    try {
      if (request.method === 'POST') return await put(s, request)
      if (request.method === 'GET') return await get(s, request)
      return json({ error: 'method-not-allowed' }, 405, { Allow: 'GET, POST' })
    } catch {
      // No detail, no payload, no console: see the header comment.
      return json({ error: 'storage-unavailable' }, 502)
    }
  },
}

/**
 * The client half of short share links: `dbridge-app.vercel.app/s/<id>`.
 *
 * Everything that talks to the network lives here rather than in share.ts, so the rule that matters
 * stays easy to check: this is the only module in the app that sends a diagram anywhere. Opening an
 * old `#d=…` link, editing, autosave, import and export never reach it.
 *
 * Both calls report *why* they failed, because the caller's response differs. "Unavailable" means
 * no store is attached (local dev, CI, a self-hosted build) or it could not be reached, and share.ts
 * answers by falling back to the long self-contained link — the Share button must not be dead on
 * localhost. "Missing" means the id is wrong or the 7 days ran out, which is a real dead end.
 */

/** Path prefix of a short link. Not a file, so the SPA rewrite serves the app for it. */
export const SHORT_PREFIX = '/s/'

/** 22 base64url characters — 128 bits, minted by the API. */
export const SHORT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

export const SHARE_API = '/api/share'

/** Kept in step with MAX_PAYLOAD_BYTES in api/share.ts. */
export const SHORT_MAX_PAYLOAD_BYTES = 128 * 1024

/** Kept in step with TTL_SECONDS in api/share.ts, and quoted to the user when they share. */
export const SHARE_TTL_DAYS = 7

/** A slow store must not hold the app's boot open. */
const TIMEOUT_MS = 8000

export type StoreResult =
  { ok: true; id: string } | { ok: false; reason: 'unavailable' | 'too-large' }

export type FetchResult =
  { ok: true; payload: string } | { ok: false; reason: 'unavailable' | 'missing' }

/** The id in `/s/<id>`, or null when this is an ordinary page load. */
export function shortIdFromPath(pathname: string = location.pathname): string | null {
  if (!pathname.startsWith(SHORT_PREFIX)) return null
  const id = pathname.slice(SHORT_PREFIX.length).replace(/\/$/, '')
  return SHORT_ID_PATTERN.test(id) ? id : null
}

export function buildShortUrl(id: string, base: string = location.href): string {
  const url = new URL(base)
  url.pathname = SHORT_PREFIX + id
  url.search = ''
  url.hash = ''
  return url.toString()
}

function signal(): AbortSignal | undefined {
  // Absent in older Safari; the request simply has no deadline there.
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined
}

/** Upload a compressed payload. Never throws — a dead network is an expected answer here. */
export async function storePayload(payload: string): Promise<StoreResult> {
  // Checked here as well as on the server so an oversized diagram costs no upload at all.
  if (new TextEncoder().encode(payload).length > SHORT_MAX_PAYLOAD_BYTES)
    return { ok: false, reason: 'too-large' }

  try {
    const res = await fetch(SHARE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
      signal: signal(),
    })
    if (res.status === 413) return { ok: false, reason: 'too-large' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    // `vite dev` has no functions, and a misconfigured host can answer with the SPA shell, so the
    // body is what decides success — not the status code.
    const body = (await res.json()) as { id?: unknown }
    if (typeof body.id !== 'string' || !SHORT_ID_PATTERN.test(body.id))
      return { ok: false, reason: 'unavailable' }
    return { ok: true, id: body.id }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Read a payload back. Never throws. */
export async function fetchPayload(id: string): Promise<FetchResult> {
  if (!SHORT_ID_PATTERN.test(id)) return { ok: false, reason: 'missing' }
  try {
    const res = await fetch(`${SHARE_API}?id=${encodeURIComponent(id)}`, { signal: signal() })
    if (res.status === 404) return { ok: false, reason: 'missing' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const body = (await res.json()) as { p?: unknown }
    if (typeof body.p !== 'string' || body.p === '') return { ok: false, reason: 'unavailable' }
    return { ok: true, payload: body.p }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

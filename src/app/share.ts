/**
 * Share links.
 *
 * There are two shapes, and which one you get depends on whether short-link storage is attached:
 *
 *  - **`/s/<id>`** — the normal one. The compressed document is uploaded, the store deletes it
 *    after SHARE_TTL_DAYS, and the link is a few dozen characters.
 *  - **`#d=<payload>`** — the whole document inside the URL. This is what the app did before short
 *    links existed, so every link ever handed out is still in this shape, and it is still what you
 *    get when no store is configured (local dev, CI, a self-hosted build). Decoding it never
 *    touches the network.
 *
 * The second is why the legacy path below is load-bearing rather than vestigial: it is both the
 * back-compatibility story and the offline fallback. `decodeShare` reads every format the app has
 * ever produced (see shareCodec.ts), and nothing in this file fetches anything to do it.
 *
 * A document read from either shape becomes a NEW project (session.ts, adoptShare) and is opened:
 * a link must never overwrite a diagram the recipient already has. Once read, the share is taken
 * out of the address bar, so a reload reopens the adopted diagram rather than adopting it twice.
 * A short link cannot be resolved synchronously, so main.tsx starts it after boot.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { useSchemaStore } from '@/store'
import { adoptShare } from './session'
import { packShare, unpackShare, type ShareDoc } from './shareCodec'
import {
  SHARE_TTL_DAYS,
  buildShortUrl,
  fetchPayload,
  shortIdFromPath,
  storePayload,
} from './shortLink'
import { copyText } from './CopyButton'
import { toast } from './toast'
import { track } from './analytics'

export const SHARE_PARAM = 'd'

export type { ShareDoc }

/** What shareCurrent produced. `reason` says why a short link was not possible. */
export type ShareOutcome = {
  kind: 'short' | 'inline'
  url: string
  chars: number
  copied: boolean
  reason?: 'unavailable' | 'too-large'
}

export function encodeShare(doc: ShareDoc): string {
  return compressToEncodedURIComponent(JSON.stringify(packShare(doc)))
}

export function decodeShare(encoded: string): ShareDoc | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    return unpackShare(JSON.parse(json))
  } catch {
    return null
  }
}

/** Extract the share payload from a hash like `#d=…` (also tolerates `#/?d=` and bare `#…`). */
export function shareFromHash(hash: string): string | null {
  if (!hash || hash === '#') return null
  const h = hash.replace(/^#\/?\??/, '')
  const params = new URLSearchParams(h)
  const d = params.get(SHARE_PARAM)
  if (d) return d
  return null
}

export function buildShareUrl(doc: ShareDoc, base: string = location.href): string {
  const url = new URL(base)
  url.hash = `${SHARE_PARAM}=${encodeShare(doc)}`
  return url.toString()
}

/** Drop the share part of the address bar so a reload reopens the saved project instead. */
function clearShareUrl(): void {
  try {
    const path = location.pathname.startsWith('/s/') ? '/' : location.pathname
    history.replaceState(null, '', path + location.search)
  } catch {
    /* ignore */
  }
}

/**
 * Load from the current URL hash if present. Returns true when a document was applied.
 *
 * Synchronous, and deliberately so: main.tsx runs this before React mounts and branches on the
 * result. It makes no network call — an old `#d=…` link opens with the browser offline.
 *
 * The document is adopted as a new project rather than loaded over the open one, so a link costs
 * the recipient nothing (see adoptShare). The hash is dropped as it is read, so a reload reopens
 * the adopted diagram instead of adopting it a second time.
 */
export function restoreFromHash(
  store: typeof useSchemaStore,
  hash: string = location.hash,
): boolean {
  const encoded = shareFromHash(hash)
  if (!encoded) return false
  const doc = decodeShare(encoded)
  if (!doc) {
    toast('Share link is invalid or corrupted', 'error')
    return false
  }
  adoptShare(doc, store)
  clearShareUrl()
  return true
}

/**
 * True when this page load is a `/s/<id>` link, answered from the URL alone and with no request.
 *
 * Boot cannot wait for the payload, so the tab opens its own diagram meanwhile and the arriving
 * document is adopted as a new project on top of that (restoreShortLink). Nothing is written to
 * the tab's own project in between, which is what makes a link that never arrives — expired,
 * offline — cost the user nothing.
 */
export function shortLinkPending(pathname: string = location.pathname): boolean {
  return shortIdFromPath(pathname) !== null
}

/** Fetch and apply a `/s/<id>` document. Returns true when one was applied. */
export async function restoreShortLink(
  store: typeof useSchemaStore,
  pathname: string = location.pathname,
): Promise<boolean> {
  const id = shortIdFromPath(pathname)
  if (!id) return false

  const result = await fetchPayload(id)
  if (!result.ok) {
    toast(
      result.reason === 'missing'
        ? 'This share link has expired or does not exist'
        : 'Could not reach share storage — check your connection and reload',
      'error',
    )
    return false
  }
  const doc = decodeShare(result.payload)
  if (!doc) {
    toast('Share link is invalid or corrupted', 'error')
    return false
  }
  adoptShare(doc, store)
  clearShareUrl()
  return true
}

/**
 * Copy a share link for the current document.
 *
 * The toast is not decoration here. Sharing is the only thing this app does that sends a diagram
 * off the machine, so it says which of the two happened at the moment it happens.
 */
export async function shareCurrent(
  store: typeof useSchemaStore,
  /** The diagram's name, so it opens under that name rather than as an untitled one. */
  name?: string,
): Promise<ShareOutcome> {
  const s = store.getState()
  const doc: ShareDoc = { schema: s.schema, layout: s.layout, name }
  const payload = encodeShare(doc)
  track({ name: 'share-created', tables: s.schema.tables.length })

  const stored = await storePayload(payload)
  if (stored.ok) {
    const url = buildShortUrl(stored.id)
    const copied = await copyText(url)
    if (copied)
      toast(`Share link copied — the diagram is uploaded and deleted after ${SHARE_TTL_DAYS} days`)
    else toast('Could not copy share link', 'error')
    return { kind: 'short', url, chars: url.length, copied }
  }

  const url = buildShareUrl(doc)
  const copied = await copyText(url)
  if (copied)
    toast(
      stored.reason === 'too-large'
        ? 'Share link copied — too large to upload, so the whole diagram is inside this long link'
        : 'Share link copied — nothing was uploaded, so the whole diagram is inside this long link',
    )
  else toast('Could not copy share link', 'error')
  return { kind: 'inline', url, chars: url.length, copied, reason: stored.reason }
}

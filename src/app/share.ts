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
 * On boot the hash wins over localStorage; after loading, it is removed so reloads use autosave.
 * A short link cannot be resolved synchronously, so main.tsx starts it after boot — see
 * shortLinkPending(), which answers from the URL alone.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { useSchemaStore } from '@/store'
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
  store.getState().load({ schema: doc.schema, layout: doc.layout })
  clearShareUrl()
  return true
}

/**
 * True when this page load is a `/s/<id>` link, answered from the URL alone.
 *
 * Boot needs this before the payload can possibly have arrived: it tells bootSession to treat the
 * load as a restore, so the incoming diagram is adopted into the active project the same way a
 * `#d=…` link is, instead of the tab opening the user's last diagram and then having it replaced.
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
  store.getState().load({ schema: doc.schema, layout: doc.layout })
  clearShareUrl()
  return true
}

/**
 * Copy a share link for the current document.
 *
 * The toast is not decoration here. Sharing is the only thing this app does that sends a diagram
 * off the machine, so it says which of the two happened at the moment it happens.
 */
export async function shareCurrent(store: typeof useSchemaStore): Promise<ShareOutcome> {
  const s = store.getState()
  const doc: ShareDoc = { schema: s.schema, layout: s.layout }
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

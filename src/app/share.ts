/**
 * Share links: `{schema, layout}` compressed with lz-string into `location.hash` as `#d=…`.
 * On boot the hash wins over localStorage; after loading, the hash is removed so reloads use autosave.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Layout, Schema } from '@/core/schema'
import type { useSchemaStore } from '@/store'
import { copyText } from './CopyButton'
import { toast } from './toast'
import { track } from './analytics'

export const SHARE_PARAM = 'd'
export const SHARE_WARN_BYTES = 30 * 1024

export interface ShareDoc {
  schema: Schema
  layout: Layout
}

export function encodeShare(doc: ShareDoc): string {
  return compressToEncodedURIComponent(JSON.stringify({ v: 1, schema: doc.schema, layout: doc.layout }))
}

export function decodeShare(encoded: string): ShareDoc | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    const d = JSON.parse(json) as Partial<ShareDoc> & { v?: number }
    if (!d.schema || !Array.isArray(d.schema.tables)) return null
    return { schema: d.schema, layout: d.layout ?? {} }
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

/** Load from the current URL hash if present. Returns true when a document was applied. */
export function restoreFromHash(store: typeof useSchemaStore, hash: string = location.hash): boolean {
  const encoded = shareFromHash(hash)
  if (!encoded) return false
  const doc = decodeShare(encoded)
  if (!doc) {
    toast('Share link is invalid or corrupted', 'error')
    return false
  }
  store.getState().load({ schema: doc.schema, layout: doc.layout })
  try {
    history.replaceState(null, '', location.pathname + location.search)
  } catch {
    /* ignore */
  }
  return true
}

/** Copy a share URL for the current document, warning when it is large. */
export async function shareCurrent(store: typeof useSchemaStore): Promise<string> {
  const s = store.getState()
  const url = buildShareUrl({ schema: s.schema, layout: s.layout })
  const ok = await copyText(url)
  track({ name: 'share-created', tables: s.schema.tables.length })
  const size = new TextEncoder().encode(url).length
  if (!ok) toast('Could not copy share link', 'error')
  else if (size > SHARE_WARN_BYTES) toast(`Share link copied — but it is ${(size / 1024).toFixed(0)} KB; some apps truncate long URLs`, 'error')
  else toast('Share link copied')
  return url
}

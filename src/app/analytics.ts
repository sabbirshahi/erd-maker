/**
 * Cookieless, privacy-friendly usage counts.
 *
 * Plausible rather than Umami: Umami has to be self-hosted, and this app deploys as static files
 * with no backend to host it on. Plausible's script is ~1 KB, sets no cookies, stores no
 * identifiers, and needs no consent banner.
 *
 * Two rules this module exists to enforce:
 *
 *  1. Nothing loads unless VITE_ANALYTICS_DOMAIN is set. In dev, in CI and under Playwright it is
 *     unset, so no script tag is added and no request is made.
 *  2. Events carry enums and counts only. `TrackedEvent` is a closed union, so schema content —
 *     table names, column names, DBML text, share payloads — cannot be passed without a type
 *     error. Diagram content never leaves the browser; this counts actions, not what they acted on.
 */

/** Every event the app is allowed to send, with the only properties each may carry. */
export type TrackedEvent =
  | { name: 'import'; kind: 'dbml' | 'sql' | 'django' | 'json' }
  | { name: 'export'; format: 'dbml' | 'postgres' | 'mysql' | 'sqlite' | 'django' | 'json' | 'png' | 'svg' }
  | { name: 'share-created'; tables: number }
  | { name: 'example-opened'; example: string }
  | { name: 'demo-started' }

const SCRIPT_SRC = 'https://plausible.io/js/script.js'
const SCRIPT_ID = 'dbridge-analytics'

type PlausibleFn = ((event: string, opts?: { props: Record<string, string | number> }) => void) & {
  q?: unknown[]
}

declare global {
  interface Window {
    plausible?: PlausibleFn
  }
}

function domain(): string | undefined {
  const value = import.meta.env.VITE_ANALYTICS_DOMAIN
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** True only when a domain is configured for this build. */
export function analyticsEnabled(): boolean {
  return domain() !== undefined
}

/**
 * Add the script tag, once. A no-op without a configured domain, so every other call site can stay
 * unconditional.
 */
export function initAnalytics(): void {
  const site = domain()
  if (!site) return
  if (typeof document === 'undefined' || document.getElementById(SCRIPT_ID)) return

  // The queue has to exist before the script loads, or early events are dropped.
  window.plausible =
    window.plausible ??
    (((...args: unknown[]) => {
      ;(window.plausible!.q = window.plausible!.q ?? []).push(args)
    }) as PlausibleFn)

  const el = document.createElement('script')
  el.id = SCRIPT_ID
  el.defer = true
  el.src = SCRIPT_SRC
  el.setAttribute('data-domain', site)
  document.head.appendChild(el)
}

/** Split an event into Plausible's (name, props) shape. Exported for the test. */
export function eventPayload(event: TrackedEvent): [string, Record<string, string | number>] {
  const { name, ...props } = event
  return [name, props as Record<string, string | number>]
}

export function track(event: TrackedEvent): void {
  if (!analyticsEnabled()) return
  const [name, props] = eventPayload(event)
  try {
    window.plausible?.(name, Object.keys(props).length > 0 ? { props } : undefined)
  } catch {
    // Analytics must never be able to break the app.
  }
}

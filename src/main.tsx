import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useSchemaStore } from '@/store'
import { initAnalytics } from '@/app/analytics'
import { initTheme } from '@/app/theme'
import { CrashScreen } from '@/app/CrashScreen'
import { bootSession } from '@/app/session'
import { restoreFromHash, restoreShortLink, shortLinkPending } from '@/app/share'

initTheme()
// No-op unless VITE_ANALYTICS_DOMAIN is set: no script tag, no request.
initAnalytics()

/** True in dev, under vitest, and for the Playwright suite (which runs a production build). */
const testable = import.meta.env.DEV || import.meta.env.MODE === 'test' || location.search.includes('e2e')

// Test hook (Playwright / vitest). Same shape as the one the canvas sets.
if (testable) {
  window.__erd = { store: useSchemaStore }
}

/**
 * Boot runs before React does, so a failure here would white-screen past the error boundary.
 * Any error is kept and rethrown during render instead, where CrashScreen can catch it.
 */
let bootError: Error | null = null
try {
  // A share hash wins over the stored project, and is then adopted into it.
  const fromHash = restoreFromHash(useSchemaStore)
  // A /s/<id> link has to be fetched, so boot cannot have it yet — but it can tell one is coming
  // from the URL, which is enough to adopt the arriving diagram instead of opening the last one.
  bootSession(fromHash || shortLinkPending())
} catch (err) {
  bootError = err instanceof Error ? err : new Error(String(err))
}

/** Exercises the shell-level boundary end to end. Only reachable with the test hook enabled. */
function Boom({ error }: { error: Error }): never {
  throw error
}

const crashOnPurpose = testable && new URLSearchParams(location.search).has('crash')
const failure = bootError ?? (crashOnPurpose ? new Error('Deliberate crash: ?crash=1') : null)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashScreen>{failure ? <Boom error={failure} /> : <App />}</CrashScreen>
  </StrictMode>,
)

// A no-op unless the URL is /s/<id>. Started after render so its toasts have somewhere to land,
// and it reports its own failures rather than white-screening the app.
void restoreShortLink(useSchemaStore)

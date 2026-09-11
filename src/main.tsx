import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useSchemaStore } from '@/store'
import { initTheme } from '@/app/theme'
import { bootSession } from '@/app/session'
import { restoreFromHash } from '@/app/share'

initTheme()

// Test hook (Playwright / vitest). Same shape as the one the canvas sets.
if (import.meta.env.DEV || import.meta.env.MODE === 'test' || location.search.includes('e2e')) {
  window.__erd = { store: useSchemaStore }
}

// Boot: a share hash wins over the stored project, and is then adopted into it.
const fromHash = restoreFromHash(useSchemaStore)
bootSession(fromHash)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

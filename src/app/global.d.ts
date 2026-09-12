import type { useSchemaStore } from '@/store'

declare global {
  /** package.json version, injected at build time (see vite.config.ts). */
  const __APP_VERSION__: string

  interface Window {
    /** Test hook: exposed in dev/test/e2e so Playwright and vitest can drive the store. */
    __erd?: { store: typeof useSchemaStore }
  }
}

export {}

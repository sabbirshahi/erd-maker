import type { useSchemaStore } from '@/store'

declare global {
  interface Window {
    /** Test hook: exposed in dev/test/e2e so Playwright and vitest can drive the store. */
    __erd?: { store: typeof useSchemaStore }
  }
}

export {}

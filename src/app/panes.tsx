/**
 * Lazy panes for sibling workers' components. Canvas (worker-2) and editors (worker-3) have landed and
 * are imported directly (code-split via React.lazy). The demo (worker-5) is still absent, so it keeps an
 * `import.meta.glob` bridge that resolves to a placeholder until `src/demo/index.ts(x)` exists.
 * Each pane is wrapped in Suspense + ErrorBoundary by the shell so a broken pane never kills it.
 */
import { lazy, type ComponentType } from 'react'

type Loader = () => Promise<Record<string, unknown>>

const demoMods = import.meta.glob<Record<string, unknown>>(['/src/demo/index.tsx', '/src/demo/index.ts'])

function firstLoader(mods: Record<string, Loader>): Loader | undefined {
  return Object.values(mods)[0]
}

/** Lazy-load a named export from a globbed module, falling back to `fallback` if absent or broken. */
export function lazyExport<P extends object>(
  mods: Record<string, Loader>,
  name: string,
  fallback: ComponentType<P>,
): ComponentType<P> {
  const loader = firstLoader(mods)
  return lazy(async () => {
    if (!loader) return { default: fallback }
    try {
      const m = await loader()
      const C = m[name]
      return { default: (typeof C === 'function' ? C : fallback) as ComponentType<P> }
    } catch (err) {
      console.error(`[shell] failed to load ${name}`, err)
      return { default: fallback }
    }
  }) as unknown as ComponentType<P>
}

export function Placeholder({ name, hint }: { name: string; hint?: string }) {
  return (
    <div
      data-testid={`placeholder-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      className="flex h-full w-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-zinc-400"
    >
      <div className="font-medium text-zinc-500 dark:text-zinc-400">{name}</div>
      <div className="text-xs">{hint ?? 'This pane has not landed yet.'}</div>
    </div>
  )
}

export interface DialogProps {
  open: boolean
  onClose: () => void
}

// Direct imports — these modules exist. React.lazy keeps xyflow / codemirror out of the entry chunk.
export const Canvas = lazy(() => import('@/canvas').then((m) => ({ default: m.Canvas })))
export const DbmlEditor = lazy(() => import('@/editors').then((m) => ({ default: m.DbmlEditor })))
export const DjangoEditor = lazy(() => import('@/editors').then((m) => ({ default: m.DjangoEditor })))
export const ImportDialog = lazy(() => import('@/editors').then((m) => ({ default: m.ImportDialog })))
export const ExportDialog = lazy(() => import('@/editors').then((m) => ({ default: m.ExportDialog })))

// Demo — bridge until worker-5 lands `src/demo`.
export const DemoPanel = lazyExport<Record<string, never>>(demoMods, 'DemoPanel', () => (
  <Placeholder name="Demo" hint="worker-5 is building the in-browser Django demo." />
))

export const hasDemo = Boolean(firstLoader(demoMods))

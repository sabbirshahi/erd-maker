/**
 * Lazy bridges to sibling workers' components. Uses `import.meta.glob` so the shell
 * typechecks and builds whether or not `src/canvas`, `src/editors`, `src/demo` exist yet.
 * Each pane is wrapped in Suspense + ErrorBoundary by the shell so a broken pane never kills it.
 */
import { lazy, type ComponentType } from 'react'

type Loader = () => Promise<Record<string, unknown>>

const canvasMods = import.meta.glob<Record<string, unknown>>(['/src/canvas/index.tsx', '/src/canvas/index.ts'])
const editorMods = import.meta.glob<Record<string, unknown>>(['/src/editors/index.tsx', '/src/editors/index.ts'])
const demoMods = import.meta.glob<Record<string, unknown>>(['/src/demo/index.tsx', '/src/demo/index.ts'])

function firstLoader(mods: Record<string, Loader>): Loader | undefined {
  return Object.values(mods)[0]
}

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
      data-testid={`placeholder-${name.toLowerCase()}`}
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

const NullDialog = (_props: DialogProps) => null

export const Canvas = lazyExport<Record<string, never>>(canvasMods, 'Canvas', () => (
  <Placeholder name="Canvas" hint="worker-2 is building the diagram canvas." />
))
export const DbmlEditor = lazyExport<Record<string, never>>(editorMods, 'DbmlEditor', () => (
  <Placeholder name="DBML editor" hint="worker-3 is building the editors." />
))
export const DjangoEditor = lazyExport<Record<string, never>>(editorMods, 'DjangoEditor', () => (
  <Placeholder name="Django editor" hint="worker-3 is building the editors." />
))
export const DemoPanel = lazyExport<Record<string, never>>(demoMods, 'DemoPanel', () => (
  <Placeholder name="Demo" hint="worker-5 is building the in-browser Django demo." />
))
export const ImportDialog = lazyExport<DialogProps>(editorMods, 'ImportDialog', NullDialog)
export const ExportDialog = lazyExport<DialogProps>(editorMods, 'ExportDialog', NullDialog)

export const hasEditors = Boolean(firstLoader(editorMods))
export const hasCanvas = Boolean(firstLoader(canvasMods))
export const hasDemo = Boolean(firstLoader(demoMods))

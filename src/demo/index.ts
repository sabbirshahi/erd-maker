/**
 * Demo module — OWNER: worker-5. See docs/briefs/worker-5-demo.md.
 * Public surface consumed by the app shell (worker-6).
 */
import { lazy } from 'react'

export { DemoPanel } from './DemoPanel'
export type { DemoPanelProps } from './DemoPanel'
/** Code-split wrapper: `<Suspense><LazyDemoPanel /></Suspense>`. */
export const LazyDemoPanel = lazy(() => import('./DemoPanel'))
export { DemoClient, getDemoClient } from './client'
export type { WorkerLike, WorkerFactory } from './client'
export * from './protocol'

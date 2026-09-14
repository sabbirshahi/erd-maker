/**
 * Demo module — OWNER: worker-5. See docs/briefs/worker-5-demo.md.
 * Public surface consumed by the app shell (worker-6).
 *
 * No lazy wrapper here: src/app/panes.tsx already splits this barrel with React.lazy. A second
 * `lazy(() => import('./DemoPanel'))` alongside the static re-export made both imports land in the
 * same chunk anyway, and the build warned about it (INEFFECTIVE_DYNAMIC_IMPORT).
 */

export { DemoPanel } from './DemoPanel'
export type { DemoPanelProps } from './DemoPanel'
export { DemoClient, getDemoClient } from './client'
export type { WorkerLike, WorkerFactory } from './client'
export * from './protocol'

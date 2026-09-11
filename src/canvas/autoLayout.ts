/**
 * `autoLayout()` is importable by other workers (e.g. after an import dialog commits).
 * When the canvas is mounted it runs with DOM-measured sizes and fits the view;
 * otherwise it falls back to estimated sizes and only writes the layout.
 */
import { useSchemaStore } from '@/store'
import { elkLayout } from './layout'

type Runner = () => Promise<void>
let mounted: Runner | null = null

export function registerAutoLayout(run: Runner | null): void {
  mounted = run
}

export async function autoLayout(): Promise<void> {
  if (mounted) return mounted()
  const st = useSchemaStore.getState()
  const layout = await elkLayout(st.schema)
  useSchemaStore.getState().setLayout(layout)
}

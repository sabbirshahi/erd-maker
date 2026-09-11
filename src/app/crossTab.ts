/**
 * Live updates between tabs showing the SAME project.
 *
 * localStorage fires a `storage` event in every other tab of the origin (never in the tab that
 * wrote), so a save in one tab can be picked up by the others without a reload. Only the tab's own
 * project is followed — tabs on different diagrams are deliberately independent.
 *
 * A tab with unsaved edits is never overwritten: it is told instead, so two people (or two windows)
 * editing at once cannot silently lose work.
 */
import type { useSchemaStore } from '@/store'
import { PROJECT_KEY_PREFIX, readProject } from './projects'
import type { SaveController } from './saveController'

type Store = typeof useSchemaStore

export interface CrossTabOptions {
  /** Called instead of applying when this tab has edits that would be lost. */
  onConflict?: () => void
}

/**
 * Follow `projectId` in other tabs until the returned function is called.
 * Exported for tests; the app starts this from the shell.
 */
export function startCrossTabSync(
  store: Store,
  controller: SaveController,
  projectId: string,
  options: CrossTabOptions = {},
): () => void {
  const key = `${PROJECT_KEY_PREFIX}${projectId}`

  const onStorage = (e: StorageEvent) => {
    // `key === null` means the whole store was cleared.
    if (e.key !== null && e.key !== key) return
    if (controller.status === 'unsaved' || controller.status === 'saving') {
      options.onConflict?.()
      return
    }
    const doc = readProject(projectId)
    if (!doc) return
    const current = store.getState()
    // Cheap equality check: avoids a pointless reload (and a canvas re-layout) when this tab is
    // already showing what was written.
    if (JSON.stringify(current.schema) === JSON.stringify(doc.schema)) return
    current.load({ schema: doc.schema, layout: doc.layout, dbmlText: doc.dbmlText ?? undefined })
    // Re-baseline the controller so the incoming change is not treated as a local edit and
    // immediately written back, which would bounce the update between tabs.
    controller.setProject(projectId)
  }

  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

/**
 * The one place keyboard bindings are written down.
 *
 * Audited against the code that actually handles the keys, not from memory: canvas keys live in
 * src/canvas/useShortcuts.ts, undo/redo and save in src/app/Shell.tsx, and Escape-to-close in the
 * two Modal components. A shortcut list that drifts from reality is worse than no list, so if you
 * change a binding, change it here too.
 */

/** `mod` renders as ⌘ on a Mac and Ctrl everywhere else. */
export interface Shortcut {
  keys: string[]
  description: string
  /** Where the binding is live, when that is not everywhere. */
  scope?: string
}

export interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Canvas',
    items: [
      { keys: ['mod', 'Shift', 'T'], description: 'Add a table' },
      { keys: ['mod', 'A'], description: 'Select every table', scope: 'Canvas' },
      { keys: ['Delete'], description: 'Delete what is selected', scope: 'Canvas' },
      { keys: ['F2'], description: 'Rename what is selected', scope: 'Canvas' },
      { keys: ['Escape'], description: 'Clear the selection' },
      { keys: ['Shift', 'drag'], description: 'Draw a selection box', scope: 'Canvas' },
      { keys: ['mod', 'click'], description: 'Add or remove one table from the selection', scope: 'Canvas' },
      { keys: ['double-click'], description: 'Open a table in the inspector', scope: 'Canvas' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: ['mod', 'C'], description: 'Copy the selected tables', scope: 'Canvas' },
      { keys: ['mod', 'X'], description: 'Cut the selected tables', scope: 'Canvas' },
      { keys: ['mod', 'V'], description: 'Paste tables', scope: 'Canvas' },
      { keys: ['mod', 'D'], description: 'Duplicate the selected tables', scope: 'Canvas' },
      { keys: ['mod', 'Z'], description: 'Undo' },
      { keys: ['mod', 'Shift', 'Z'], description: 'Redo' },
      { keys: ['mod', 'Y'], description: 'Redo' },
    ],
  },
  {
    title: 'App',
    items: [
      { keys: ['mod', 'S'], description: 'Save now (edits autosave anyway)' },
      { keys: ['?'], description: 'Show this list' },
      { keys: ['Escape'], description: 'Close a dialog' },
    ],
  },
]

export function isMac(platform: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export function renderKey(key: string, mac = isMac()): string {
  if (key === 'mod') return mac ? '⌘' : 'Ctrl'
  if (key === 'Shift') return mac ? '⇧' : 'Shift'
  if (key === 'Delete') return mac ? 'Delete' : 'Del'
  return key
}

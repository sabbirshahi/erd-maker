/** M7 empty state — shown over the canvas when the schema has no tables. */
import { Button, Kbd } from './ui'

export function EmptyState({
  onExamples,
  onImport,
  onBlank,
}: {
  onExamples: () => void
  onImport: () => void
  onBlank: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div
        data-testid="empty-state"
        className="pointer-events-auto w-full max-w-md rounded-xl border border-zinc-200 bg-white/95 p-6 text-center shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="3" width="8" height="6" rx="1" />
            <rect x="13" y="15" width="8" height="6" rx="1" />
            <path d="M7 9v5a2 2 0 0 0 2 2h4" />
          </svg>
        </div>
        <h2 className="text-base font-medium">Design a database in your browser</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          DBML, a live diagram and Django models — always in sync. Nothing leaves your browser.
        </p>
        <div className="mt-5 grid gap-2">
          <Button variant="primary" data-testid="empty-examples" onClick={onExamples}>
            Start from an example
          </Button>
          <Button data-testid="empty-import" onClick={onImport}>
            Paste DBML / SQL / models.py
          </Button>
          <Button variant="ghost" data-testid="start-blank" onClick={onBlank}>
            Start blank
          </Button>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Tip: drag from a column handle to another column to create a relationship. <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>T</Kbd> adds a table.
        </p>
      </div>
    </div>
  )
}

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
        className="erd-empty pointer-events-auto max-w-md"
      >
        <div className="erd-empty__mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="3" width="8" height="6" rx="1" />
            <rect x="13" y="15" width="8" height="6" rx="1" />
            <path d="M7 9v5a2 2 0 0 0 2 2h4" />
          </svg>
        </div>
        <h2 className="erd-empty__title">Design a database in your browser</h2>
        <p className="erd-muted mt-1 text-xs">
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
        <p className="erd-muted mt-4 text-xs">
          Tip: drag from a column handle to another column to create a relationship. <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>T</Kbd> adds a table.
        </p>
      </div>
    </div>
  )
}

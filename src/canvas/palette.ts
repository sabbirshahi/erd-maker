/**
 * The six colours a table can be tagged with.
 *
 * These hex literals are the one deliberate exception to "no hex outside tokens.css": a table's
 * colour is persisted into the document as DBML `[headercolor: #xxxxxx]`, so it has to be a real
 * hex that round-trips through dbdiagram.io, and it must not change when the user flips the theme.
 * The values are the light-mode halves of the `--erd-c-*` tokens; keep the two in step.
 *
 * All six are muted mid-tones that stay legible on both themes. Red is absent on purpose — it
 * means "validation error" everywhere else in the app.
 */
export interface TableColor {
  /** Matching token in tokens.css, used to paint the swatch so it follows the theme. */
  token: string
  /** What gets written to the document. */
  hex: string
  label: string
}

export const TABLE_COLORS: TableColor[] = [
  { token: '--erd-c-indigo', hex: '#6366f1', label: 'Indigo' },
  { token: '--erd-c-teal', hex: '#14b8a6', label: 'Teal' },
  { token: '--erd-c-emerald', hex: '#10b981', label: 'Emerald' },
  { token: '--erd-c-amber', hex: '#f59e0b', label: 'Amber' },
  { token: '--erd-c-violet', hex: '#a855f7', label: 'Violet' },
  { token: '--erd-c-slate', hex: '#64748b', label: 'Slate' },
]

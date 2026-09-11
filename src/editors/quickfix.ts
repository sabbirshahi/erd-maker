/**
 * Quick fixes offered next to a diagnostic, as clickable actions in the lint tooltip.
 *
 * Each fix is a pure `doc -> doc` function so the rules can be unit-tested without an editor, and
 * so applying one goes through the normal edit path (undoable, re-parsed, re-synced).
 */
import type { Diagnostic } from '@/core/schema'

export interface QuickFix {
  name: string
  apply: (doc: string) => string
}

const lineRange = (doc: string, line: number): { start: number; end: number; text: string } | null => {
  const lines = doc.split('\n')
  if (line < 1 || line > lines.length) return null
  let start = 0
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1
  return { start, end: start + lines[line - 1].length, text: lines[line - 1] }
}

const replaceLine = (doc: string, line: number, next: string): string => {
  const r = lineRange(doc, line)
  if (!r) return doc
  return doc.slice(0, r.start) + next + doc.slice(r.end)
}

const deleteLine = (doc: string, line: number): string => {
  const r = lineRange(doc, line)
  if (!r) return doc
  // Take the trailing newline with the line so no blank gap is left behind.
  const end = doc[r.end] === '\n' ? r.end + 1 : r.end
  return doc.slice(0, r.start) + doc.slice(end)
}

/** A bare word on its own line inside a table body: a column that never got a type. */
const BARE_WORD = /^(\s*)([A-Za-z_][\w]*)\s*$/

/** Count unclosed `{` in the document. */
export function unbalancedBraces(doc: string): number {
  let depth = 0
  for (const ch of doc.replace(/\/\/[^\n]*/g, '').replace(/'[^']*'/g, "''")) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return depth
}

/**
 * Fixes for one diagnostic, most useful first. Empty when nothing safe can be suggested — the
 * tooltip then just shows the message.
 */
export function quickFixesFor(doc: string, d: Diagnostic, commentPrefix = '//'): QuickFix[] {
  const fixes: QuickFix[] = []
  if (d.severity !== 'error') return fixes
  const line = d.line
  const r = line ? lineRange(doc, line) : null

  if (r) {
    const bare = BARE_WORD.exec(r.text)
    if (bare) {
      const [, indent, name] = bare
      fixes.push({
        name: `Give “${name}” a type`,
        apply: (text) => replaceLine(text, line!, `${indent}${name} varchar(255)`),
      })
    }
    fixes.push({ name: 'Delete this line', apply: (text) => deleteLine(text, line!) })
    if (!r.text.trim().startsWith(commentPrefix)) {
      fixes.push({
        name: 'Comment out this line',
        apply: (text) => replaceLine(text, line!, r.text.replace(/^(\s*)/, `$1${commentPrefix} `)),
      })
    }
  }

  const open = unbalancedBraces(doc)
  if (open > 0) {
    fixes.unshift({
      name: open === 1 ? 'Close the open block' : `Close ${open} open blocks`,
      apply: (text) => `${text.replace(/\s*$/, '')}\n${'}\n'.repeat(open)}`,
    })
  }

  return fixes
}

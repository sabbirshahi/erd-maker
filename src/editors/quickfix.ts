/**
 * Quick fixes offered next to a diagnostic, as clickable actions in the lint tooltip.
 *
 * Rules are keyed on the diagnostic MESSAGE, not on the look of the line, because the same text
 * means different things in different places: a bare word inside a table body is a column missing
 * its type, while the same word at the top level is a stray element that should become a table.
 * Each fix is a pure `doc -> doc` function, so rules are unit-testable without an editor and
 * applying one goes through the normal edit path (undoable, re-parsed, re-synced).
 *
 * Adding a rule: append to DBML_RULES or DJANGO_RULES. A rule returns [] when it does not apply.
 */
import type { Diagnostic } from '@/core/schema'

export interface QuickFix {
  name: string
  apply: (doc: string) => string
}

// ---------------------------------------------------------------- text helpers

const splitLines = (doc: string) => doc.split('\n')

function lineRange(doc: string, line: number): { start: number; end: number; text: string } | null {
  const lines = splitLines(doc)
  if (line < 1 || line > lines.length) return null
  let start = 0
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1
  return { start, end: start + lines[line - 1].length, text: lines[line - 1] }
}

function replaceLine(doc: string, line: number, next: string): string {
  const r = lineRange(doc, line)
  if (!r) return doc
  return doc.slice(0, r.start) + next + doc.slice(r.end)
}

function deleteLine(doc: string, line: number): string {
  const r = lineRange(doc, line)
  if (!r) return doc
  // Take the trailing newline with the line so no blank gap is left behind.
  const end = doc[r.end] === '\n' ? r.end + 1 : r.end
  return doc.slice(0, r.start) + doc.slice(end)
}

function insertAfterLine(doc: string, line: number, text: string): string {
  const r = lineRange(doc, line)
  if (!r) return doc
  return doc.slice(0, r.end) + '\n' + text + doc.slice(r.end)
}

const indentOf = (text: string): string => /^\s*/.exec(text)?.[0] ?? ''

const lineText = (doc: string, line: number): string => lineRange(doc, line)?.text ?? ''

/** Levenshtein distance, for "did you mean" suggestions on misspelled settings. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let carry = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(prev[j] + 1, prev[j - 1] + 1, carry + (a[i - 1] === b[j - 1] ? 0 : 1))
      carry = prev[j]
      prev[j] = next
    }
  }
  return prev[b.length]
}

function nearest(word: string, candidates: readonly string[], max = 3): string | null {
  let best: string | null = null
  let bestD = max + 1
  for (const c of candidates) {
    const d = distance(word.toLowerCase(), c)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return bestD <= max ? best : null
}

/** Count unclosed `{`, ignoring comments and quoted strings. */
export function unbalancedBraces(doc: string): number {
  let depth = 0
  for (const ch of doc.replace(/\/\/[^\n]*/g, '').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return depth
}

/** Locate a `Table <name> { ... }` block, tolerating schema prefixes, quotes and aliases. */
export function findTableBlock(doc: string, name: string): { openLine: number; closeLine: number } | null {
  const lines = splitLines(doc)
  const bare = name.replace(/^.*\./, '')
  const header = new RegExp(`^\\s*Table\\s+(?:[\\w"]+\\.)?["']?${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*(?:as\\s+\\w+\\s*)?[[{]`, 'i')
  for (let i = 0; i < lines.length; i++) {
    if (!header.test(lines[i])) continue
    let depth = 0
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }
      if (depth === 0 && j > i) return { openLine: i + 1, closeLine: j + 1 }
      if (depth > 0 && j === lines.length - 1) return { openLine: i + 1, closeLine: lines.length }
    }
  }
  return null
}

const DBML_SETTINGS = ['pk', 'primary key', 'increment', 'not null', 'null', 'unique', 'default', 'note', 'ref'] as const

const uniqueTableName = (doc: string, base: string): string => {
  let n = 2
  while (findTableBlock(doc, `${base}_${n}`)) n++
  return `${base}_${n}`
}

// ---------------------------------------------------------------- rules

type Rule = (doc: string, d: Diagnostic, line: number) => QuickFix[]

const DBML_RULES: Rule[] = [
  // "A column must have a type" — a bare word inside a table body.
  (doc, d, line) => {
    if (!/column must have a type/i.test(d.message)) return []
    const text = lineText(doc, line)
    const m = /^(\s*)([A-Za-z_][\w]*)\s*$/.exec(text)
    if (!m) return []
    return [{ name: `Give “${m[2]}” a type`, apply: (t) => replaceLine(t, line, `${m[1]}${m[2]} varchar(255)`) }]
  },

  // A stray word at the top level: DBML reads it as a custom element.
  (doc, d, line) => {
    if (!/Custom element/i.test(d.message)) return []
    const text = lineText(doc, line)
    const m = /^(\s*)([A-Za-z_][\w]*)\s*$/.exec(text)
    if (!m) return []
    return [
      {
        name: `Make “${m[2]}” a table`,
        apply: (t) => replaceLine(t, line, `${m[1]}Table ${m[2]} {\n${m[1]}  id int [pk, increment]\n${m[1]}}`),
      },
    ]
  },

  // "A Table must have at least one column" — the diagnostic points at the Table header.
  (doc, d, line) => {
    if (!/must have at least one column/i.test(d.message)) return []
    const indent = indentOf(lineText(doc, line))
    return [{ name: 'Add an id column', apply: (t) => insertAfterLine(t, line, `${indent}  id int [pk, increment]`) }]
  },

  // A relation pointing at a table that does not exist yet.
  (_doc, d) => {
    const m = /Table '([^']+)' does not exist/i.exec(d.message)
    if (!m) return []
    const name = m[1].replace(/^.*\./, '')
    return [
      {
        name: `Create table “${name}”`,
        apply: (t) => `${t.replace(/\s*$/, '')}\n\nTable ${name} {\n  id int [pk, increment]\n}\n`,
      },
    ]
  },

  // A relation pointing at a column the table does not have.
  (doc, d) => {
    const m = /Column '([^']+)' does not exist in Table '([^']+)'/i.exec(d.message)
    if (!m) return []
    const [, column, table] = m
    const block = findTableBlock(doc, table)
    if (!block) return []
    return [
      {
        name: `Add column “${column}” to ${table.replace(/^.*\./, '')}`,
        apply: (t) => {
          const b = findTableBlock(t, table)
          if (!b) return t
          return insertAfterLine(t, b.closeLine - 1, `  ${column} int`)
        },
      },
    ]
  },

  // Two tables with the same name.
  (doc, d, line) => {
    const m = /Table '([^']+)' already exists/i.exec(d.message)
    if (!m) return []
    const name = m[1].replace(/^.*\./, '')
    const text = lineText(doc, line)
    return [
      {
        name: `Rename this one to “${uniqueTableName(doc, name)}”`,
        apply: (t) => replaceLine(t, line, text.replace(new RegExp(`(\\b)${name}(\\b)`), `$1${uniqueTableName(t, name)}$2`)),
      },
    ]
  },

  // Index entries must be an identifier or a tuple: `a, b [unique]` needs parentheses.
  (doc, d, line) => {
    if (!/index field must be/i.test(d.message)) return []
    const text = lineText(doc, line)
    const m = /^(\s*)([^[\]]+?)\s*(\[.*\])?\s*$/.exec(text)
    if (!m || !m[2].includes(',') || m[2].trim().startsWith('(')) return []
    return [
      {
        name: 'Wrap the columns in parentheses',
        apply: (t) => replaceLine(t, line, `${m[1]}(${m[2].trim()})${m[3] ? ' ' + m[3] : ''}`),
      },
    ]
  },

  // Enum values are bare identifiers, with no separators.
  (doc, d, line) => {
    if (!/enum field must be/i.test(d.message)) return []
    const text = lineText(doc, line)
    if (!/[,;]\s*$/.test(text)) return []
    return [{ name: 'Remove the trailing comma', apply: (t) => replaceLine(t, line, text.replace(/[,;]\s*$/, '')) }]
  },

  // A misspelled column setting, e.g. [pkk].
  (doc, d, line) => {
    const m = /setting '([^']+)'/i.exec(d.message)
    if (!m) return []
    const guess = nearest(m[1], DBML_SETTINGS)
    if (!guess) return []
    const text = lineText(doc, line)
    return [
      {
        name: `Change “${m[1]}” to “${guess}”`,
        apply: (t) => replaceLine(t, line, text.replace(new RegExp(`\\b${m[1]}\\b`), guess)),
      },
    ]
  },

  // `Ref: a.b c.d` is missing its relationship operator.
  (doc, d, line) => {
    if (!/binary relationship/i.test(d.message)) return []
    const text = lineText(doc, line)
    const m = /^(\s*Ref[^:]*:\s*)([\w".]+)\s+([\w".]+)\s*(\[.*\])?\s*$/.exec(text)
    if (!m) return []
    return [
      {
        name: 'Insert a “>” relationship',
        apply: (t) => replaceLine(t, line, `${m[1]}${m[2]} > ${m[3]}${m[4] ? ' ' + m[4] : ''}`),
      },
    ]
  },

  // An unquoted default, e.g. [default: hello] — DBML wants a literal.
  (doc, d, line) => {
    if (!/'default' must be/i.test(d.message)) return []
    const text = lineText(doc, line)
    const m = /default:\s*([^,\]]+)/i.exec(text)
    if (!m) return []
    const raw = m[1].trim()
    if (raw === '' || /^['"`]/.test(raw)) return []
    return [
      {
        name: `Quote the default as “'${raw}'”`,
        apply: (t) => replaceLine(t, line, text.replace(/default:\s*[^,\]]+/i, `default: '${raw.replace(/'/g, "\\'")}'`)),
      },
    ]
  },

  // An unexpected closing brace.
  (doc, d, line) => {
    if (!/Expect an identifier/i.test(d.message) || lineText(doc, line).trim() !== '}') return []
    return [{ name: 'Delete the extra “}”', apply: (t) => deleteLine(t, line) }]
  },
]

const DJANGO_RULES: Rule[] = [
  // A class header that never got its colon.
  (doc, d, line) => {
    if (!/syntax error/i.test(d.message)) return []
    const text = lineText(doc, line)
    if (!/^\s*(class|def)\b.*[^:\s]\s*$/.test(text)) return []
    return [{ name: 'Add the missing “:”', apply: (t) => replaceLine(t, line, `${text.replace(/\s*$/, '')}:`) }]
  },

  // An unclosed call, e.g. models.CharField(max_length=200
  (doc, d, line) => {
    if (!/syntax error/i.test(d.message)) return []
    const text = lineText(doc, line)
    const open = (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length
    if (open <= 0) return []
    return [
      {
        name: open === 1 ? 'Close the open bracket' : `Close ${open} open brackets`,
        apply: (t) => replaceLine(t, line, `${text.replace(/\s*$/, '')}${')'.repeat(open)}`),
      },
    ]
  },

  // A field written at module level instead of inside the class above it.
  (doc, d, line) => {
    if (!/not part of the schema/i.test(d.message)) return []
    const text = lineText(doc, line)
    if (/^\s/.test(text)) return []
    const lines = splitLines(doc)
    let classIndent: string | null = null
    for (let i = line - 2; i >= 0; i--) {
      const c = /^(\s*)class\s+\w+/.exec(lines[i])
      if (c) {
        classIndent = c[1]
        break
      }
    }
    if (classIndent === null) return []
    return [{ name: 'Indent into the class above', apply: (t) => replaceLine(t, line, `${classIndent}    ${text.trim()}`) }]
  },

  // A ForeignKey naming a model that is not in this file.
  (_doc, d) => {
    const m = /points at model (\w+), which is not defined/i.exec(d.message)
    if (!m) return []
    const name = m[1]
    return [
      {
        name: `Create model “${name}”`,
        apply: (t) => `${t.replace(/\s*$/, '')}\n\n\nclass ${name}(models.Model):\n    id = models.AutoField(primary_key=True)\n\n    class Meta:\n        db_table = '${name.toLowerCase()}s'\n`,
      },
    ]
  },
]

/**
 * Fixes for one diagnostic, most useful first. Errors and warnings both get them; the universal
 * delete/comment fallbacks come last so a specific fix is always the primary action.
 */
export function quickFixesFor(doc: string, d: Diagnostic, commentPrefix = '//'): QuickFix[] {
  if (d.severity === 'info') return []
  const line = d.line
  const fixes: QuickFix[] = []
  const rules = d.source === 'django' ? DJANGO_RULES : DBML_RULES

  if (line !== undefined && lineRange(doc, line)) {
    for (const rule of rules) fixes.push(...rule(doc, d, line))
  }

  // Unclosed blocks are a document-level problem, so this is offered wherever it is reported.
  if (d.source !== 'django') {
    const open = unbalancedBraces(doc)
    if (open > 0) {
      fixes.push({
        name: open === 1 ? 'Close the open block' : `Close ${open} open blocks`,
        apply: (t) => `${t.replace(/\s*$/, '')}\n${'}\n'.repeat(open)}`,
      })
    }
  }

  if (line !== undefined) {
    const text = lineRange(doc, line)?.text
    if (text !== undefined && text.trim() !== '') {
      fixes.push({ name: 'Delete this line', apply: (t) => deleteLine(t, line) })
      if (!text.trim().startsWith(commentPrefix)) {
        fixes.push({
          name: 'Comment out this line',
          apply: (t) => replaceLine(t, line, text.replace(/^(\s*)/, `$1${commentPrefix} `)),
        })
      }
    }
  }

  return fixes
}

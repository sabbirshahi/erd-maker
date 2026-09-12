/**
 * Fuzzy search over the schema, for the command palette.
 *
 * Subsequence matching with a score, rather than substring: typing "oi" should find `order_items`,
 * and "uem" should find `users.email`. Contiguous runs, matches at the start of a word and matches
 * at the start of the name all score higher, which is what makes the first result usually right.
 *
 * Pure and store-free so it can be tested directly.
 */
import type { Schema } from '@/core/schema'

export interface SearchHit {
  kind: 'table' | 'column'
  tableId: string
  tableName: string
  /** Set for a column hit; the table is shown alongside it so the result is unambiguous. */
  columnId?: string
  columnName?: string
  /** Column type, shown muted on the row. */
  detail?: string
  score: number
}

/**
 * @returns a score, higher is better, or -1 when `query` is not a subsequence of `text`.
 */
export function fuzzyScore(query: string, text: string): number {
  if (query === '') return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    // A run of adjacent characters is a much stronger signal than the same letters scattered.
    streak = found === ti && ti > 0 ? streak + 1 : 0
    score += 1 + streak * 4
    if (found === 0) score += 8
    else if (/[^a-z0-9]/.test(t[found - 1])) score += 4 // start of a word: the _ in order_items
    ti = found + 1
  }
  // Prefer the shorter of two otherwise equal names.
  return score + Math.max(0, 24 - text.length)
}

export function searchSchema(schema: Schema, query: string, limit = 30): SearchHit[] {
  const trimmed = query.trim()
  if (trimmed === '') {
    return schema.tables.slice(0, limit).map((t) => ({ kind: 'table' as const, tableId: t.id, tableName: t.name, score: 0 }))
  }

  const hits: SearchHit[] = []
  for (const table of schema.tables) {
    const tableScore = fuzzyScore(trimmed, table.name)
    if (tableScore >= 0) {
      hits.push({ kind: 'table', tableId: table.id, tableName: table.name, score: tableScore + 10 })
    }
    for (const column of table.columns) {
      // "users.email" and "email" should both find the column.
      const direct = fuzzyScore(trimmed, column.name)
      const qualified = fuzzyScore(trimmed, `${table.name}.${column.name}`)
      const best = Math.max(direct, qualified)
      if (best < 0) continue
      hits.push({
        kind: 'column',
        tableId: table.id,
        tableName: table.name,
        columnId: column.id,
        columnName: column.name,
        detail: column.type,
        score: best,
      })
    }
  }

  // Tables above columns when the score ties, since a table is the coarser target.
  hits.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === 'table' ? -1 : 1))
  return hits.slice(0, limit)
}

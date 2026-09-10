/**
 * Tiny, parser-independent DBML sketch used for gallery thumbnails: table names,
 * column counts and ref pairs. Deliberately forgiving — thumbnails must never throw.
 */
export interface SketchTable {
  name: string
  columns: number
}

export interface Sketch {
  tables: SketchTable[]
  /** Pairs of table indexes. */
  refs: [number, number][]
}

const TABLE_RE = /^\s*Table\s+(?:"([^"]+)"|([A-Za-z_][\w.]*))(?:\s+as\s+\w+)?\s*(?:\[[^\]]*\])?\s*\{/
const INLINE_REF_RE = /ref:\s*[<>-]{1,2}\s*(?:"([^"]+)"|([A-Za-z_][\w]*))\./i
const REF_LINE_RE = /^\s*Ref(?:\s+\w+)?\s*:\s*(?:"([^"]+)"|([\w]+))\.[\w"()\s,]+?\s*[<>-]{1,2}\s*(?:"([^"]+)"|([\w]+))\./

export function sketchDbml(dbml: string): Sketch {
  const tables: SketchTable[] = []
  const aliases = new Map<string, string>()
  const refs: [number, number][] = []
  const lines = dbml.split(/\r?\n/)
  let current: SketchTable | null = null
  let depth = 0
  let inIndexes = false

  const strip = (n: string) => n.replace(/^[\w]+\./, '')
  const indexOf = (name: string) => {
    const n = strip(aliases.get(name) ?? name)
    return tables.findIndex((t) => t.name === n)
  }

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, '')
    if (!line.trim()) continue
    const tm = TABLE_RE.exec(line)
    if (tm && depth === 0) {
      const full = tm[1] ?? tm[2] ?? ''
      current = { name: strip(full), columns: 0 }
      const alias = /\s+as\s+(\w+)/.exec(line)?.[1]
      if (alias) aliases.set(alias, full)
      tables.push(current)
      depth = 1
      inIndexes = false
      continue
    }
    if (depth > 0 && current) {
      if (/^\s*indexes\s*\{/i.test(line)) {
        inIndexes = true
        depth++
        continue
      }
      if (/^\s*Note\s*[:{]/.test(line)) {
        if (line.includes('{') && !line.includes('}')) depth++
        continue
      }
      if (/^\s*\}/.test(line)) {
        depth--
        if (depth === 1 && inIndexes) inIndexes = false
        if (depth === 0) current = null
        continue
      }
      if (!inIndexes && /^\s*[\w"]/.test(line)) {
        current.columns++
        const im = INLINE_REF_RE.exec(line)
        if (im) {
          const target = im[1] ?? im[2] ?? ''
          const a = tables.length - 1
          const b = indexOf(target)
          refs.push([a, b])
        }
      }
      continue
    }
    const rm = REF_LINE_RE.exec(line)
    if (rm) {
      const a = indexOf(rm[1] ?? rm[2] ?? '')
      const b = indexOf(rm[3] ?? rm[4] ?? '')
      refs.push([a, b])
    }
  }
  // Resolve forward references (target defined after the source).
  const fixed = refs.map(([a, b]) => [a, b] as [number, number]).filter(([a, b]) => a >= 0 && b >= 0)
  return { tables, refs: fixed }
}

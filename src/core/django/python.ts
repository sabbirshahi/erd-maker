/** Python literal helpers shared by generate.ts and parse.ts. OWNER: worker-4 (core-django). */
import { toPascalCase } from '../naming'

/** `abc'd` -> `'abc\'d'` */
export function pyStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** Unescape the content of a python string literal (single/double/triple quoted). */
export function unquotePyStr(source: string): string | undefined {
  const s = source.trim().replace(/^[rRbBuUfF]{1,2}(?=['"])/, '')
  const mt = s.match(/^("""|'''|"|')([\s\S]*)\1$/)
  if (!mt) return undefined
  return mt[2].replace(/\\(n|t|\\|'|")/g, (_all, c: string) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c,
  )
}

/** Python docstring, always triple double quoted. */
export function pyDocstring(s: string): string {
  return `"""${s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}"""`
}

/** `post_status` -> `PostStatus` (TextChoices class name). */
export function enumClassName(enumName: string): string {
  const base = enumName.split('.').pop() ?? enumName
  const name = toPascalCase(base)
  return /^[A-Za-z_]/.test(name) ? name : `E${name}`
}

/** `in-progress` -> `IN_PROGRESS` (TextChoices member name). */
export function enumMemberName(value: string): string {
  const name = value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'VALUE'
  return /^[0-9]/.test(name) ? `_${name}` : name
}

/** `in_progress` -> `In progress` */
export function enumLabel(value: string): string {
  const words = value.replace(/[_\-\s]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value
}

/**
 * DBML default expression -> python literal source, or `undefined` when it is a backtick
 * expression (SQL) that has no python equivalent.
 */
export function dbmlDefaultToPython(def: string): string | undefined {
  const d = def.trim()
  if (/^`.*`$/s.test(d)) return undefined
  if (/^(true|false)$/i.test(d)) return d.toLowerCase() === 'true' ? 'True' : 'False'
  if (/^null$/i.test(d)) return 'None'
  if (/^-?\d+(\.\d+)?$/.test(d)) return d
  const str = unquotePyStr(d)
  if (str !== undefined) return pyStr(str)
  return pyStr(d)
}

/** Python literal source -> DBML default expression (`'x'`, `1`, `true`), or undefined if not a literal. */
export function pythonLiteralToDbmlDefault(src: string): string | undefined {
  const s = src.trim()
  if (s === 'True') return 'true'
  if (s === 'False') return 'false'
  if (/^-?\d+(\.\d+)?$/.test(s)) return s
  const str = unquotePyStr(s)
  if (str !== undefined) return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return undefined
}

/** `x = 'a'` block re-indented by `indent` (blank lines untouched). */
export function indent(text: string, indentStr = '    '): string {
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : indentStr + l))
    .join('\n')
}

/** Remove common leading whitespace from every non-blank line. */
export function dedent(text: string): string {
  const lines = text.split('\n')
  const widths = lines.filter((l) => l.trim() !== '').map((l) => l.match(/^\s*/)![0].length)
  const min = widths.length ? Math.min(...widths) : 0
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(min))).join('\n')
}

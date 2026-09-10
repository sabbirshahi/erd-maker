/**
 * DBML language support for CodeMirror 6: a StreamLanguage tokenizer and an
 * autocompletion source (keywords, types, and table/column names from the store).
 * Pure module apart from the store read in the completion source.
 */
import { StreamLanguage, LanguageSupport, type StreamParser, type StringStream } from '@codemirror/language'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Schema } from '@/core/schema'

export const DBML_KEYWORDS = [
  'Table',
  'Ref',
  'Enum',
  'indexes',
  'Indexes',
  'Note',
  'Project',
  'TableGroup',
  'as',
] as const

/** Keywords accepted inside `[...]` settings. */
export const DBML_SETTINGS = [
  'pk',
  'primary key',
  'unique',
  'not null',
  'null',
  'increment',
  'default',
  'note',
  'ref',
  'delete',
  'update',
  'name',
  'type',
  'headercolor',
  'color',
  'cascade',
  'restrict',
  'set null',
  'set default',
  'no action',
] as const

export const DBML_TYPES = [
  'int',
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'varchar',
  'char',
  'text',
  'boolean',
  'bool',
  'timestamp',
  'timestamptz',
  'datetime',
  'date',
  'time',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'uuid',
  'json',
  'jsonb',
  'blob',
  'bytea',
] as const

export interface DbmlState {
  /** Nesting depth of `{ }` blocks. */
  depth: number
  /** True while inside a `[ ... ]` settings list. */
  inSettings: boolean
  /** Non-null while inside a multi-line construct that spans lines. */
  multiline: 'comment' | 'string' | null
  /** Previous significant token type (for context: after `Table` comes a table name). */
  prev: 'keyword' | 'name' | 'other' | null
  /** Keyword that started the current line-level context. */
  lastKeyword: string | null
}

const KEYWORD_SET = new Set<string>(DBML_KEYWORDS)
const TYPE_SET = new Set<string>(DBML_TYPES)
const SETTING_WORDS = new Set<string>(DBML_SETTINGS.flatMap((s) => s.split(' ')))

function tokenMultilineComment(stream: StringStream, state: DbmlState): string {
  while (!stream.eol()) {
    if (stream.match('*/')) {
      state.multiline = null
      return 'comment'
    }
    stream.next()
  }
  return 'comment'
}

function tokenTripleString(stream: StringStream, state: DbmlState): string {
  while (!stream.eol()) {
    if (stream.match("'''")) {
      state.multiline = null
      return 'string'
    }
    stream.next()
  }
  return 'string'
}

function tokenQuoted(stream: StringStream, quote: string): string {
  let escaped = false
  while (!stream.eol()) {
    const ch = stream.next()
    if (ch === quote && !escaped) return 'string'
    escaped = !escaped && ch === '\\'
  }
  return 'string'
}

const dbmlParser: StreamParser<DbmlState> = {
  name: 'dbml',
  startState: () => ({ depth: 0, inSettings: false, multiline: null, prev: null, lastKeyword: null }),
  copyState: (s) => ({ ...s }),

  token(stream, state) {
    if (state.multiline === 'comment') return tokenMultilineComment(stream, state)
    if (state.multiline === 'string') return tokenTripleString(stream, state)

    if (stream.eatSpace()) return null

    // Comments
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.multiline = 'comment'
      return tokenMultilineComment(stream, state)
    }

    // Strings
    if (stream.match("'''")) {
      state.multiline = 'string'
      return tokenTripleString(stream, state)
    }
    const ch = stream.peek()
    if (ch === "'" || ch === '"') {
      stream.next()
      const style = tokenQuoted(stream, ch)
      // A quoted identifier right after a keyword is a name, not a string.
      if (state.prev === 'keyword' && ch === '"') {
        state.prev = 'name'
        return 'variableName.definition'
      }
      state.prev = 'other'
      return style
    }
    if (ch === '`') {
      stream.next()
      while (!stream.eol()) {
        if (stream.next() === '`') break
      }
      state.prev = 'other'
      return 'string.special'
    }

    // Brackets / punctuation
    if (stream.match('[')) {
      state.inSettings = true
      state.prev = 'other'
      return 'squareBracket'
    }
    if (stream.match(']')) {
      state.inSettings = false
      state.prev = 'other'
      return 'squareBracket'
    }
    if (stream.match('{')) {
      state.depth++
      state.prev = 'other'
      state.lastKeyword = null
      return 'brace'
    }
    if (stream.match('}')) {
      state.depth = Math.max(0, state.depth - 1)
      state.prev = 'other'
      return 'brace'
    }
    if (stream.match('(') || stream.match(')')) {
      state.prev = 'other'
      return 'paren'
    }

    // Relation symbols
    if (stream.match('<>') || stream.match('>') || stream.match('<') || stream.match('-')) {
      state.prev = 'other'
      return 'operator'
    }
    if (stream.match(':') || stream.match(',') || stream.match('.')) {
      state.prev = 'other'
      return 'punctuation'
    }

    // Numbers
    if (stream.match(/^-?\d+(\.\d+)?/)) {
      state.prev = 'other'
      return 'number'
    }

    // Words
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (word) {
      const w = (word as RegExpMatchArray)[0]
      const lower = w.toLowerCase()

      if (state.inSettings) {
        if (SETTING_WORDS.has(lower)) {
          state.prev = 'other'
          return 'propertyName'
        }
        if (lower === 'true' || lower === 'false' || lower === 'null') {
          state.prev = 'other'
          return 'bool'
        }
        state.prev = 'other'
        return 'variableName'
      }

      if (state.prev === 'keyword') {
        state.prev = 'name'
        return 'variableName.definition'
      }

      if (KEYWORD_SET.has(w) || (state.depth === 0 && KEYWORD_SET.has(lower))) {
        state.prev = 'keyword'
        state.lastKeyword = lower
        return 'keyword'
      }

      if (state.depth > 0 && (lower === 'indexes' || lower === 'note')) {
        state.prev = 'keyword'
        state.lastKeyword = lower
        return 'keyword'
      }

      if (state.depth > 0 && TYPE_SET.has(lower)) {
        state.prev = 'other'
        return 'typeName'
      }

      // Inside a Table block, the first word on a line is a column name; the second is a type.
      if (state.depth > 0 && state.prev === 'name') {
        state.prev = 'other'
        return 'typeName'
      }
      if (state.depth > 0 && stream.string.slice(0, stream.start).trim() === '') {
        state.prev = 'name'
        return 'variableName'
      }

      state.prev = 'other'
      return 'variableName'
    }

    stream.next()
    state.prev = 'other'
    return null
  },

  blankLine(state) {
    state.prev = null
  },

  indent(state, textAfter) {
    const closing = /^\s*[}\]]/.test(textAfter)
    return Math.max(0, state.depth - (closing ? 1 : 0)) * 2
  },

  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`'] },
    wordChars: '_',
  },
}

export const dbmlLanguage = StreamLanguage.define(dbmlParser)

/**
 * Tokenize a document with the DBML stream parser. Returns `{ text, style }` pairs
 * (whitespace omitted). Used by tests and handy for debugging.
 */
export function tokenizeDbml(text: string): Array<{ text: string; style: string | null }> {
  const out: Array<{ text: string; style: string | null }> = []
  const state = dbmlParser.startState!(2)
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.trim() === '') {
      dbmlParser.blankLine?.(state, 2)
      continue
    }
    const stream = new StringStreamShim(line, 2, 2)
    while (!stream.eol()) {
      stream.start = stream.pos
      const style = dbmlParser.token(stream as unknown as StringStream, state)
      const tok = line.slice(stream.start, stream.pos)
      if (stream.pos === stream.start) stream.pos++ // safety: never loop forever
      if (tok.trim() !== '') out.push({ text: tok, style })
    }
  }
  return out
}

/** Minimal StringStream re-implementation for headless tokenization (tests, node). */
class StringStreamShim {
  pos = 0
  start = 0
  lastColumnPos = 0
  lastColumnValue = 0
  string: string
  tabSize: number
  indentUnit: number
  constructor(string: string, tabSize: number, indentUnit: number) {
    this.string = string
    this.tabSize = tabSize
    this.indentUnit = indentUnit
  }
  eol() {
    return this.pos >= this.string.length
  }
  sol() {
    return this.pos === 0
  }
  peek() {
    return this.string.charAt(this.pos) || undefined
  }
  next() {
    if (this.pos < this.string.length) return this.string.charAt(this.pos++)
    return undefined
  }
  eat(match: string | RegExp | ((ch: string) => boolean)) {
    const ch = this.string.charAt(this.pos)
    let ok: boolean
    if (typeof match === 'string') ok = ch === match
    else if (match instanceof RegExp) ok = !!ch && match.test(ch)
    else ok = !!ch && match(ch)
    if (ok) {
      this.pos++
      return ch
    }
    return undefined
  }
  eatWhile(match: string | RegExp | ((ch: string) => boolean)) {
    const start = this.pos
    while (this.eat(match)) {
      /* advance */
    }
    return this.pos > start
  }
  eatSpace() {
    const start = this.pos
    while (/[\s ]/.test(this.string.charAt(this.pos))) this.pos++
    return this.pos > start
  }
  skipToEnd() {
    this.pos = this.string.length
  }
  skipTo(ch: string) {
    const found = this.string.indexOf(ch, this.pos)
    if (found > -1) {
      this.pos = found
      return true
    }
    return false
  }
  backUp(n: number) {
    this.pos -= n
  }
  column() {
    return this.start
  }
  indentation() {
    return 0
  }
  match(pattern: string | RegExp, consume?: boolean, caseInsensitive?: boolean) {
    if (typeof pattern === 'string') {
      const cased = (str: string) => (caseInsensitive ? str.toLowerCase() : str)
      const substr = this.string.substr(this.pos, pattern.length)
      if (cased(substr) === cased(pattern)) {
        if (consume !== false) this.pos += pattern.length
        return true
      }
      return null
    }
    const match = this.string.slice(this.pos).match(pattern)
    if (match && match.index! > 0) return null
    if (match && consume !== false) this.pos += match[0].length
    return match
  }
  current() {
    return this.string.slice(this.start, this.pos)
  }
}

// ---------- autocompletion ----------

export interface CompletionSchemaSource {
  (): Schema | undefined
}

const keywordCompletions: Completion[] = DBML_KEYWORDS.map((k) => ({ label: k, type: 'keyword' }))
const typeCompletions: Completion[] = DBML_TYPES.map((t) => ({ label: t, type: 'type' }))
const settingCompletions: Completion[] = DBML_SETTINGS.map((s) => ({ label: s, type: 'property' }))

/**
 * Build a completion source. `getSchema` is called lazily so completions always reflect
 * the current store (tables, columns, enums).
 */
export function dbmlCompletionSource(getSchema: CompletionSchemaSource) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_.]*/)
    if (!word && !context.explicit) return null
    const from = word ? word.from : context.pos
    const text = word?.text ?? ''
    const lineText = context.state.doc.lineAt(context.pos).text
    const before = lineText.slice(0, context.pos - context.state.doc.lineAt(context.pos).from)
    const inSettings = /\[[^\]]*$/.test(before)
    const schema = getSchema()

    const options: Completion[] = []

    // `table.` → column names of that table
    const dotted = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/.exec(text)
    if (dotted && schema) {
      const table = schema.tables.find((t) => t.name === dotted[1] || t.alias === dotted[1])
      if (table) {
        const colFrom = from + dotted[1].length + 1
        return {
          from: colFrom,
          options: table.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type })),
          validFor: /^[A-Za-z0-9_]*$/,
        }
      }
    }

    if (inSettings) {
      options.push(...settingCompletions)
    } else {
      options.push(...keywordCompletions, ...typeCompletions)
    }
    if (schema) {
      for (const t of schema.tables) options.push({ label: t.name, type: 'class', detail: 'table' })
      for (const e of schema.enums) options.push({ label: e.name, type: 'enum', detail: 'enum' })
      const seen = new Set<string>()
      for (const t of schema.tables)
        for (const c of t.columns)
          if (!seen.has(c.name)) {
            seen.add(c.name)
            options.push({ label: c.name, type: 'property', detail: 'column' })
          }
    }
    return { from, options, validFor: /^[A-Za-z0-9_]*$/ }
  }
}

/** Full language support (language + completion). */
export function dbml(getSchema: CompletionSchemaSource = () => undefined): LanguageSupport {
  return new LanguageSupport(dbmlLanguage, [
    dbmlLanguage.data.of({ autocomplete: dbmlCompletionSource(getSchema) }),
  ])
}

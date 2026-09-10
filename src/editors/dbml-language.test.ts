import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { tokenizeDbml, dbmlCompletionSource, dbmlLanguage, DBML_KEYWORDS } from './dbml-language'
import { emptySchema, newColumn, newTable } from '@/core/schema'

const styles = (text: string) => tokenizeDbml(text).map((t) => [t.text, t.style])

describe('dbml tokenizer', () => {
  it('tokenizes keywords and definition names', () => {
    expect(styles('Table users {')).toEqual([
      ['Table', 'keyword'],
      ['users', 'variableName.definition'],
      ['{', 'brace'],
    ])
    for (const kw of DBML_KEYWORDS) {
      const first = tokenizeDbml(`${kw} x`)[0]
      expect(first.style, kw).toBe('keyword')
    }
  })

  it('tokenizes columns: name, type, settings', () => {
    const toks = styles("Table t {\n  id int [pk, increment]\n  name varchar(255) [not null, default: 'x']\n}")
    expect(toks).toContainEqual(['id', 'variableName'])
    expect(toks).toContainEqual(['int', 'typeName'])
    expect(toks).toContainEqual(['pk', 'propertyName'])
    expect(toks).toContainEqual(['increment', 'propertyName'])
    expect(toks).toContainEqual(['varchar', 'typeName'])
    expect(toks).toContainEqual(['255', 'number'])
    expect(toks).toContainEqual(['not', 'propertyName'])
    expect(toks).toContainEqual(['null', 'propertyName'])
    expect(toks).toContainEqual(["'x'", 'string'])
    expect(toks).toContainEqual(['}', 'brace'])
  })

  it('treats unknown types as types by position', () => {
    const toks = styles('Table t {\n  status post_status [not null]\n}')
    expect(toks).toContainEqual(['status', 'variableName'])
    expect(toks).toContainEqual(['post_status', 'typeName'])
  })

  it('tokenizes strings, triple strings and backtick expressions', () => {
    expect(styles(`x "double" 'single'`)).toEqual([
      ['x', 'variableName'],
      ['"double"', 'string'],
      ["'single'", 'string'],
    ])
    expect(styles("Note: '''multi\nline'''")).toEqual([
      ['Note', 'keyword'],
      [':', 'punctuation'],
      ["'''multi", 'string'],
      ["line'''", 'string'],
    ])
    expect(styles('[default: `now()`]')).toContainEqual(['`now()`', 'string.special'])
    // escaped quote does not terminate
    expect(styles("'it\\'s'")).toEqual([["'it\\'s'", 'string']])
  })

  it('tokenizes line and block comments', () => {
    expect(styles('// hello\nTable x {}')[0]).toEqual(['// hello', 'comment'])
    expect(styles('/* a\nb */ Table y {}')).toEqual([
      ['/* a', 'comment'],
      ['b */', 'comment'],
      ['Table', 'keyword'],
      ['y', 'variableName.definition'],
      ['{', 'brace'],
      ['}', 'brace'],
    ])
  })

  it('tokenizes relation symbols as operators', () => {
    const toks = styles('Ref: a.b > c.d\nRef: a.b < c.d\nRef: a.b - c.d\nRef: a.b <> c.d')
    const ops = toks.filter(([, s]) => s === 'operator').map(([t]) => t)
    expect(ops).toEqual(['>', '<', '-', '<>'])
    expect(toks).toContainEqual(['Ref', 'keyword'])
    expect(toks).toContainEqual(['.', 'punctuation'])
  })

  it('handles indexes and Note blocks inside tables', () => {
    const toks = styles('Table t {\n  indexes {\n    (a, b) [unique]\n  }\n  Note: "n"\n}')
    expect(toks).toContainEqual(['indexes', 'keyword'])
    expect(toks).toContainEqual(['(', 'paren'])
    expect(toks).toContainEqual(['unique', 'propertyName'])
    expect(toks).toContainEqual(['Note', 'keyword'])
  })

  it('supports schema-qualified and aliased tables', () => {
    const toks = styles('Table public.users as U {')
    expect(toks[0]).toEqual(['Table', 'keyword'])
    expect(toks).toContainEqual(['as', 'keyword'])
    expect(toks).toContainEqual(['U', 'variableName.definition'])
  })

  it('never loops on odd input', () => {
    expect(() => tokenizeDbml('@@@ ### $$$  ')).not.toThrow()
    expect(tokenizeDbml('')).toEqual([])
  })

  it('integrates with an EditorState', () => {
    const state = EditorState.create({ doc: 'Table t {\n  id int\n}', extensions: [dbmlLanguage] })
    expect(state.doc.lines).toBe(3)
  })
})

describe('dbml completion', () => {
  const schema = emptySchema()
  const users = newTable({
    name: 'users',
    columns: [newColumn({ name: 'id', type: 'int' }), newColumn({ name: 'email' })],
  })
  schema.tables.push(users)
  schema.enums.push({ id: 'e', name: 'post_status', values: [] })
  const source = dbmlCompletionSource(() => schema)

  function complete(doc: string, pos = doc.length, explicit = false) {
    const state = EditorState.create({ doc })
    return source(new CompletionContext(state, pos, explicit))
  }

  it('offers keywords, types, tables and enums at top level', () => {
    const res = complete('Ta')
    expect(res).not.toBeNull()
    const labels = res!.options.map((o) => o.label)
    expect(labels).toContain('Table')
    expect(labels).toContain('varchar')
    expect(labels).toContain('users')
    expect(labels).toContain('post_status')
    expect(labels).toContain('email')
    expect(res!.from).toBe(0)
  })

  it('offers settings inside brackets', () => {
    const res = complete('Table t {\n  id int [p')
    const labels = res!.options.map((o) => o.label)
    expect(labels).toContain('pk')
    expect(labels).toContain('not null')
    expect(labels).not.toContain('Table')
  })

  it('offers column names after table.', () => {
    const doc = 'Ref: users.'
    const res = complete(doc)
    expect(res!.from).toBe(doc.length)
    expect(res!.options.map((o) => o.label)).toEqual(['id', 'email'])
    const partial = complete('Ref: users.em')
    expect(partial!.from).toBe('Ref: users.'.length)
  })

  it('returns null with no word and implicit trigger', () => {
    expect(complete('Table t ', undefined, false)).toBeNull()
    expect(complete('Table t ', undefined, true)).not.toBeNull()
  })
})

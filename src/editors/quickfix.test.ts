import { describe, it, expect } from 'vitest'
import { quickFixesFor, unbalancedBraces, findTableBlock } from './quickfix'
import type { Diagnostic, DiagnosticSource } from '@/core/schema'

/** Messages below are copied from what the real parsers emit. */
const diag = (message: string, line: number, source: DiagnosticSource = 'dbml'): Diagnostic => ({
  id: 'd', severity: 'error', source, message, line,
})
const warn = (message: string, line: number, source: DiagnosticSource = 'django'): Diagnostic => ({
  id: 'w', severity: 'warning', source, message, line,
})
const names = (fixes: { name: string }[]) => fixes.map((f) => f.name)
const first = (doc: string, d: Diagnostic, prefix?: string) => {
  const f = quickFixesFor(doc, d, prefix)
  return f[0].apply(doc)
}

describe('DBML quick fixes', () => {
  it('gives an untyped column a type', () => {
    const doc = 'Table t {\n  id int [pk]\n  here\n}\n'
    const fixes = quickFixesFor(doc, diag('A column must have a type', 3))
    expect(names(fixes)[0]).toBe('Give “here” a type')
    expect(first(doc, diag('A column must have a type', 3))).toContain('  here varchar(255)')
  })

  it('turns a stray top-level word into a table, and does not offer a column type there', () => {
    const doc = 'area\n\nTable t {\n  id int [pk]\n}\n'
    const d = diag('A Custom element can only appear in a Project or a Dep', 1)
    const fixes = quickFixesFor(doc, d)
    expect(names(fixes)[0]).toBe('Make “area” a table')
    // The context-blind behaviour this replaced offered a column type at the top level.
    expect(names(fixes).some((n) => n.includes('a type'))).toBe(false)
    expect(first(doc, d)).toContain('Table area {\n  id int [pk, increment]\n}')
  })

  it('adds an id column to an empty table', () => {
    const doc = 'Table t {\n}\n'
    expect(first(doc, diag('A Table must have at least one column', 1))).toBe('Table t {\n  id int [pk, increment]\n}\n')
  })

  it('creates a table a relation points at', () => {
    const doc = 'Table t {\n  id int [pk]\n  x int\n}\nRef: t.x > missing_tbl.id\n'
    const out = first(doc, diag("Table 'missing_tbl' does not exist in Schema 'public'", 5))
    expect(out).toContain('Table missing_tbl {\n  id int [pk, increment]\n}')
    expect(out).toContain('Ref: t.x > missing_tbl.id')
  })

  it('adds a column a relation points at, inside the right table', () => {
    const doc = 'Table t {\n  id int [pk]\n}\nTable u {\n  id int [pk]\n}\nRef: t.nope > u.id\n'
    const out = first(doc, diag("Column 'nope' does not exist in Table 'public.t'", 7))
    expect(out).toBe('Table t {\n  id int [pk]\n  nope int\n}\nTable u {\n  id int [pk]\n}\nRef: t.nope > u.id\n')
  })

  it('renames a duplicate table', () => {
    const doc = 'Table t {\n  id int [pk]\n}\nTable t {\n  id int [pk]\n}\n'
    const out = first(doc, diag("Table 't' already exists in schema 'public'", 4))
    expect(out).toContain('Table t_2 {')
    expect(out.match(/Table t \{/g)).toHaveLength(1)
  })

  it('wraps index columns in parentheses', () => {
    const doc = 'Table t {\n  id int [pk]\n  indexes {\n    app_label, model [unique]\n  }\n}\n'
    const out = first(doc, diag('An index field must be an identifier, a quoted identifier, a functional expression or a tuple of such', 4))
    expect(out).toContain('    (app_label, model) [unique]')
  })

  it('removes a trailing comma in an enum', () => {
    const doc = 'Enum e {\n  a,\n}\n'
    expect(first(doc, diag('An enum field must be an identifier or a quoted identifier', 2))).toBe('Enum e {\n  a\n}\n')
  })

  it('corrects a misspelled setting', () => {
    const doc = 'Table t {\n  id int [pkk]\n}\n'
    const fixes = quickFixesFor(doc, diag("Custom setting 'pkk' must be a string or a color literal", 2))
    expect(names(fixes)[0]).toBe('Change “pkk” to “pk”')
    expect(fixes[0].apply(doc)).toContain('[pk]')
  })

  it('inserts a missing relationship operator', () => {
    const doc = 'Table t {\n  id int [pk]\n}\nRef: t.id u.id\n'
    expect(first(doc, diag('A Ref field must be a binary relationship', 4))).toContain('Ref: t.id > u.id')
  })

  it('deletes an extra closing brace', () => {
    const doc = 'Table t {\n  id int [pk]\n}\n}\n'
    const fixes = quickFixesFor(doc, diag('Expect an identifier', 4))
    expect(names(fixes)[0]).toBe('Delete the extra “}”')
    expect(fixes[0].apply(doc)).toBe('Table t {\n  id int [pk]\n}\n')
  })

  it('closes an unclosed block', () => {
    const doc = 'Table t {\n  id int [pk]\n'
    const fixes = quickFixesFor(doc, diag("Expect a closing brace '}'", 3))
    expect(names(fixes)).toContain('Close the open block')
    expect(unbalancedBraces(fixes[0].apply(doc))).toBe(0)
  })

  it('always offers delete and comment as fallbacks, and nothing for info', () => {
    const doc = 'Table t {\n  id int [pk]\n  here\n}\n'
    expect(names(quickFixesFor(doc, diag('Something we have no rule for', 3)))).toEqual(['Delete this line', 'Comment out this line'])
    expect(quickFixesFor(doc, { ...diag('x', 3), severity: 'info' })).toEqual([])
  })

  it('ignores braces inside comments and strings when counting', () => {
    expect(unbalancedBraces("Table t {\n  note: 'a { brace'\n}\n// }\n")).toBe(0)
    expect(findTableBlock('Table public.users as U {\n  id int\n}\n', 'users')).toEqual({ openLine: 1, closeLine: 3 })
  })
})

describe('Django quick fixes', () => {
  it('adds a missing colon to a class header', () => {
    const doc = 'class Post(models.Model)\n    title = models.CharField(max_length=200)\n'
    const d = diag('Python syntax error near "class Post(models.Model)"', 1, 'django')
    expect(quickFixesFor(doc, d, '#')[0].name).toBe('Add the missing “:”')
    expect(first(doc, d, '#')).toContain('class Post(models.Model):')
  })

  it('closes an unclosed bracket', () => {
    const doc = 'class Post(models.Model):\n    title = models.CharField(max_length=200\n'
    const d = diag('Python syntax error near "title = models.CharField(max_length=200"', 2, 'django')
    expect(quickFixesFor(doc, d, '#')[0].name).toBe('Close the open bracket')
    expect(first(doc, d, '#')).toContain('models.CharField(max_length=200)')
  })

  it('indents a field that escaped its class', () => {
    const doc = 'class Post(models.Model):\ntitle = models.CharField(max_length=200)\n'
    const d = warn('Top-level expression statement at line 2 is not part of the schema and will be lost on regeneration', 2)
    expect(quickFixesFor(doc, d, '#')[0].name).toBe('Indent into the class above')
    expect(first(doc, d, '#')).toBe('class Post(models.Model):\n    title = models.CharField(max_length=200)\n')
  })

  it('creates a model a ForeignKey points at', () => {
    const doc = 'class Post(models.Model):\n    author = models.ForeignKey("Missing", on_delete=models.CASCADE)\n'
    const d = warn('posts.author points at model Missing, which is not defined in this file; kept as a plain column', 2)
    expect(quickFixesFor(doc, d, '#')[0].name).toBe('Create model “Missing”')
    expect(first(doc, d, '#')).toContain('class Missing(models.Model):')
  })

  it('comments with # rather than //', () => {
    const doc = 'class Post(models.Model):\n    oops\n'
    const fixes = quickFixesFor(doc, diag('Python syntax error near "oops"', 2, 'django'), '#')
    expect(fixes.find((f) => f.name === 'Comment out this line')!.apply(doc)).toContain('    # oops')
  })
})

describe('unquoted default (produced by the inspector before the generator was fixed)', () => {
  it('offers to quote the value', () => {
    const doc = 'Table t {\n  hello varchar(255) [default: hello]\n}\n'
    const d = diag("'default' must be an enum value, a string literal, number literal, function expression, true, false or null", 2)
    const fixes = quickFixesFor(doc, d)
    expect(fixes[0].name).toBe('Quote the default as “\'hello\'”')
    expect(fixes[0].apply(doc)).toContain("[default: 'hello']")
  })

  it('leaves an already-quoted default alone', () => {
    const doc = "Table t {\n  hello varchar(255) [default: 'hi']\n}\n"
    const d = diag("'default' must be an enum value, a string literal", 2)
    expect(quickFixesFor(doc, d).map((f) => f.name)).toEqual(['Delete this line', 'Comment out this line'])
  })
})

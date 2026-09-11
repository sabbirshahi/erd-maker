import { describe, it, expect } from 'vitest'
import { quickFixesFor, unbalancedBraces } from './quickfix'
import type { Diagnostic } from '@/core/schema'

const err = (line: number, message = 'Unexpected token'): Diagnostic => ({
  id: 'd1', severity: 'error', source: 'dbml', message, line,
})

const DOC = `Table django_content_type {
  id int [pk, increment]
  app_label varchar(100) [not null]
  model varchar(100) [not null]
  test
  indexes {
    (app_label, model) [unique]
  }
}
`

describe('quick fixes', () => {
  it('offers a type for a column that has none', () => {
    const fixes = quickFixesFor(DOC, err(5))
    expect(fixes[0].name).toBe('Give “test” a type')
    const fixed = fixes[0].apply(DOC)
    expect(fixed).toContain('  test varchar(255)')
    // Nothing else moves.
    expect(fixed.split('\n')).toHaveLength(DOC.split('\n').length)
    expect(fixed).toContain('app_label varchar(100) [not null]')
  })

  it('offers to delete or comment out the offending line', () => {
    const fixes = quickFixesFor(DOC, err(5))
    const del = fixes.find((f) => f.name === 'Delete this line')!
    expect(del.apply(DOC)).not.toContain('test')
    const comment = fixes.find((f) => f.name === 'Comment out this line')!
    expect(comment.apply(DOC)).toContain('  // test')
  })

  it('uses the Python comment marker for Django diagnostics', () => {
    const fixes = quickFixesFor('class X(models.Model):\n    oops\n', { ...err(2), source: 'django' }, '#')
    expect(fixes.find((f) => f.name === 'Comment out this line')!.apply('class X(models.Model):\n    oops\n')).toContain('    # oops')
  })

  it('closes unbalanced blocks, ignoring braces in comments and strings', () => {
    expect(unbalancedBraces(DOC)).toBe(0)
    const open = 'Table t {\n  id int [pk]\n'
    expect(unbalancedBraces(open)).toBe(1)
    const fixes = quickFixesFor(open, err(2, "expected '}'"))
    expect(fixes[0].name).toBe('Close the open block')
    expect(unbalancedBraces(fixes[0].apply(open))).toBe(0)
    expect(unbalancedBraces("Table t {\n  note: 'a { brace'\n}\n// }\n")).toBe(0)
  })

  it('offers nothing for warnings', () => {
    expect(quickFixesFor(DOC, { ...err(5), severity: 'warning' })).toEqual([])
  })
})

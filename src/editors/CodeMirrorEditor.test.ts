import { describe, it, expect } from 'vitest'
import { minimalChange, toCmDiagnostics } from './CodeMirrorEditor'

describe('minimalChange', () => {
  it('returns null for identical text', () => {
    expect(minimalChange('abc', 'abc')).toBeNull()
  })
  it('finds the changed middle', () => {
    expect(minimalChange('Table a {}\nTable b {}', 'Table a {}\nTable bb {}')).toEqual({
      from: 18,
      to: 18,
      insert: 'b',
    })
    expect(minimalChange('hello world', 'hello')).toEqual({ from: 5, to: 11, insert: '' })
    expect(minimalChange('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' })
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' })
  })
})

describe('toCmDiagnostics', () => {
  const doc = 'Table t {\n  id itn\n}\n'
  it('maps line/col to offsets', () => {
    const [d] = toCmDiagnostics(doc, [
      { id: '1', severity: 'error', source: 'dbml', message: 'm', line: 2, col: 6, endCol: 9 },
    ])
    expect(d.from).toBe(15)
    expect(d.to).toBe(18)
    expect(d.severity).toBe('error')
    expect(d.message).toBe('m')
  })
  it('marks the whole trimmed line when only a line is given', () => {
    const [d] = toCmDiagnostics(doc, [{ id: '1', severity: 'warning', source: 'dbml', message: 'm', line: 2 }])
    expect(doc.slice(d.from, d.to)).toBe('id itn')
  })
  it('clamps out-of-range positions and never yields inverted ranges', () => {
    const [d] = toCmDiagnostics(doc, [
      { id: '1', severity: 'error', source: 'dbml', message: 'm', line: 99, col: 99 },
    ])
    expect(d.from).toBeLessThanOrEqual(doc.length)
    expect(d.to).toBeGreaterThanOrEqual(d.from)
    const [e] = toCmDiagnostics('', [{ id: '2', severity: 'error', source: 'dbml', message: 'm' }])
    expect(e.from).toBe(0)
    expect(e.to).toBe(0)
  })
  it('spans multiple lines with endLine', () => {
    const [d] = toCmDiagnostics(doc, [
      { id: '1', severity: 'info', source: 'dbml', message: 'm', line: 1, col: 1, endLine: 3, endCol: 2 },
    ])
    expect(doc.slice(d.from, d.to)).toBe('Table t {\n  id itn\n}')
  })
})

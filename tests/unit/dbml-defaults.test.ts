import { describe, it, expect } from 'vitest'
import { formatDbmlDefault } from '@/core/dbml/strings'
import { generateDbml, parseDbml } from '@/core/dbml'
import { emptySchema, newColumn, newTable } from '@/core/schema'

describe('default values are always emitted as valid DBML', () => {
  it('normalises what the inspector stores', () => {
    expect(formatDbmlDefault('hello')).toBe("'hello'")
    expect(formatDbmlDefault('42')).toBe('42')
    expect(formatDbmlDefault('-1.5')).toBe('-1.5')
    expect(formatDbmlDefault('TRUE')).toBe('true')
    expect(formatDbmlDefault('null')).toBe('null')
    expect(formatDbmlDefault("it's")).toBe("'it\\'s'")
    expect(formatDbmlDefault('"x"')).toBe("'x'")
  })

  it('leaves parser-produced literals untouched (round trip is stable)', () => {
    expect(formatDbmlDefault("'draft'")).toBe("'draft'")
    expect(formatDbmlDefault('`now()`')).toBe('`now()`')
  })

  it('a default typed in the inspector produces parseable DBML', () => {
    const s = emptySchema()
    s.tables.push(newTable({ name: 'table_1', columns: [newColumn({ name: 'hello', type: 'varchar(255)', default: 'hello' })] }))
    const text = generateDbml(s)
    expect(text).toContain("[default: 'hello']")
    const { schema, diagnostics } = parseDbml(text)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(schema!.tables[0].columns[0].default).toBe("'hello'")
  })
})

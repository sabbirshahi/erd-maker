import { describe, expect, it } from 'vitest'
import { MAX_NAME_LENGTH, exportFilename, slugifyName } from './filename'
import { EXPORT_FORMATS, exportFileName } from '@/editors/ExportDialog'

describe('export filenames', () => {
  it('names the file after the diagram', () => {
    expect(exportFilename('Shop', 'erd.json')).toBe('Shop.json')
    expect(exportFilename('Shop', 'schema.dbml')).toBe('Shop.dbml')
    expect(exportFilename('Shop', 'erd.png')).toBe('Shop.png')
    // Everything from the first dot is the extension, so a two-part one survives intact.
    expect(exportFilename('Shop', 'schema.sqlite.sql')).toBe('Shop.sqlite.sql')
  })

  it('keeps the name readable: spaces, case, punctuation and other alphabets', () => {
    expect(exportFilename('My Shop (v2)', 'erd.json')).toBe('My Shop (v2).json')
    expect(exportFilename('Ω schema — नेपाली', 'erd.json')).toBe('Ω schema — नेपाली.json')
    expect(exportFilename('🎉 launch', 'erd.png')).toBe('🎉 launch.png')
  })

  it('cannot say where the file goes', () => {
    expect(slugifyName('../../etc/passwd')).toBe('etc passwd')
    expect(slugifyName('/etc/passwd')).toBe('etc passwd')
    expect(slugifyName('C:\\Windows\\System32')).toBe('C Windows System32')
    expect(exportFilename('../../etc/passwd', 'erd.json')).toBe('etc passwd.json')
    // Nothing that survives may contain a separator, whatever went in.
    for (const hostile of ['a/b', 'a\\b', '..', './.', 'a:b', 'a*?b', 'a|b', 'a<b>c', 'a"b']) {
      expect(exportFilename(hostile, 'erd.json')).not.toMatch(/[/\\<>:"|?*]/)
    }
  })

  it('drops control characters and collapses the whitespace they leave', () => {
    expect(slugifyName('a\u0000b')).toBe('a b')
    expect(slugifyName('tab\there')).toBe('tab here')
    expect(slugifyName('new\nline')).toBe('new line')
    expect(slugifyName('lots    of   space')).toBe('lots of space')
  })

  it('falls back to the generic name when nothing usable is left', () => {
    expect(exportFilename('', 'erd.json')).toBe('erd.json')
    expect(exportFilename('   ', 'schema.dbml')).toBe('schema.dbml')
    expect(exportFilename('...', 'erd.png')).toBe('erd.png')
    expect(exportFilename('.', 'erd.svg')).toBe('erd.svg')
    expect(exportFilename('/\\', 'schema.sqlite.sql')).toBe('schema.sqlite.sql')
  })

  it('never begins with a dot or ends with a dot or a space', () => {
    expect(exportFilename('.hidden', 'erd.json')).toBe('hidden.json')
    expect(exportFilename('trailing.', 'erd.json')).toBe('trailing.json')
    expect(exportFilename('trailing   ', 'erd.json')).toBe('trailing.json')
    expect(slugifyName('..weird..')).toBe('weird')
  })

  it('caps a very long name, and does not leave a dot or a space at the cut', () => {
    const long = 'a'.repeat(300)
    expect(slugifyName(long)).toBe('a'.repeat(MAX_NAME_LENGTH))
    expect(exportFilename(long, 'erd.json')).toBe(`${'a'.repeat(MAX_NAME_LENGTH)}.json`)
    expect(exportFilename(`${'b'.repeat(MAX_NAME_LENGTH)} tail`, 'erd.json')).toBe(
      `${'b'.repeat(MAX_NAME_LENGTH)}.json`,
    )
    // A name whose cut lands on a space or a dot keeps neither.
    const cutOnSpace = `${'c'.repeat(MAX_NAME_LENGTH - 1)} ddd`
    expect(slugifyName(cutOnSpace)).toBe('c'.repeat(MAX_NAME_LENGTH - 1))
    const cutOnDot = `${'e'.repeat(MAX_NAME_LENGTH - 1)}.fff`
    expect(slugifyName(cutOnDot)).toBe('e'.repeat(MAX_NAME_LENGTH - 1))
  })

  it('keeps a fallback that has no extension at all', () => {
    expect(exportFilename('', 'README')).toBe('README')
    expect(exportFilename('Shop', 'README')).toBe('Shop')
  })
})

describe('export dialog filenames', () => {
  it('names every format after the diagram, except the one Django dictates', () => {
    const named = Object.fromEntries(EXPORT_FORMATS.map((f) => [f.id, exportFileName(f, 'Shop')]))
    expect(named).toEqual({
      dbml: 'Shop.dbml',
      postgres: 'Shop.postgres.sql',
      mysql: 'Shop.mysql.sql',
      sqlite: 'Shop.sqlite.sql',
      // Django imports models from a module with this exact name; renaming it breaks the file.
      django: 'models.py',
      json: 'Shop.json',
    })
  })

  it('keeps the generic name when the diagram has nothing usable for one', () => {
    expect(EXPORT_FORMATS.map((f) => exportFileName(f, '...'))).toEqual(
      EXPORT_FORMATS.map((f) => f.file),
    )
  })
})

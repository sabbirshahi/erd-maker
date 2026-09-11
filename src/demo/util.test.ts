import { describe, expect, it } from 'vitest'
import { buildSnippets, isUnsupportedDevice } from './util'

const MODELS = `from django.db import models


class User(models.Model):

    username = models.CharField(max_length=150, unique=True)

    class Meta:
        db_table = 'users'


class Post(models.Model):

    author = models.ForeignKey('User', on_delete=models.CASCADE, db_column='author_id')
    title = models.CharField(max_length=200)
    tags = models.ManyToManyField('Tag')

    class Meta:
        db_table = 'posts'
`

describe('buildSnippets', () => {
  it('derives snippets from the first model and the first FK', () => {
    const s = buildSnippets(MODELS)
    expect(s[0].code).toBe('User.objects.all()')
    expect(
      s.some((x) => x.code.includes("Post.objects.values('author__id').annotate(n=Count('id'))")),
    ).toBe(true)
    expect(s.some((x) => x.code.includes("select_related('author')"))).toBe(true)
    expect(s.at(-1)?.code).toContain('connection.queries')
  })

  it('returns nothing for an empty models.py', () => {
    expect(buildSnippets('from django.db import models\n')).toEqual([])
  })

  it('omits FK snippets when there is no ForeignKey', () => {
    const s = buildSnippets('class Tag(models.Model):\n    name = models.CharField(max_length=5)\n')
    expect(s.map((x) => x.label)).toEqual([
      'Tag.objects.all()',
      'Tag.objects.filter(...)',
      'Tag.objects.count()',
      'connection.queries',
    ])
  })
})

describe('isUnsupportedDevice', () => {
  const nav = (userAgent: string, maxTouchPoints = 0) =>
    ({ userAgent, maxTouchPoints }) as unknown as Navigator
  const ok = { worker: true, wasm: true }
  it('flags phones and iPads (including iPadOS pretending to be a Mac)', () => {
    expect(isUnsupportedDevice(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))).toBe(
      true,
    )
    expect(isUnsupportedDevice(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'))).toBe(true)
    expect(isUnsupportedDevice(nav('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'))).toBe(true)
    expect(
      isUnsupportedDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5)),
    ).toBe(true)
  })
  it('allows desktop browsers', () => {
    expect(
      isUnsupportedDevice(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120', 0), ok),
    ).toBe(false)
    expect(
      isUnsupportedDevice(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'), ok),
    ).toBe(false)
    expect(isUnsupportedDevice(nav('Mozilla/5.0 (X11; Linux x86_64) Firefox/120'), ok)).toBe(false)
    expect(isUnsupportedDevice(undefined, ok)).toBe(false)
    expect(
      isUnsupportedDevice(nav('Mozilla/5.0 (X11; Linux x86_64) Firefox/120'), {
        worker: false,
        wasm: true,
      }),
    ).toBe(true)
  })
})

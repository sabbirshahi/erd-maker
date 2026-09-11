/**
 * Pure helpers for the demo panel (kept out of the component file for fast refresh + unit tests).
 * OWNER: worker-5 (demo).
 */

export interface DemoCapabilities {
  worker: boolean
  wasm: boolean
}

export const currentCapabilities = (): DemoCapabilities => ({
  worker: typeof Worker !== 'undefined',
  wasm: typeof WebAssembly !== 'undefined',
})

/** Phones and iPads cannot run a 15 MB WebAssembly runtime comfortably (plan risk table). */
export function isUnsupportedDevice(
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  caps: DemoCapabilities = currentCapabilities(),
): boolean {
  if (!nav) return false
  if (!caps.worker || !caps.wasm) return true
  const ua = nav.userAgent ?? ''
  if (/Android|iPhone|iPod|Mobi|IEMobile|Opera Mini/i.test(ua)) return true
  if (/iPad/i.test(ua)) return true
  // iPadOS Safari pretends to be a Mac; touch points give it away.
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true
  return false
}

export interface Snippet {
  label: string
  code: string
}

/** Build ORM snippets from the generated models.py (class + FK names), independent of the parser. */
export function buildSnippets(modelsPy: string): Snippet[] {
  const classes = [...modelsPy.matchAll(/^class (\w+)\(models\.Model\):/gm)].map((m) => m[1])
  if (classes.length === 0) return []
  const fks: Array<{ model: string; field: string }> = []
  const chunks = modelsPy.split(/^(?=class \w+\(models\.Model\):)/gm)
  for (const chunk of chunks) {
    const cls = /^class (\w+)\(models\.Model\):/m.exec(chunk)?.[1]
    if (!cls) continue
    for (const m of chunk.matchAll(/^\s+(\w+) = models\.ForeignKey\(/gm))
      fks.push({ model: cls, field: m[1] })
  }
  const first = classes[0]
  const out: Snippet[] = [
    { label: `${first}.objects.all()`, code: `${first}.objects.all()` },
    {
      label: `${first}.objects.filter(...)`,
      code: `${first}.objects.filter(id__lte=5).order_by('-id')`,
    },
    { label: `${first}.objects.count()`, code: `${first}.objects.count()` },
  ]
  const fk = fks[0]
  if (fk) {
    out.push({
      label: `${fk.model}.objects.annotate(Count(...))`,
      code: `${fk.model}.objects.values('${fk.field}__id').annotate(n=Count('id')).order_by('-n')[:10]`,
    })
    out.push({
      label: `${fk.model}.objects.select_related('${fk.field}')`,
      code: `qs = ${fk.model}.objects.select_related('${fk.field}')[:10]\nfor row in qs:\n    print(row.${fk.field})\nqs`,
    })
  }
  out.push({
    label: 'connection.queries',
    code: 'from django.db import connection\nlist(connection.queries)[-5:]',
  })
  return out
}

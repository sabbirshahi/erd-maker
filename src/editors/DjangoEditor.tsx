/**
 * Django models.py pane: generated from the schema; editable (parseDjango via tree-sitter, worker-4).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { python } from '@codemirror/lang-python'
import { generateDjango, initDjangoParser, parseDjango, type GenerateResult } from '@/core/django'
import type { Schema } from '@/core/schema'
import { reconcile } from '@/core/reconcile'
import { useSchemaStore } from '@/store'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { useTextSync } from './useTextSync'
import { CopyButton } from '@/app/CopyButton'
import { useGotoLine } from './goto'
import { Button } from '@/app/ui'

export interface DjangoEditorProps {
  className?: string
}

export function DjangoEditor({ className }: DjangoEditorProps) {
  const handle = useRef<CodeMirrorEditorHandle>(null)
  const [readOnly, setReadOnly] = useState(false)
  const initStarted = useRef(false)

  // generateDjango is pure; memoise the last result per schema object so the text generator and
  // the diagnostics effect below share one run instead of generating twice per commit.
  const genCache = useRef<{ schema: Schema; result: GenerateResult } | null>(null)
  const generate = useCallback((schema: Schema): GenerateResult => {
    if (genCache.current?.schema !== schema) genCache.current = { schema, result: generateDjango(schema) }
    return genCache.current.result
  }, [])

  const ensureParser = useCallback(async () => {
    if (initStarted.current) return
    initStarted.current = true
    try {
      await initDjangoParser()
    } catch {
      // parseDjango reports its own diagnostics; nothing to do here
    }
  }, [])

  const sync = useTextSync({
    view: 'django',
    parse: async (text) => {
      await ensureParser()
      return parseDjango(text)
    },
    generate: (schema) => generate(schema).text,
    reconcile,
  })
  const extensions = useMemo(() => [python()], [])
  useGotoLine('django', handle)

  // Side effect kept out of generate(): publish the generator's (typemap) diagnostics once per commit.
  const version = useSchemaStore((s) => s.version)
  const origin = useSchemaStore((s) => s.origin)
  useEffect(() => {
    const state = useSchemaStore.getState()
    const next = generate(state.schema).diagnostics
    const prev = state.diagnostics.typemap
    const same =
      prev.length === next.length && prev.every((d, i) => d.message === next[i].message && d.severity === next[i].severity)
    if (!same) state.setDiagnostics('typemap', next)
  }, [version, origin, generate])

  useEffect(() => () => void sync.flush(), [sync])

  const errors = sync.diagnostics.filter((d) => d.severity === 'error').length

  return (
    <div className={className ?? 'flex h-full min-h-0 flex-col'} data-testid="django-pane">
      <div className="erd-bar">
        <span className="erd-bar__title">models.py</span>
        <span data-testid="django-status" className="erd-muted">
          {sync.dirty ? 'syncing…' : errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'synced'}
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          data-testid="django-readonly-toggle"
          aria-pressed={readOnly}
          onClick={() => setReadOnly((v) => !v)}
          title={readOnly ? 'Enable editing' : 'Make read-only'}
        >
          {readOnly ? 'Read-only' : 'Editable'}
        </Button>
        <CopyButton text={() => sync.text} label="models.py" />
      </div>
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          ref={handle}
          testId="django-editor"
          value={sync.text}
          onChange={sync.onChange}
          onFocus={() => {
            void ensureParser()
            sync.onFocus()
          }}
          onBlur={() => void sync.onBlur()}
          extensions={extensions}
          diagnostics={sync.diagnostics}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

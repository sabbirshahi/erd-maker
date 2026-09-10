/**
 * Django models.py pane: generated from the schema; editable once worker-4's parser lands.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { python } from '@codemirror/lang-python'
import { generateDjango, initDjangoParser, parseDjango, type DjangoParseResult } from '@/core/django'
import type { Diagnostic, Schema } from '@/core/schema'
import { reconcile } from '@/core/reconcile'
import { useSchemaStore } from '@/store'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { useTextSync } from './useTextSync'
import { CopyButton } from '@/app/CopyButton'
import { useGotoLine } from './goto'

export interface DjangoEditorProps {
  className?: string
}

const STUB_MARKER = 'not implemented'

/** Generate models.py and publish the generator's (typemap) diagnostics. */
function generateWithDiagnostics(schema: Schema): string {
  const result = generateDjango(schema)
  const state = useSchemaStore.getState()
  // Avoid redundant store writes when nothing changed.
  const prev = state.diagnostics.typemap
  const same =
    prev.length === result.diagnostics.length &&
    prev.every((d, i) => d.message === result.diagnostics[i].message && d.severity === result.diagnostics[i].severity)
  if (!same) state.setDiagnostics('typemap', result.diagnostics)
  return result.text
}

export function DjangoEditor({ className }: DjangoEditorProps) {
  const handle = useRef<CodeMirrorEditorHandle>(null)
  const [parserMissing, setParserMissing] = useState<boolean | null>(null)
  const [userReadOnly, setUserReadOnly] = useState(false)
  const initStarted = useRef(false)

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
      const result: DjangoParseResult = await parseDjango(text)
      if (result.diagnostics.some((d: Diagnostic) => d.message.includes(STUB_MARKER))) {
        setParserMissing(true)
        // Don't surface the stub as a user-facing error; the pane is read-only instead.
        return { diagnostics: [] }
      }
      return result
    },
    generate: generateWithDiagnostics,
    reconcile,
  })
  const extensions = useMemo(() => [python()], [])
  useGotoLine('django', handle)

  // Probe the parser once so the read-only badge is right before the user types.
  useEffect(() => {
    let cancelled = false
    parseDjango('# probe\n')
      .then((r: DjangoParseResult) => {
        if (!cancelled) setParserMissing(r.diagnostics.some((d: Diagnostic) => d.message.includes(STUB_MARKER)))
      })
      .catch(() => {
        if (!cancelled) setParserMissing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Publish typemap diagnostics for the initial schema too.
  useEffect(() => {
    generateWithDiagnostics(useSchemaStore.getState().schema)
  }, [])

  useEffect(() => () => void sync.flush(), [sync])

  const readOnly = userReadOnly || parserMissing === true
  const errors = sync.diagnostics.filter((d) => d.severity === 'error').length

  return (
    <div className={className ?? 'flex h-full min-h-0 flex-col'} data-testid="django-pane">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <span className="font-medium">models.py</span>
        <span data-testid="django-status" className="text-zinc-400">
          {sync.dirty ? 'syncing…' : errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'synced'}
        </span>
        {parserMissing && (
          <span
            data-testid="django-readonly-badge"
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            title="Editing models.py will be enabled when the Django parser lands"
          >
            read-only until parser lands
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          data-testid="django-readonly-toggle"
          aria-pressed={readOnly}
          disabled={parserMissing === true}
          onClick={() => setUserReadOnly((v) => !v)}
          className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          title={readOnly ? 'Enable editing' : 'Make read-only'}
        >
          {readOnly ? 'Read-only' : 'Editable'}
        </button>
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

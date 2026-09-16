/**
 * DBML pane: CodeMirror + two-way sync with the schema store (plan §3 Phase 3).
 */
import { useEffect, useMemo, useRef } from 'react'
import { parseDbml, generateDbml } from '@/core/dbml'
import { reconcile } from '@/core/reconcile'
import { useSchemaStore } from '@/store'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { dbml } from './dbml-language'
import { useTextSync } from './useTextSync'
import { CopyButton } from '@/app/CopyButton'
import { useGotoLine } from './goto'

export interface DbmlEditorProps {
  className?: string
  /** Soft-wrap long lines rather than scrolling them sideways. */
  wrap?: boolean
}

export function DbmlEditor({ className, wrap }: DbmlEditorProps) {
  const handle = useRef<CodeMirrorEditorHandle>(null)
  const sync = useTextSync({
    view: 'dbml',
    parse: (text) => parseDbml(text),
    generate: (schema) => generateDbml(schema),
    reconcile,
  })
  const extensions = useMemo(() => [dbml(() => useSchemaStore.getState().schema)], [])
  useGotoLine('dbml', handle)

  // Flush pending edits when the pane unmounts (e.g. tab switch) so nothing is lost.
  useEffect(() => () => void sync.flush(), [sync])

  const errors = sync.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = sync.diagnostics.filter((d) => d.severity === 'warning').length

  return (
    <div className={className ?? 'flex h-full min-h-0 flex-col'} data-testid="dbml-pane">
      <div className="erd-bar">
        <span className="erd-bar__title">DBML</span>
        <span data-testid="dbml-status" className="erd-muted">
          {sync.dirty ? 'syncing…' : errors ? `${errors} error${errors === 1 ? '' : 's'}` : warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'synced'}
        </span>
        <span className="flex-1" />
        <CopyButton text={() => sync.text} label="DBML" />
      </div>
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          ref={handle}
          testId="dbml-editor"
          value={sync.text}
          onChange={sync.onChange}
          onFocus={sync.onFocus}
          onBlur={() => void sync.onBlur()}
          extensions={extensions}
          diagnostics={sync.diagnostics}
          wrap={wrap}
        />
      </div>
    </div>
  )
}

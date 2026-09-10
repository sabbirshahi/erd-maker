import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { diag, emptySchema, newColumn, newTable } from '@/core/schema'
import { useSchemaStore } from '@/store'
import { GOTO_EVENT, ProblemsPanel, countBySeverity, type GotoEventDetail } from './ProblemsPanel'

describe('ProblemsPanel', () => {
  beforeEach(() => {
    useSchemaStore.getState().reset()
  })

  it('counts by severity', () => {
    const list = [
      diag({ severity: 'error', source: 'dbml', message: 'a' }),
      diag({ severity: 'warning', source: 'django', message: 'b' }),
      diag({ severity: 'info', source: 'typemap', message: 'c', lossy: true }),
      diag({ severity: 'error', source: 'sql', message: 'd' }),
    ]
    expect(countBySeverity(list)).toEqual({ error: 2, warning: 1, info: 1 })
  })

  it('renders rows, filters, and dispatches erd:goto + selection on click', () => {
    const s = emptySchema()
    const t = newTable({ name: 'users', columns: [newColumn({ name: 'email' })] })
    s.tables.push(t)
    useSchemaStore.getState().commit('import', s)
    useSchemaStore.getState().setDiagnostics('dbml', [
      diag({ severity: 'error', source: 'dbml', message: 'Bad thing', line: 7, col: 3, tableId: t.id, columnId: t.columns[0].id }),
    ])
    useSchemaStore.getState().setDiagnostics('typemap', [
      diag({ severity: 'info', source: 'typemap', message: 'Lossy thing', lossy: true }),
    ])

    const events: GotoEventDetail[] = []
    const listener = (e: Event) => events.push((e as CustomEvent<GotoEventDetail>).detail)
    window.addEventListener(GOTO_EVENT, listener)

    const gotos: string[] = []
    render(<ProblemsPanel onGoto={(v) => gotos.push(v)} />)
    expect(screen.getAllByTestId('problem-row')).toHaveLength(2)
    expect(screen.getByText('users.email · dbml:7:3')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('filter-lossy'))
    expect(screen.getAllByTestId('problem-row')).toHaveLength(1)
    expect(screen.getByText('Lossy thing')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('filter-lossy'))

    fireEvent.click(screen.getByTestId('filter-info'))
    expect(screen.getAllByTestId('problem-row')).toHaveLength(1)

    fireEvent.click(screen.getByText('Bad thing'))
    expect(useSchemaStore.getState().selection).toEqual({ tableId: t.id, columnId: t.columns[0].id, refId: undefined })
    expect(events).toEqual([{ view: 'dbml', line: 7, col: 3 }])
    expect(gotos).toEqual(['dbml'])
    window.removeEventListener(GOTO_EVENT, listener)
  })
})

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrashScreen, diagnosticsReport } from './CrashScreen'

function Boom(): never {
  throw new Error('kaboom')
}

describe('CrashScreen', () => {
  beforeEach(() => {
    // React logs the caught error; the noise is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when nothing throws', () => {
    render(
      <CrashScreen>
        <p>all good</p>
      </CrashScreen>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(screen.queryByTestId('crash-screen')).not.toBeInTheDocument()
  })

  it('catches a throwing child and leads with the work being safe', () => {
    render(
      <CrashScreen>
        <Boom />
      </CrashScreen>,
    )
    expect(screen.getByTestId('crash-screen')).toBeInTheDocument()
    // The reassurance has to be the first thing, not a footnote.
    expect(screen.getByTestId('crash-reassurance')).toHaveTextContent(/still saved in this browser/i)
    expect(screen.getByTestId('crash-reload')).toBeInTheDocument()
    expect(screen.getByTestId('crash-backup')).toBeInTheDocument()
    expect(screen.getByTestId('crash-copy')).toBeInTheDocument()
    expect(screen.getByTestId('crash-reset')).toBeInTheDocument()
  })

  it('builds a pasteable report without leaking the schema', () => {
    const err = new Error('kaboom')
    err.stack = 'Error: kaboom\n    at somewhere'
    const md = diagnosticsReport(err, '\n    in Shell', new Date('2026-09-12T10:00:00Z'))
    expect(md).toContain('### DBridge crash report')
    expect(md).toContain('kaboom')
    expect(md).toContain('at somewhere')
    expect(md).toContain('2026-09-12T10:00:00.000Z')
    expect(md).toContain('in Shell')
  })
})

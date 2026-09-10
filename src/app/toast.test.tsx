import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from './CopyButton'
import { Toaster, clearToasts, dismiss, toast } from './toast'

describe('toast + CopyButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearToasts()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast for ~2 s then removes it', () => {
    render(<Toaster />)
    act(() => {
      toast('Hello')
    })
    expect(screen.getByText('Hello')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2100)
    })
    expect(screen.queryByText('Hello')).toBeNull()
  })

  it('dismiss is idempotent', () => {
    render(<Toaster />)
    let id = 0
    act(() => {
      id = toast('Bye')
    })
    act(() => {
      dismiss(id)
      dismiss(id)
    })
    expect(screen.queryByText('Bye')).toBeNull()
  })

  it('CopyButton writes the clipboard and toasts "Copied {label}"', async () => {
    const writes: string[] = []
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void writes.push(t) } })
    render(
      <>
        <CopyButton text={() => 'Table x {}'} label="DBML" />
        <Toaster />
      </>,
    )
    await act(async () => {
      screen.getByTestId('copy-dbml').click()
    })
    expect(writes).toEqual(['Table x {}'])
    expect(screen.getByText('Copied DBML')).toBeInTheDocument()
  })
})

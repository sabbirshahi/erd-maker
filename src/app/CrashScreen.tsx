/**
 * Shell-level backstop. Individual panes have their own boundaries (see docs/briefs/worker-6-app.md);
 * this one catches whatever gets past them, including a failure in the shell itself.
 *
 * The point it has to make first is that the user's work is still there. Diagrams live in this
 * browser's localStorage and nothing here touches them, but a white screen in an app with no
 * accounts and no server reads as "everything is gone", so the screen says so before anything else
 * and offers a backup download on the spot.
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import './shell.css'
import { backupFilename, buildBackup, serializeBackup } from './backup'
import { downloadText } from './exportPng'
import { listProjects } from './projects'

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/** A markdown block that can be pasted straight into a GitHub issue. Nothing is uploaded. */
export function diagnosticsReport(error: Error, componentStack?: string, now = new Date()): string {
  const ua = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent
  return [
    '### DBridge crash report',
    '',
    `- Version: ${APP_VERSION}`,
    `- When: ${now.toISOString()}`,
    `- Browser: ${ua}`,
    '',
    '```',
    `${error.name}: ${error.message}`,
    (error.stack ?? '(no stack)').trim(),
    componentStack ? `\nComponent stack:${componentStack}` : '',
    '```',
  ].join('\n')
}

function Actions({ error, componentStack }: { error: Error; componentStack?: string }) {
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  const count = safeProjectCount()

  const downloadBackup = () => {
    try {
      downloadText(serializeBackup(buildBackup()), backupFilename(), 'application/json')
    } catch {
      window.alert('Could not build a backup from this browser’s storage.')
    }
  }

  const copyDiagnostics = () => {
    void navigator.clipboard
      .writeText(diagnosticsReport(error, componentStack))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => window.alert('Could not reach the clipboard.'))
  }

  const reset = () => {
    if (!window.confirm('Download a backup first?\n\nOK downloads one now. Cancel skips it.')) {
      // Skipping is allowed, but not by accident.
    } else {
      downloadBackup()
    }
    if (!window.confirm(`Delete all ${count} diagram(s) stored in this browser? This cannot be undone.`)) return
    setResetting(true)
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* storage already unavailable: reloading is the best that is left */
    }
    location.reload()
  }

  return (
    <>
      <div className="erd-crash__actions">
        <button type="button" className="erd-b erd-b--primary" data-testid="crash-reload" onClick={() => location.reload()}>
          Reload
        </button>
        <button type="button" className="erd-b erd-b--outline" data-testid="crash-backup" onClick={downloadBackup}>
          Download backup
        </button>
        <button type="button" className="erd-b erd-b--outline" data-testid="crash-copy" onClick={copyDiagnostics}>
          {copied ? 'Copied' : 'Copy diagnostics'}
        </button>
      </div>

      <details className="erd-crash__details" data-testid="crash-details">
        <summary>What went wrong</summary>
        <pre>{`${error.name}: ${error.message}`}</pre>
      </details>

      <div className="erd-crash__reset">
        <p>
          Still broken after a reload? Clearing this browser’s stored data is the last resort. It
          deletes every diagram saved here, so download the backup first.
        </p>
        <button type="button" className="erd-b erd-b--sm erd-b--danger" data-testid="crash-reset" disabled={resetting} onClick={reset}>
          Reset app state
        </button>
      </div>
    </>
  )
}

function safeProjectCount(): number {
  try {
    return listProjects().length
  } catch {
    return 0
  }
}

export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null; componentStack?: string }> {
  state: { error: Error | null; componentStack?: string } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, componentStack: info.componentStack ?? undefined })
    // Nothing is reported anywhere; the console is the only place this goes.
    console.error('DBridge crashed', error, info.componentStack)
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return (
      <div className="erd-crash" data-testid="crash-screen" role="alert">
        <div className="erd-crash__card">
          <h1 className="erd-crash__title">DBridge hit an unexpected error</h1>
          <p className="erd-crash__safe" data-testid="crash-reassurance">
            Your diagrams are still saved in this browser. Nothing has been deleted, and nothing was
            sent anywhere.
          </p>
          <Actions error={error} componentStack={componentStack} />
        </div>
      </div>
    )
  }
}

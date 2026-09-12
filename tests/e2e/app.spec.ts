import { expect, test, type Page } from '@playwright/test'
import { openExamples } from './helpers'

const URL = '/?e2e'

async function tableNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__erd!.store.getState().schema.tables.map((t) => t.name))
}

/** Toasts stack (e.g. "Loaded example" + "Copied"), so match the one we care about. */
const toastWith = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text })

test.describe('app shell', () => {
  test('fresh profile shows the empty state; Start blank hides it', async ({ page }) => {
    await page.goto(URL)
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId('topbar')).toContainText('DBridge')
    await expect(page.getByRole('tab', { name: 'DBML' })).toBeVisible()
    await page.getByTestId('start-blank').click()
    await expect(page.getByTestId('empty-state')).toBeHidden()
  })

  test('loads the Blog example with zero errors, autosaves, and restores after reload', async ({ page }) => {
    await page.goto(URL)
    await page.getByTestId('empty-examples').click()
    await expect(page.getByTestId('examples-gallery')).toBeVisible()
    await page.getByTestId('example-blog').click()
    await expect(page.getByTestId('examples-gallery')).toBeHidden()
    await expect(page.getByTestId('empty-state')).toBeHidden()
    await expect.poll(() => tableNames(page)).toEqual(['users', 'posts', 'tags', 'comments'])

    // Tables render on the canvas (one React Flow node per table).
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('table-node')).toHaveCount(4)

    // Zero error diagnostics.
    await page.waitForTimeout(600)
    const errors = await page.evaluate(() =>
      Object.values(window.__erd!.store.getState().diagnostics).flat().filter((d) => d.severity === 'error').length,
    )
    expect(errors).toBe(0)

    // Autosave writes into the tab's active project → reload restores it.
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('dbridge:project:'))))
      .toBe(true)
    await page.reload()
    await expect.poll(() => tableNames(page)).toEqual(['users', 'posts', 'tags', 'comments'])
    await expect(page.getByTestId('empty-state')).toBeHidden()
  })

  test('share link opens the same schema in a fresh context', async ({ page, browser }) => {
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-school').click()
    await expect.poll(() => tableNames(page)).toContain('students')

    await page.getByTestId('btn-share').click()
    await expect(toastWith(page, 'Share link copied')).toBeVisible()
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toContain('#d=')

    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const other = await ctx.newPage()
    await other.goto(url.replace(/^https?:\/\/[^/]+/, '') + (url.includes('e2e') ? '' : ''))
    await expect.poll(() => tableNames(other)).toEqual(await tableNames(page))
    // Hash is cleared after load so reloads use autosave.
    expect(await other.evaluate(() => location.hash)).toBe('')
    await ctx.close()
  })

  test('Problems panel shows a count badge and rows', async ({ page }) => {
    await page.goto(URL)
    // Use the 'sql' bucket: the editors/canvas own 'dbml' / 'django' / 'typemap' / 'canvas' and
    // rewrite them on every schema change, which would wipe injected test diagnostics.
    await page.evaluate(() => {
      const s = window.__erd!.store.getState()
      s.setDiagnostics('sql', [
        { id: 'e2e-1', severity: 'warning', source: 'sql', message: 'e2e warning', lossy: true },
        { id: 'e2e-2', severity: 'error', source: 'sql', message: 'e2e error', line: 1 },
      ])
    })
    await expect(page.getByTestId('problems-badge')).toHaveText('2')
    await page.getByTestId('tab-problems').click()
    await expect(page.getByTestId('problem-row')).toHaveCount(2)
    await page.getByTestId('filter-lossy').check()
    await expect(page.getByTestId('problem-row')).toHaveCount(1)
    await expect(page.getByTestId('problem-row')).toContainText('e2e warning')
  })

  test('Copy button writes the clipboard and toasts', async ({ page }) => {
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-blog').click()
    await expect.poll(() => tableNames(page)).toContain('users')
    const copy = page.getByTestId('copy-dbml').first()
    await expect(copy).toBeVisible()
    await copy.click()
    await expect(toastWith(page, 'Copied DBML')).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain('Table users')
  })

  test('dark mode toggles and persists across reloads', async ({ page }) => {
    await page.goto(URL)
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
    const before = await isDark()
    await page.getByTestId('btn-theme').click()
    expect(await isDark()).toBe(!before)
    expect(await page.evaluate(() => localStorage.getItem('dbridge:theme'))).toBe(before ? 'light' : 'dark')
    await page.reload()
    expect(await isDark()).toBe(!before)
  })

  test('right pane tabs mount the real DBML, Django and SQL panes', async ({ page }) => {
    await page.goto(URL)
    await expect(page.getByTestId('dbml-pane')).toBeVisible()
    await page.getByRole('tab', { name: 'Django' }).click()
    await expect(page.getByTestId('django-pane')).toBeVisible()
    await page.getByRole('tab', { name: 'SQL' }).click()
    await expect(page.getByTestId('demo-panel')).toBeVisible()
    await expect(page.locator('[data-testid^="placeholder-"]')).toHaveCount(0)
  })

  test('Export PNG downloads a rendered image of the canvas', async ({ page }) => {
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-blog').click()
    await expect(page.getByTestId('table-node')).toHaveCount(4)
    await page.getByTestId('btn-export').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('menu-export-png').click()
    const file = await download
    expect(file.suggestedFilename()).toBe('erd.png')
    const path = await file.path()
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(path)
    // PNG signature + a non-trivial payload (an empty/blank export would be tiny).
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(bytes.length).toBeGreaterThan(5_000)
    await expect(toastWith(page, 'Exported PNG')).toBeVisible()
  })

  test('Export menu offers PNG/JSON/DBML and undo reverts a load', async ({ page }) => {
    await page.goto(URL)
    await page.getByTestId('btn-export').click()
    await expect(page.getByTestId('menu-export-png')).toBeVisible()
    await expect(page.getByTestId('menu-export-json')).toBeVisible()
    await page.keyboard.press('Escape')
    await openExamples(page)
    await page.getByTestId('example-ecommerce').click()
    await expect.poll(() => tableNames(page)).toContain('orders')
    await page.getByTestId('btn-undo').click()
    await expect.poll(() => tableNames(page)).toEqual([])
    await page.getByTestId('btn-redo').click()
    await expect.poll(() => tableNames(page)).toContain('orders')
  })
})

test.describe('crash screen', () => {
  test('a shell-level failure keeps the diagrams and offers a backup', async ({ page }) => {
    // Seed a diagram, then crash on the next load: the screen must not imply it was lost.
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-blog').click()
    await expect(page.getByTestId('table-node').first()).toBeVisible()

    await page.goto('/?e2e&crash=1')
    await expect(page.getByTestId('crash-screen')).toBeVisible()
    await expect(page.getByTestId('crash-reassurance')).toContainText('still saved in this browser')

    // The backup button produces a real file containing the diagram that was already there.
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('crash-backup').click(),
    ]).then(([d]) => d)
    expect(download.suggestedFilename()).toMatch(/^dbridge-backup-\d{4}-\d{2}-\d{2}\.json$/)

    // Reload gets the user back to a working app with the diagram intact.
    await page.getByTestId('crash-reload').click()
    await page.goto(URL)
    await expect(page.getByTestId('table-node').first()).toBeVisible()
  })
})

test.describe('workspace backup', () => {
  test('backup downloads every diagram and restoring adds them back without overwriting', async ({ page }) => {
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-blog').click()
    await expect(page.getByTestId('table-node').first()).toBeVisible()
    const before = await page.evaluate(() => window.__erd!.store.getState().schema.tables.length)
    expect(before).toBeGreaterThan(0)

    await page.getByTestId('btn-project').click()
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('menu-backup-download').click(),
    ]).then(([d]) => d)
    const file = await download.path()

    const diagramsBefore = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('dbridge:projects:v1')!).projects.length,
    )

    // Restoring the same file adds copies; the originals stay put.
    await page.getByTestId('btn-project').click()
    await page.getByTestId('menu-backup-restore').click()
    await page.getByTestId('restore-backup-input').setInputFiles(file)
    await expect(toastWith(page, 'imported')).toBeVisible()

    const diagramsAfter = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('dbridge:projects:v1')!).projects.length,
    )
    expect(diagramsAfter).toBe(diagramsBefore * 2)
    // The diagram on screen is untouched by the restore.
    expect(await page.evaluate(() => window.__erd!.store.getState().schema.tables.length)).toBe(before)
  })

  test('a file that is not a backup is refused with a reason', async ({ page }) => {
    await page.goto(URL)
    await page.getByTestId('btn-project').click()
    await page.getByTestId('menu-backup-restore').click()
    await page.getByTestId('restore-backup-input').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":"world"}'),
    })
    await expect(toastWith(page, 'not a DBridge backup')).toBeVisible()
  })
})

test.describe('shortcuts help', () => {
  test('? opens the list, but not while typing in an editor', async ({ page }) => {
    await page.goto(URL)
    await page.getByTestId('start-blank').click()

    await page.keyboard.press('?')
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('shortcuts-dialog')).toBeHidden()

    // Inside the DBML editor '?' is just a character. Both editors are mounted (the inactive one
    // is hidden), so the DBML one has to be named rather than matched by class alone.
    const dbml = page.locator('[data-language="dbml"]')
    await dbml.click()
    await page.keyboard.type('?')
    await expect(page.getByTestId('shortcuts-dialog')).toBeHidden()
    await expect(dbml).toContainText('?')
  })

  test('the list is also reachable from the menu', async ({ page }) => {
    await page.goto(URL)
    await page.getByTestId('btn-project').click()
    await page.getByTestId('menu-shortcuts').click()
    await expect(page.getByTestId('shortcuts-dialog')).toContainText('Add a table')
  })
})

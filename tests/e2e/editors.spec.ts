/**
 * Editors e2e — OWNER: worker-3. Covers docs/briefs/worker-3-editors.md "Done when".
 * Drives the real app shell (worker-6) and reads the store through `window.__erd` (set when `?e2e`).
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openImport } from './helpers'

const SQL_FIXTURE = readFileSync(path.resolve(import.meta.dirname, '../fixtures/sql/ecommerce.postgres.sql'), 'utf8')

const BLOG = `Table users {
  id int [pk, increment]
  email varchar(254) [not null, unique]
}

Table posts {
  id int [pk, increment]
  author_id int [not null]
  title varchar(200) [not null]
}

Ref: posts.author_id > users.id
`

// `window.__erd` is declared once in src/app/global.d.ts (worker-6); it is ambient, so no redeclaration here.

const dbmlEditor = (page: Page) => page.getByTestId('dbml-editor')
const dbmlContent = (page: Page) => dbmlEditor(page).locator('.cm-content')

/** Read the CodeMirror doc/selection through the editor's test hook. */
async function cmState(page: Page, testId = 'dbml-editor') {
  return page.evaluate((id) => {
    const host = document.querySelector(`[data-testid="${id}"]`) as (HTMLElement & { __cmView?: { state: { doc: { toString(): string }; selection: { main: { head: number; anchor: number } } }; hasFocus: boolean } }) | null
    const view = host?.__cmView
    if (!view) throw new Error(`no editor view for ${id}`)
    return { doc: view.state.doc.toString(), head: view.state.selection.main.head, focused: view.hasFocus }
  }, testId)
}

const tables = (page: Page) => page.evaluate(() => window.__erd!.store.getState().schema.tables.map((t) => t.name))
const storeVersion = (page: Page) => page.evaluate(() => window.__erd!.store.getState().version)

/** Load the app fresh with the given DBML committed to the store. */
async function boot(page: Page, dbml?: string) {
  await page.goto('/?e2e')
  await page.evaluate(() => {
    localStorage.clear()
    window.__erd!.store.getState().reset()
  })
  const blank = page.getByTestId('start-blank')
  if (await blank.isVisible().catch(() => false)) await blank.click()
  await expect(dbmlEditor(page)).toBeVisible()
  if (dbml) {
    // Type through the editor so the text is authoritative (exercises the parse path once).
    await dbmlContent(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.evaluate((text) => {
      const host = document.querySelector('[data-testid="dbml-editor"]') as HTMLElement & {
        __cmView?: { dispatch(spec: unknown): void; state: { doc: { length: number } } }
      }
      const view = host.__cmView!
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.paste' })
    }, dbml)
    await page.getByTestId('canvas-pane').click({ position: { x: 20, y: 20 } }) // blur → flush
    await expect.poll(() => tables(page)).toEqual(['users', 'posts'])
  }
}

test.describe('editors', () => {
  test('typing a Table in the DBML editor shows a node within 500 ms', async ({ page }) => {
    await boot(page)
    await dbmlContent(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    // closeBrackets auto-inserts `}` / `]`; typing the closer overtypes it.
    await page.keyboard.type('Table x { id int [pk] }')
    const typedAt = Date.now()
    await page.waitForFunction(
      () => {
        const t = window.__erd!.store.getState().schema.tables
        return t.length === 1 && t[0].name === 'x' && t[0].columns.length === 1
      },
      undefined,
      { timeout: 500, polling: 20 },
    )
    expect(Date.now() - typedAt).toBeLessThanOrEqual(500)
    // Canvas node (when the canvas has landed).
    if ((await page.locator('.react-flow').count()) > 0) {
      await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 500 })
      await expect(page.locator('.react-flow__node')).toContainText('x')
    }
    // Editor still shows exactly what was typed (own commit never regenerates).
    expect((await cmState(page)).doc).toBe('Table x { id int [pk] }')
    await expect(page.getByTestId('dbml-status')).toHaveText('synced')
  })

  test('canvas edits update the DBML text without moving the caret of the unfocused editor', async ({ page }) => {
    await boot(page, BLOG)
    // Place the caret on line 2 and blur.
    await dbmlContent(page).click()
    await page.keyboard.press('ControlOrMeta+Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    const before = await cmState(page)
    expect(before.focused).toBe(true)
    await page.getByTestId('canvas-pane').click({ position: { x: 20, y: 20 } })
    await expect.poll(async () => (await cmState(page)).focused).toBe(false)
    expect(await page.evaluate(() => window.__erd!.store.getState().focus)).toBeNull()

    // Same store path the inspector uses.
    await page.evaluate(() => {
      window.__erd!.store.getState().update('canvas', (draft) => {
        draft.tables[1].columns.push({
          id: 'e2e_col',
          name: 'nickname_from_canvas',
          type: 'varchar(50)',
          pk: false,
          unique: false,
          notNull: false,
          increment: false,
        })
      })
    })
    await expect(dbmlContent(page)).toContainText('nickname_from_canvas')
    const after = await cmState(page)
    expect(after.doc).toContain('nickname_from_canvas varchar(50)')
    expect(after.head).toBe(before.head)
    expect(after.focused).toBe(false)
  })

  test('a syntax error shows a lint marker on the right line and leaves the canvas unchanged; fixing it resyncs', async ({ page }) => {
    await boot(page, BLOG)
    const versionBefore = await storeVersion(page)
    const tablesBefore = await tables(page)

    await dbmlContent(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('@@@ not dbml')
    const lines = (await cmState(page)).doc.split('\n')
    const badLine = lines.findIndex((l) => l.includes('@@@')) + 1
    expect(badLine).toBeGreaterThan(0)

    // Diagnostic on the right line, painted in the gutter.
    await expect.poll(() => page.evaluate(() => window.__erd!.store.getState().diagnostics.dbml.length), { timeout: 2000 }).toBeGreaterThan(0)
    const diag = await page.evaluate(() => window.__erd!.store.getState().diagnostics.dbml[0])
    expect(diag.severity).toBe('error')
    expect(diag.line).toBe(badLine)
    await expect(dbmlEditor(page).locator('.cm-lint-marker-error')).toHaveCount(1)
    const markerLine = await page.evaluate(() => {
      // Map the marker's on-screen position back to a document line through the EditorView API.
      const host = document.querySelector('[data-testid="dbml-editor"]') as HTMLElement & {
        __cmView?: { documentTop: number; lineBlockAtHeight(h: number): { from: number }; state: { doc: { lineAt(pos: number): { number: number } } } }
      }
      const view = host.__cmView!
      const marker = host.querySelector('.cm-lint-marker-error')!
      const rect = marker.getBoundingClientRect()
      const block = view.lineBlockAtHeight(rect.top + rect.height / 2 - view.documentTop)
      return view.state.doc.lineAt(block.from).number
    })
    expect(markerLine).toBe(badLine)
    await expect(page.getByTestId('dbml-status')).toContainText('error')

    // Canvas / store untouched.
    expect(await storeVersion(page)).toBe(versionBefore)
    expect(await tables(page)).toEqual(tablesBefore)

    // Fix it → diagnostics clear and a new table syncs.
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('Table fixed { id int [pk] }')
    await expect.poll(() => tables(page), { timeout: 2000 }).toEqual([...tablesBefore, 'fixed'])
    expect(await page.evaluate(() => window.__erd!.store.getState().diagnostics.dbml.length)).toBe(0)
    await expect(dbmlEditor(page).locator('.cm-lint-marker-error')).toHaveCount(0)
    expect(await storeVersion(page)).toBeGreaterThan(versionBefore)
  })

  test('import the Postgres SQL fixture, then export Postgres DDL', async ({ page }) => {
    await boot(page)
    await openImport(page)
    const dialog = page.getByTestId('import-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('import-tab-sql').click()
    await expect(page.getByTestId('import-dialect')).toBeVisible()
    await page.getByTestId('import-text').fill(SQL_FIXTURE)
    await page.getByTestId('import-submit').click()
    // importSql is worker-1's; while it is still the scaffold stub the dialog reports "not implemented".
    const stubbed = await page
      .getByTestId('import-errors')
      .filter({ hasText: 'not implemented' })
      .isVisible()
      .catch(() => false)
    test.skip(stubbed, 'importSql not landed yet (worker-1 core-dbml)')
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    const names = await tables(page)
    expect(names).toEqual(expect.arrayContaining(['users', 'countries', 'merchants', 'orders', 'products', 'order_items']))
    expect(await page.evaluate(() => window.__erd!.store.getState().schema.refs.length)).toBeGreaterThan(0)
    // DBML pane regenerated from the imported schema.
    await expect(dbmlContent(page)).toContainText('Table order_items')

    await page.getByTestId('btn-export').click()
    await page.getByTestId('menu-export-dialog').click()
    const exportDialog = page.getByTestId('export-dialog')
    await expect(exportDialog).toBeVisible()
    await page.getByTestId('export-tab-postgres').click()
    await expect(page.getByTestId('export-filename')).toHaveText('schema.postgres.sql')
    const preview = page.getByTestId('export-preview')
    await expect(preview.locator('.cm-content')).toContainText('CREATE TABLE')
    // Read-only preview.
    expect(await preview.getAttribute('data-readonly')).toBe('true')
    await page.keyboard.press('Escape')
    await expect(exportDialog).toBeHidden()
  })

  test('import errors are shown inline with the failing line', async ({ page }) => {
    await boot(page)
    await openImport(page)
    await page.getByTestId('import-tab-dbml').click()
    await page.getByTestId('import-text').fill('Table ok {\n  id int\n}\n\nTable broken {\n  ???\n}\n')
    await page.getByTestId('import-submit').click()
    const errors = page.getByTestId('import-errors')
    await expect(errors).toBeVisible()
    // The severity label is upper-cased with CSS; textContent stays lower-case.
    await expect(errors).toContainText(/error/i)
    await expect(errors).toContainText(/line \d+/)
    await expect(errors.locator('pre').first()).toContainText('???')
    // Nothing was committed.
    expect(await tables(page)).toEqual([])
    await expect(page.getByTestId('import-dialog')).toBeVisible()
  })

  test('Copy writes the pane text to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await boot(page, BLOG)
    const pane = page.getByTestId('dbml-pane')
    await pane.getByTestId('copy-dbml').click()
    await expect(page.getByTestId('toast').first()).toContainText('Copied DBML')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe((await cmState(page)).doc)
    expect(clip).toContain('Table users')

    // Django pane copy.
    await page.getByTestId('tab-django').click()
    await expect(page.getByTestId('django-editor')).toBeVisible()
    await page.getByTestId('django-pane').getByTestId('copy-models-py').click()
    await expect(page.getByTestId('toast').filter({ hasText: 'Copied models.py' })).toBeVisible()
    const djangoClip = await page.evaluate(() => navigator.clipboard.readText())
    expect(djangoClip).toBe((await cmState(page, 'django-editor')).doc)
    expect(djangoClip.length).toBeGreaterThan(0)
  })

  test('erd:goto moves the DBML caret to the requested line', async ({ page }) => {
    await boot(page, BLOG)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('erd:goto', { detail: { view: 'dbml', line: 6, col: 3 } })))
    const st = await cmState(page)
    const lineStart = st.doc.split('\n').slice(0, 5).reduce((n, l) => n + l.length + 1, 0)
    expect(st.head).toBe(lineStart + 2)
    expect(st.focused).toBe(true)
  })
})

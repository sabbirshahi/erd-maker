/**
 * Demo e2e — OWNER: worker-5. Covers docs/briefs/worker-5-demo.md "Done when".
 * Boots the real Pyodide + Django runtime from the CDN, so it needs network access
 * and is marked slow (3× the default timeout).
 */
import { expect, test, type Page } from '@playwright/test'
import { openExamples } from './helpers'

const URL = '/?e2e'
const BOOT_TIMEOUT = 90_000

type ErdWindow = Window & {
  __erd?: {
    store: {
      getState(): {
        schema: { tables: Array<{ name: string; columns: unknown[] }> }
        version: number
        update(
          origin: string,
          mutate: (draft: { tables: Array<{ columns: unknown[] }> }) => void,
        ): void
      }
    }
  }
}

async function tableNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as ErdWindow).__erd!.store.getState().schema.tables.map((t) => t.name),
  )
}

/** Replace the contents of a CodeMirror editor through its test hook. */
async function setEditor(page: Page, testId: string, text: string): Promise<void> {
  await page.getByTestId(testId).waitFor()
  await page.evaluate(
    ([id, value]) => {
      const host = document.querySelector(`[data-testid="${id}"]`) as
        (HTMLElement & { __cmView?: unknown }) | null
      const view = host?.__cmView as
        { state: { doc: { length: number } }; dispatch(spec: unknown): void } | undefined
      if (!view) throw new Error(`no CodeMirror view for ${id}`)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    },
    [testId, text] as const,
  )
}

async function runSql(page: Page, query: string): Promise<void> {
  await page.getByTestId('demo-tab-sql').click()
  await setEditor(page, 'demo-editor-sql', query)
  await page.getByTestId('demo-run').click()
  await expect(page.getByTestId('demo-run')).toBeEnabled()
}

async function runOrm(page: Page, code: string): Promise<void> {
  await page.getByTestId('demo-tab-orm').click()
  await setEditor(page, 'demo-editor-orm', code)
  await page.getByTestId('demo-run').click()
  await expect(page.getByTestId('demo-run')).toBeEnabled()
}

function firstCell(page: Page) {
  return page.locator('[data-testid="demo-result"] tbody tr').first().locator('td').nth(1)
}

/** Acceptance criterion 5: Django system checks ran and reported nothing for the current build. */
async function expectChecksClean(page: Page): Promise<void> {
  await expect(page.getByTestId('demo-status')).toHaveAttribute('data-checks', '0')
  await expect(page.getByTestId('demo-status')).toContainText('checks OK')
  await expect(page.getByTestId('demo-checks')).toHaveCount(0)
}

async function addColumn(page: Page, name: string): Promise<void> {
  await page.evaluate((colName) => {
    const store = (window as ErdWindow).__erd!.store
    store.getState().update('canvas', (draft) => {
      draft.tables[0].columns.push({
        id: `e2e_${colName}`,
        name: colName,
        type: 'varchar(20)',
        pk: false,
        unique: false,
        notNull: false,
        increment: false,
      })
    })
  }, name)
}

test.describe('demo mode', () => {
  test('boots Django in the browser, runs SQL + ORM, survives errors, rebuilds twice', async ({
    page,
  }) => {
    test.slow()
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-blog').click()
    await expect.poll(() => tableNames(page)).toEqual(['users', 'posts', 'tags', 'comments'])

    await page.getByTestId('tab-demo').click()
    await expect(page.getByTestId('demo-panel')).toBeVisible()
    await expect(page.getByTestId('demo-status')).toHaveText('Not started')

    // Start → Ready within the budget (D19).
    const started = Date.now()
    await page.getByTestId('demo-start').click()
    await expect(page.getByTestId('demo-progress')).toBeVisible()
    await expect(page.getByTestId('demo-status')).toContainText('Ready', { timeout: BOOT_TIMEOUT })
    const bootMs = Date.now() - started
    console.log(`[demo e2e] boot+build took ${bootMs} ms`)
    expect(bootMs).toBeLessThanOrEqual(60_000)
    await expect(page.getByTestId('demo-status')).toContainText('demo_v1')
    await expect(page.getByTestId('demo-fatal')).toHaveCount(0)
    await expectChecksClean(page)

    // SELECT count(*) FROM users == slider value.
    const rows = Number(await page.getByTestId('demo-rows').inputValue())
    expect(rows).toBeGreaterThan(0)
    await runSql(page, 'SELECT count(*) FROM users')
    await expect(page.getByTestId('demo-rowcount')).toHaveText(/^1 row/)
    await expect(firstCell(page)).toHaveText(String(rows))

    // Join rows landed in Django's implicit M2M table.
    await runSql(page, 'SELECT count(*) FROM posts_tags')
    expect(Number(await firstCell(page).textContent())).toBeGreaterThan(0)

    // ORM count → int, and the executed SQL is shown.
    await runOrm(page, "User.objects.filter(email__contains='@').count()")
    await expect(firstCell(page)).toHaveText(/^\d+$/)
    expect(Number(await firstCell(page).textContent())).toBe(rows)
    await expect(page.getByTestId('demo-sql-out')).toContainText('SELECT COUNT(*)')
    await expect(page.getByTestId('demo-sql-out')).toContainText('"users"."email" LIKE')

    // QuerySet → grid with the model's columns.
    await runOrm(page, 'User.objects.order_by("id")[:3]')
    await expect(page.getByTestId('demo-rowcount')).toHaveText(/^3 rows/)
    await expect(page.locator('[data-testid="demo-result"] thead th').nth(1)).toHaveText('id')

    // Bad Python → traceback; the panel keeps working afterwards.
    await runOrm(page, 'User.objects.nope()')
    await expect(page.getByTestId('demo-error')).toContainText('Traceback')
    await expect(page.getByTestId('demo-error')).toContainText('AttributeError')
    await runOrm(page, 'x = 1\nprint("still alive")\nx + 1')
    await expect(page.getByTestId('demo-error')).toHaveCount(0)
    await expect(firstCell(page)).toHaveText('2')
    await expect(page.getByTestId('demo-stdout')).toContainText('still alive')

    // Schema change → banner → rebuild (twice in a row).
    await addColumn(page, 'nick1')
    await expect(page.getByTestId('demo-rebuild-banner')).toBeVisible()
    await page.getByTestId('demo-rebuild').click()
    await expect(page.getByTestId('demo-rebuild-banner')).toBeHidden({ timeout: BOOT_TIMEOUT })
    await expect(page.getByTestId('demo-status')).toContainText('demo_v2', {
      timeout: BOOT_TIMEOUT,
    })
    await expectChecksClean(page)
    await runSql(page, "SELECT count(*) FROM pragma_table_info('users') WHERE name = 'nick1'")
    await expect(firstCell(page)).toHaveText('1')

    await addColumn(page, 'nick2')
    await expect(page.getByTestId('demo-rebuild-banner')).toBeVisible()
    await page.getByTestId('demo-rebuild').click()
    await expect(page.getByTestId('demo-status')).toContainText('demo_v3', {
      timeout: BOOT_TIMEOUT,
    })
    await expectChecksClean(page)
    await runSql(
      page,
      "SELECT count(*) FROM pragma_table_info('users') WHERE name IN ('nick1', 'nick2')",
    )
    await expect(firstCell(page)).toHaveText('2')
    await runSql(page, 'SELECT count(*) FROM users')
    await expect(firstCell(page)).toHaveText(String(rows))

    // Referential integrity of the seed data.
    await runSql(page, 'PRAGMA foreign_key_check')
    await expect(page.getByTestId('demo-rowcount')).toHaveText(/^0 rows/)
    await expect(page.getByTestId('demo-fk-warning')).toHaveCount(0)

    // Regenerate with a different seed keeps the row count but changes the data.
    const before = await (async () => {
      await runSql(page, 'SELECT username FROM users ORDER BY id LIMIT 1')
      return firstCell(page).textContent()
    })()
    await page.getByTestId('demo-seed').fill('7')
    await page.getByTestId('demo-regenerate').click()
    await expect(page.getByTestId('demo-regenerate')).toBeEnabled({ timeout: BOOT_TIMEOUT })
    await runSql(page, 'SELECT username FROM users ORDER BY id LIMIT 1')
    expect(await firstCell(page).textContent()).not.toBe(before)
    await runSql(page, 'SELECT count(*) FROM users')
    await expect(firstCell(page)).toHaveText(String(rows))
  })

  test('E-commerce example: system checks are clean after build and rebuild', async ({ page }) => {
    test.slow()
    await page.goto(URL)
    await openExamples(page)
    await page.getByTestId('example-ecommerce').click()
    await expect.poll(() => tableNames(page)).toContain('order_items')

    await page.getByTestId('tab-demo').click()
    await page.getByTestId('demo-start').click()
    await expect(page.getByTestId('demo-status')).toContainText('Ready', { timeout: BOOT_TIMEOUT })
    await expect(page.getByTestId('demo-fatal')).toHaveCount(0)
    await expectChecksClean(page)

    // Every table got rows and the seed is referentially sound.
    await runSql(page, 'SELECT count(*) FROM order_items')
    expect(Number(await firstCell(page).textContent())).toBeGreaterThan(0)
    await runSql(page, 'PRAGMA foreign_key_check')
    await expect(page.getByTestId('demo-rowcount')).toHaveText(/^0 rows/)

    // Schema change → rebuild → checks still clean.
    await addColumn(page, 'loyalty_tier')
    await expect(page.getByTestId('demo-rebuild-banner')).toBeVisible()
    await page.getByTestId('demo-rebuild').click()
    await expect(page.getByTestId('demo-rebuild-banner')).toBeHidden({ timeout: BOOT_TIMEOUT })
    await expect(page.getByTestId('demo-status')).toContainText('Ready', { timeout: BOOT_TIMEOUT })
    await expectChecksClean(page)
    await runOrm(page, 'Customer.objects.count()')
    await expect(firstCell(page)).toHaveText(/^\d+$/)
  })
})

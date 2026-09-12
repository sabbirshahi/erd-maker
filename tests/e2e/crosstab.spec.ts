import { test, expect, type Page } from '@playwright/test'

const URL = '/?e2e=1'

async function bootNewProject(page: Page) {
  await page.goto(URL)
  await expect(page.getByTestId('shell')).toBeVisible()
}

const typeDbml = async (page: Page, text: string) => {
  await page.locator('[data-testid="dbml-pane"] .cm-content').first().click()
  await page.keyboard.type(text)
}

const tableNames = (page: Page) =>
  page.evaluate(() => window.__erd!.store.getState().schema.tables.map((t) => t.name))

test.describe('two tabs on one project', () => {
  test('an edit in one tab reaches the other without a reload', async ({ page, context }) => {
    await bootNewProject(page)
    await typeDbml(page, 'Table alpha {\n  id int [pk]')
    await expect.poll(() => tableNames(page)).toEqual(['alpha'])
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved')

    // Second tab opens the SAME project through its URL.
    const second = await context.newPage()
    await second.goto(page.url())
    await expect(second.getByTestId('shell')).toBeVisible()
    await expect.poll(() => tableNames(second)).toEqual(['alpha'])

    // Edit in tab one, save, and watch tab two catch up on its own.
    await typeDbml(page, '\nTable beta {\n  id int [pk]')
    await expect.poll(() => tableNames(page)).toEqual(['alpha', 'beta'])
    await page.keyboard.press('Control+s')

    await expect.poll(() => tableNames(second), { timeout: 15000 }).toEqual(['alpha', 'beta'])
    await expect(second.locator('.react-flow__node')).toHaveCount(2)
  })

})

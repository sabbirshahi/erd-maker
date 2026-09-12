import type { Page } from '@playwright/test'

/**
 * Examples, import and backup live in the header's overflow menu, not under the diagram name:
 * the name menu is about diagrams, these are about the app.
 */
export async function openMoreMenu(page: Page) {
  await page.getByTestId('btn-more').click()
}

export async function openExamples(page: Page) {
  await openMoreMenu(page)
  await page.getByTestId('menu-project-examples').click()
}

export async function openImport(page: Page) {
  await openMoreMenu(page)
  await page.getByTestId('menu-project-import').click()
}

import type { Page } from '@playwright/test'

/**
 * Examples and Import live in the diagram menu rather than the top bar: the bar is about the
 * diagram you have open, and these are ways to start a different one.
 */
export async function openDiagramMenu(page: Page) {
  await page.getByTestId('btn-project').click()
}

export async function openExamples(page: Page) {
  await openDiagramMenu(page)
  await page.getByTestId('menu-project-examples').click()
}

export async function openImport(page: Page) {
  await openDiagramMenu(page)
  await page.getByTestId('menu-project-import').click()
}

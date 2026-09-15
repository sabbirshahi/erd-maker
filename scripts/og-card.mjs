// Renders scripts/og-card.html to public/og.png at exactly 1200x630, the size Open Graph and
// Twitter summary_large_image expect. Run after editing the card: node scripts/og-card.mjs
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'public', 'og.png')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto('file://' + join(here, 'og-card.html'))
// The card pulls Inter from Google Fonts; screenshotting before it lands gives a fallback face.
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(500)
await page.screenshot({ path: out })
await browser.close()
console.log('wrote', out)

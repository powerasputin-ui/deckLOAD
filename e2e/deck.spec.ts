import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openSection, setNumber, statusLine, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

test.describe('Deck settings', () => {
  test('changing deck width updates statistics', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const initial = await statusLine(page).textContent()
    await openSection(page, 'Судно')
    await setNumber(page.locator('aside label:has-text("Ширина") + input').first(), '5')
    await setNumber(page.locator('aside label:has-text("Длина") + input').first(), '5')
    // The status line should eventually differ from the initial value
    await expect(statusLine(page)).not.toHaveText(initial ?? '')
  })

  test('unit conversion updates labels', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await openSection(page, 'Судно')
    // Immediately after navigation the Radix toggle can be visible before its
    // click handler is hydrated — a single click can land as a no-op. Retry
    // the click+assert pair instead of a single fixed wait.
    await expect(async () => {
      await page.getByRole('radio', { name: 'см' }).click()
      await expect(page.getByLabel('Ширина')).toHaveValue('2000', { timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await openSection(page, 'Грузы')
    await expect(page.getByText(/размеры в см/)).toBeVisible()
  })
})

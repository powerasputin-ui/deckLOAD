import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Header badge shows e.g. "12/22 ед. · 54%"
function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
}

test.describe('Deck settings', () => {
  test('changing deck width updates statistics', async ({ page }) => {
    await page.goto('/')
    const initial = await headerBadge(page).textContent()
    // Use the first "Ширина" input in the sidebar (deck settings)
    await page.locator('aside label:has-text("Ширина") + input').first().fill('5')
    await page.locator('aside label:has-text("Длина") + input').first().fill('5')
    // The badge text should eventually differ from the initial value
    await expect(headerBadge(page)).not.toHaveText(initial ?? '')
  })

  test('unit conversion updates labels', async ({ page }) => {
    await page.goto('/')
    // Immediately after navigation the Radix toggle can be visible before its
    // click handler is hydrated — a single click can land as a no-op. Retry
    // the click+assert pair instead of a single fixed wait.
    await expect(async () => {
      await page.getByText('см').first().click()
      await expect(page.getByText('Размеры в см.')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
  })
})

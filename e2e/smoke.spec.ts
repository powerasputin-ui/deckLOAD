import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openSection, sectionBar, statusLine } from './helpers'

// The status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return statusLine(page)
}

test.describe('DeckLoad smoke tests', () => {
  test('page loads and shows the demo project in the frame', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/DeckLoad/)
    await expect(sectionBar(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Меню расчёта «Демо-расчёт»' })).toBeVisible()
    await expect(page.locator('svg [data-deck-background="true"]').first()).toBeVisible()
    await openSection(page, 'Проверки')
    await expect(page.getByText('Статистика загрузки')).toBeVisible()
  })

  test('utilization is between 0% and 100%', async ({ page }) => {
    await page.goto('/')
    const badge = headerBadge(page)
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    expect(text).toMatch(/\d+%/)
    const percent = parseInt(text?.match(/(\d+)%/)?.[1] ?? '0', 10)
    expect(percent).toBeGreaterThanOrEqual(0)
    expect(percent).toBeLessThanOrEqual(100)
  })
})

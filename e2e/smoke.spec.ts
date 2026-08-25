import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Placed/total + utilization text lives in the deck card's footer (e.g.
// "12/22 ед. · Загрузка: 54%") — previously duplicated in a header badge
// that was removed as redundant clutter.
function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

test.describe('DeckLoad smoke tests', () => {
  test('page loads and shows demo project', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('DeckLoad', { exact: true })).toBeVisible()
    await expect(page.getByText('Статистика загрузки')).toBeVisible()
    await expect(page.getByText('Схема палубы')).toBeVisible()
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

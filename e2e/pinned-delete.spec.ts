import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Header badge shows e.g. "12/22 ед. · 54%"
function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
}

test.describe('Deleting a pinned cargo item', () => {
  test('the X button on a pinned item actually removes it (not just unpins)', async ({ page }) => {
    await page.goto('/')
    const before = await headerBadge(page).textContent()
    const [beforePlaced, beforeTotal] = (before?.match(/(\d+)\/(\d+)/) ?? []).slice(1).map(Number)

    // Pin the first placed item by clicking its colored rect in the SVG.
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(async () => {
      await placedRect.click({ force: true })
      await expect(page.getByText('Выбрано 1 груз')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })

    // Click the red X on the selected pin (only rendered for a single selection).
    await page.locator('svg circle[fill="#ef4444"]').first().click({ force: true })

    await expect(page.getByText(/удалён/)).toBeVisible()
    const after = await headerBadge(page).textContent()
    const [afterPlaced, afterTotal] = (after?.match(/(\d+)\/(\d+)/) ?? []).slice(1).map(Number)

    // The old bug: unpinning let the auto-packer immediately re-place the
    // freed unit elsewhere, leaving placed/total unchanged. The fix must
    // shrink both counts by exactly one.
    expect(afterTotal).toBe(beforeTotal - 1)
    expect(afterPlaced).toBe(beforePlaced - 1)
  })
})

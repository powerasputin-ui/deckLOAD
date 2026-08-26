import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Placed/total + utilization text lives in the deck card's footer (e.g.
// "12/22 ед. · Загрузка: 54%") — previously duplicated in a header badge
// that was removed as redundant clutter.
function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

test.describe('Deleting a pinned cargo item', () => {
  test('the X button on a pinned item actually removes it (not just unpins)', async ({ page }) => {
    await page.goto('/')
    // The store starts empty and only fills in once the saved/demo project
    // loads (an async effect) — wait for that to settle instead of reading
    // the badge's transient "0/0" from the very first paint.
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const before = await headerBadge(page).textContent()
    const [beforePlaced, beforeTotal] = (before?.match(/(\d+)\/(\d+)/) ?? []).slice(1).map(Number)

    // Pin the first placed item by clicking its colored rect in the SVG.
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    // A selected item's own rect gets the purple #7c3aed stroke (see
    // FootprintShape's strokeColor) — that's the selection signal now that
    // the sidebar's "Выбрано N груз(ов)" summary block was removed.
    const selectedStroke = page.locator('svg rect[stroke="#7c3aed"]')
    await expect(async () => {
      // A plain click only selects (no pinning) since the interaction
      // redesign — right-click "Закрепить" is now the explicit pin action.
      await placedRect.click({ button: 'right', force: true })
      await page.getByRole('button', { name: 'Закрепить' }).click({ timeout: 1000 })
      await expect(selectedStroke).toBeVisible({ timeout: 1000 })
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

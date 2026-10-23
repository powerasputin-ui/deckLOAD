import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { unitsCount, stackMenu, inspector, selectedStacks } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
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
    const placedRect = page.locator('svg rect[fill="#B0E0F8"]').first()
    // The selected stack (outlined with the accent band) — the selection
    // signal since the sidebar's "Выбрано N груз(ов)" block was removed.
    const selectedStroke = selectedStacks(page)
    await expect(async () => {
      // A plain click only selects (no pinning) since the interaction
      // redesign — right-click "Закрепить" is now the explicit pin action.
      await placedRect.click({ button: 'right', force: true })
      await stackMenu(page).getByRole('button', { name: 'Закрепить' }).click({ timeout: 1000 })
      await expect(selectedStroke).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })

    // «Удалить (−N ед.)» in the inspector of the selected pin.
    await inspector(page).getByRole('button', { name: /^Удалить/ }).click()

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

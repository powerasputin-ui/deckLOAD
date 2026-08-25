import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Header badge shows e.g. "12/22 ед. · 54%"
function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
}

test.describe('Auto-mode pin/select interaction', () => {
  test('a plain click on an unpinned auto-placed item selects it visually but does not pin it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(placedRect).toHaveAttribute('stroke-width', '1')

    await expect(async () => {
      await placedRect.click({ force: true })
      await expect(placedRect).toHaveAttribute('stroke', '#7c3aed', { timeout: 1000 })
    }).toPass({ timeout: 10000 })

    // Selected, but never pinned — the group-actions panel (which only
    // counts real pinned/manual selections) stays empty, and the item is
    // never promoted into pinnedPlacementsByTrip.
    await expect(page.getByText('Выбрано 1 груз')).not.toBeVisible()
    await page.waitForTimeout(600) // let the debounced localStorage save settle
    const pinned = await page.evaluate(() => {
      const raw = localStorage.getItem('deckload-projects')
      const data = raw ? JSON.parse(raw) : null
      const proj = data?.projects?.find((p: { id: string }) => p.id === data.activeId) ?? data?.projects?.[0]
      return proj?.pinnedPlacementsByTrip?.['0']?.length ?? 0
    })
    expect(pinned).toBe(0)

    // Clicking it again deselects (same toggle behavior as pinned selection)
    // — move the mouse away first so the assertion isn't confused by the
    // separate hover stroke (also #94a3b8/width 2, but not selection).
    await placedRect.click({ force: true })
    await page.mouse.move(0, 0)
    await expect(placedRect).not.toHaveAttribute('stroke', '#7c3aed')
  })

  test('right-click offers "Закрепить" on an unpinned item and "Открепить" once pinned', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const before = await headerBadge(page).textContent()
    const [, beforeTotal] = (before?.match(/(\d+)\/(\d+)/) ?? []).slice(1).map(Number)

    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()

    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(page.getByRole('button', { name: 'Закрепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await page.getByRole('button', { name: 'Закрепить' }).click()
    await expect(page.getByText('Выбрано 1 груз')).toBeVisible()

    // Right-clicking the now-pinned item offers "Открепить" instead. (The
    // sidebar's own group-actions panel also has an "Открепить" button for
    // the current selection — same action, different entry point — so
    // scope to the context-menu popup specifically to avoid ambiguity.)
    const itemMenu = page.locator('div.fixed.z-50.w-40')
    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(itemMenu.getByRole('button', { name: 'Открепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await itemMenu.getByRole('button', { name: 'Открепить' }).click()
    await expect(page.getByText(/откреплён/)).toBeVisible()

    // Unpinning must NOT change item.quantity — unlike deleting a pin, the
    // freed unit stays requested and the algorithm re-places it, so the
    // total is unchanged (only which placement is "pinned" changed).
    const after = await headerBadge(page).textContent()
    const [, afterTotal] = (after?.match(/(\d+)\/(\d+)/) ?? []).slice(1).map(Number)
    expect(afterTotal).toBe(beforeTotal)
  })

  test('right-clicking an item never also opens the deck-background menu (regression)', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()

    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(page.getByRole('button', { name: 'Закрепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    // The deck-background menu's own items must not appear alongside it.
    await expect(page.getByRole('button', { name: 'Редактировать' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Загрузить фото' })).not.toBeVisible()
  })

  test('dragging an unpinned item pins it (taking manual control is a deliberate drag, not a tap)', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(placedRect).toBeVisible()
    const box = await placedRect.boundingBox()
    if (!box) throw new Error('no bounding box')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(600) // let the debounced localStorage save settle

    const pinned = await page.evaluate(() => {
      const raw = localStorage.getItem('deckload-projects')
      const data = raw ? JSON.parse(raw) : null
      const proj = data?.projects?.find((p: { id: string }) => p.id === data.activeId) ?? data?.projects?.[0]
      return proj?.pinnedPlacementsByTrip?.['0']?.length ?? 0
    })
    expect(pinned).toBe(1)
  })
})

test.describe('Manual-mode selection (consistent with auto mode)', () => {
  test('a click selects with the same bold stroke used in auto mode, and background click clears it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await page.getByText('Ручной').first().click()
    await expect(page.getByText('ручной режим', { exact: true })).toBeVisible()

    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(async () => {
      await placedRect.click({ force: true })
      await expect(placedRect).toHaveAttribute('stroke', '#7c3aed', { timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await expect(placedRect).toHaveAttribute('stroke-width', '3')

    // Background click clears manual selection too (regression: this used
    // to be asymmetric — auto mode cleared on background click, manual
    // mode silently didn't).
    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ force: true })
    await expect(placedRect).not.toHaveAttribute('stroke', '#7c3aed')
  })
})

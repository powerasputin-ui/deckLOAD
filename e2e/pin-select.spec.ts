import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Placed/total + utilization text lives in the deck card's footer (e.g.
// "12/22 ед. · Загрузка: 54%") — previously duplicated in a header badge
// that was removed as redundant clutter.
function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

test.describe('Auto-mode pin/lock interaction', () => {
  test('a plain click selects and lets an item be dragged, without any lock badge', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(placedRect).toHaveAttribute('stroke-width', '1')

    await expect(async () => {
      await placedRect.click({ force: true })
      await expect(placedRect).toHaveAttribute('stroke', '#7c3aed', { timeout: 1000 })
    }).toPass({ timeout: 10000 })

    // Selected — the group-actions panel shows it, and it now has a real
    // (unlocked) placement record so it can be dragged. No lock badge
    // ("🔒") appears purely from clicking — that only happens after an
    // explicit right-click "Закрепить".
    await expect(page.getByText('Выбрано 1 груз')).toBeVisible()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(0)

    // Clicking it again deselects (same toggle behavior as before).
    await placedRect.click({ force: true })
    await page.mouse.move(0, 0)
    await expect(placedRect).not.toHaveAttribute('stroke', '#7c3aed')
  })

  test('right-click "Закрепить" locks the item — it stops responding to drag until "Открепить"', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()

    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(page.getByRole('button', { name: 'Закрепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await page.getByRole('button', { name: 'Закрепить' }).click()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)

    // Dragging a locked item is a no-op — position stays put.
    const box = await placedRect.boundingBox()
    if (!box) throw new Error('no bounding box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const afterDrag = await placedRect.boundingBox()
    expect(Math.abs(afterDrag!.x - box.x)).toBeLessThan(2)
    expect(Math.abs(afterDrag!.y - box.y)).toBeLessThan(2)

    // Right-clicking a locked item offers "Открепить" instead. (The
    // sidebar's own group-actions panel also has an "Открепить" button —
    // a different, bulk action — so scope to the popup to avoid ambiguity.)
    const itemMenu = page.locator('div.fixed.z-50.w-40')
    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(itemMenu.getByRole('button', { name: 'Открепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await itemMenu.getByRole('button', { name: 'Открепить' }).click()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(0)
  })

  test('locking/unlocking never changes item.quantity (it is not a delete)', async ({ page }) => {
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

    const itemMenu = page.locator('div.fixed.z-50.w-40')
    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(itemMenu.getByRole('button', { name: 'Открепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await itemMenu.getByRole('button', { name: 'Открепить' }).click()

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

  test('dragging an unpinned item moves it (creating an unlocked placement)', async ({ page }) => {
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

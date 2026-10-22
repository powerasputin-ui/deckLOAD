import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clearCalculation } from './helpers'

// Placed/total + utilization text lives in the deck card's footer (e.g.
// "12/22 ед. · Загрузка: 54%") — previously duplicated in a header badge
// that was removed as redundant clutter.
function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

// Pins stored for trip 1 of the active calculation, read from the autosave
// once its debounce has settled.
async function storedPins(page: Page) {
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const raw = localStorage.getItem('deckload-projects')
    const data = raw ? JSON.parse(raw) : null
    const proj = data?.projects?.find((p: { id: string }) => p.id === data.activeId) ?? data?.projects?.[0]
    return (proj?.pinnedPlacementsByTrip?.['0'] ?? []) as { x: number; y: number; locked?: boolean }[]
  })
}

// Selecting never changes saved data; what the user changes (a drag, layers,
// rotation, «Закрепить») pins the stack, locked, and a locked stack still
// drags — it just stays where the user put it.
test.describe('Auto-mode selection and pinning', () => {
  test('a plain click only selects: nothing is pinned, a second click keeps it, the bare deck clears it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(placedRect).toHaveAttribute('stroke-width', '1')

    await expect(async () => {
      await placedRect.click({ force: true })
      await expect(placedRect).toHaveAttribute('stroke', '#7c3aed', { timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(0)
    expect(await storedPins(page)).toHaveLength(0)

    // A press on the selected stack starts a drag; it used to toggle the
    // selection off.
    await placedRect.click({ force: true })
    await page.mouse.move(0, 0)
    await expect(placedRect).toHaveAttribute('stroke', '#7c3aed')

    await page.locator('svg [data-deck-background="true"]').first().click({ force: true })
    await expect(placedRect).not.toHaveAttribute('stroke', '#7c3aed')
  })

  test('a locked stack still drags and stays locked; «Вернуть в авто» and «Закрепить» switch it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await clearCalculation(page)

    // One container stamped onto an empty deck, so the drag has room to land.
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Контейнеры' }).click()
    await page.getByText('Контейнер 20ft', { exact: true }).click()
    await page.locator('svg [data-deck-background="true"]').first().click({ position: { x: 60, y: 60 }, force: true })
    await page.keyboard.press('Escape')
    const stack = page.locator('svg g[data-cargo-placement="true"]')
    await expect(stack).toHaveCount(1)
    // A stamp puts the cargo exactly where the user clicked: locked.
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)

    const before = (await storedPins(page))[0]
    const box = await stack.boundingBox()
    if (!box) throw new Error('no bounding box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)
    const moved = await storedPins(page)
    expect(moved).toHaveLength(1)
    expect(moved[0].locked).toBe(true)
    expect(Math.hypot(moved[0].x - before.x, moved[0].y - before.y)).toBeGreaterThan(0.5)

    // The deck-background menu also has buttons — scope to the item menu.
    const itemMenu = page.locator('div.fixed.z-50.w-40')
    await expect(async () => {
      await stack.click({ button: 'right', force: true })
      await expect(itemMenu.getByRole('button', { name: 'Вернуть в авто' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await itemMenu.getByRole('button', { name: 'Вернуть в авто' }).click()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(0)
    expect(await storedPins(page)).toHaveLength(0)
    // Back with the packer, still on the deck.
    await expect(stack).toHaveCount(1)

    await expect(async () => {
      await stack.click({ button: 'right', force: true })
      await expect(itemMenu.getByRole('button', { name: 'Закрепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await itemMenu.getByRole('button', { name: 'Закрепить' }).click()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)
    const relocked = await storedPins(page)
    expect(relocked).toHaveLength(1)
    expect(relocked[0].locked).toBe(true)
  })

  test('«Закрепить» and «Вернуть в авто» never change item.quantity (neither is a delete)', async ({ page }) => {
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
      await expect(itemMenu.getByRole('button', { name: 'Вернуть в авто' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await itemMenu.getByRole('button', { name: 'Вернуть в авто' }).click()

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

  test('dragging an auto-placed stack pins it where it was dropped, locked', async ({ page }) => {
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

    const pins = await storedPins(page)
    expect(pins).toHaveLength(1)
    expect(pins[0].locked).toBe(true)
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

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Placed/total + utilization text lives in the deck card's footer (e.g.
// "12/22 ед. · Загрузка: 54%") — previously duplicated in a header badge
// that was removed as redundant clutter.
function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

test.describe('Auto / manual modes', () => {
  test('switching to manual mode preserves placements', async ({ page }) => {
    await page.goto('/')
    // Ensure some items are placed in auto mode
    await expect(headerBadge(page)).toContainText('%')

    await page.getByText('Ручной').first().click()
    await expect(page.getByText('ручной режим', { exact: true })).toBeVisible()
    await expect(page.getByText('Ручная расстановка')).toBeVisible()
  })

  test('auto redistribute generates variants', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()
  })

  test('auto redistribute reshuffles an UNLOCKED placement and warns', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
    // A plain click on an unpinned item selects it and lets it be dragged —
    // that creates an UNLOCKED placement (see pin-select.spec.ts). Unlocked
    // placements are exactly what redistribute is meant to reshuffle; only
    // an explicit right-click "Закрепить" protects one (see the next test).
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    // A selected item's own rect gets the purple #7c3aed stroke (see
    // FootprintShape's strokeColor) — that's the selection signal now that
    // the sidebar's "Выбрано N груз(ов)" summary block was removed.
    const selectedStroke = page.locator('svg rect[stroke="#7c3aed"]')
    await expect(async () => {
      await placedRect.click({ force: true })
      await expect(selectedStroke).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    // Redistribute reshuffles every unlocked placement (page.tsx's
    // handleAutoRedistribute/applyVariant) and warns the user beforehand.
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/Незакреплённые размещения.*будут переставлены/)).toBeVisible()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()
  })

  test('auto redistribute keeps a LOCKED placement fixed in place', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(page.getByRole('button', { name: 'Закрепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await page.getByRole('button', { name: 'Закрепить' }).click()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)

    const before = await placedRect.getAttribute('x')
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/Закреплённый груз.*останутся на месте/)).toBeVisible()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()

    const after = await placedRect.getAttribute('x')
    expect(after).toBe(before)
    // Still locked after the reshuffle — redistribute must carry the flag
    // through onto the newly-built pin, not just leave the position alone.
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)
  })

  test('auto redistribute keeps a clearance-zoned placement fixed in place', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
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

    // Give it a clearance zone via the "Крепление груза" sidebar section.
    await page.getByRole('button', { name: /^Крепление груза/ }).click()
    await page.getByRole('button', { name: 'Зона отступа' }).click()

    const before = await placedRect.getAttribute('x')

    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/зоны отступа.*останутся на месте/)).toBeVisible()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()

    const after = await placedRect.getAttribute('x')
    expect(after).toBe(before)
  })

  test('rotation is blocked when item disallows rotation', async ({ page }) => {
    await page.goto('/')
    // Disable rotation for the first cargo item (retry: same post-navigation
    // hydration race as the other tests in this file).
    await expect(async () => {
      await page.getByRole('button', { name: 'Авто-поворот' }).first().click()
      await expect(page.getByRole('button', { name: 'Фиксация' }).first()).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    // Pin the first placed item by clicking its colored rect
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
    // Click rotate on the selected pin (purple circle around the ↻ icon)
    await page.locator('svg circle[fill="#7c3aed"]').first().click({ force: true })
    await expect(page.getByText(/не разрешает поворот/)).toBeVisible()
  })
})

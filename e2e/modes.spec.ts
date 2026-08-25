import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Header badge shows e.g. "12/22 ед. · 54%"
function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
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

  test('auto redistribute clears pinned placement and warns', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
    // Pin the first placed item by clicking its colored rect in the SVG.
    // `force: true` skips Playwright's actionability wait, so immediately
    // after navigation this can land before the SVG's pointer handlers are
    // hydrated — retry the click+assert pair instead of a single attempt.
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(async () => {
      // A plain click only selects (no pinning) since the interaction
      // redesign — right-click "Закрепить" is now the explicit pin action.
      await placedRect.click({ button: 'right', force: true })
      await page.getByRole('button', { name: 'Закрепить' }).click({ timeout: 1000 })
      await expect(page.getByText('Выбрано 1 груз')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    // Redistribute intentionally clears all pins (page.tsx's
    // handleAutoRedistribute/applyVariant) and warns the user beforehand.
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/Закрепления.*будут сброшены/)).toBeVisible()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()
    await expect(page.getByText('Выбрано 1 груз')).not.toBeVisible()
  })

  test('auto redistribute keeps a clearance-zoned placement fixed in place', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    await expect(async () => {
      // A plain click only selects (no pinning) since the interaction
      // redesign — right-click "Закрепить" is now the explicit pin action.
      await placedRect.click({ button: 'right', force: true })
      await page.getByRole('button', { name: 'Закрепить' }).click({ timeout: 1000 })
      await expect(page.getByText('Выбрано 1 груз')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })

    // Give it a clearance zone via the "Крепление груза" sidebar section.
    await page.getByRole('button', { name: /^Крепление груза/ }).click()
    await page.getByRole('button', { name: 'Зона отступа' }).click()

    const before = await placedRect.getAttribute('x')

    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/зоной отступа.*останется на месте/)).toBeVisible()
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
    await expect(async () => {
      // A plain click only selects (no pinning) since the interaction
      // redesign — right-click "Закрепить" is now the explicit pin action.
      await placedRect.click({ button: 'right', force: true })
      await page.getByRole('button', { name: 'Закрепить' }).click({ timeout: 1000 })
      await expect(page.getByText('Выбрано 1 груз')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    // Click rotate on the selected pin (purple circle around the ↻ icon)
    await page.locator('svg circle[fill="#7c3aed"]').first().click({ force: true })
    await expect(page.getByText(/не разрешает поворот/)).toBeVisible()
  })
})

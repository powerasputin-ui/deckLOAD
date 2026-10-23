import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { statusLine, openSection, stackMenu, stackTools, selectedStacks } from './helpers'

// The status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return statusLine(page)
}

test.describe('Auto / manual modes', () => {
  test('switching to manual mode preserves placements', async ({ page }) => {
    await page.goto('/')
    // Ensure some items are placed in auto mode
    await expect(headerBadge(page)).toContainText('%')

    await page.getByText('Ручной').first().click()
    await expect(page.getByRole('radio', { name: 'Ручной' })).toHaveAttribute('aria-checked', 'true')
    await openSection(page, 'Размещение')
    await expect(page.getByRole('heading', { name: 'Ручной режим' })).toBeVisible()
  })

  test('auto redistribute generates variants', async ({ page }) => {
    await page.goto('/')
    await openSection(page, 'Размещение')
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()
  })

  // In auto mode an unlocked pin is the packer's own layout (nothing to warn
  // about); in manual mode every placement is the user's, so the re-arrange
  // is announced with its count.
  test('auto redistribute in manual mode says how many hand placements get re-arranged', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
    await page.getByText('Ручной').first().click()
    await expect(page.getByRole('radio', { name: 'Ручной' })).toHaveAttribute('aria-checked', 'true')
    await openSection(page, 'Размещение')
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    await expect(page.getByText(/Ручные размещения \(\d+\) будут переставлены заново/)).toBeVisible()
    await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()
  })

  test('auto redistribute keeps a LOCKED placement fixed in place', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toContainText('%')
    const placedRect = page.locator('svg rect[fill="#B0E0F8"]').first()
    await expect(async () => {
      await placedRect.click({ button: 'right', force: true })
      await expect(stackMenu(page).getByRole('button', { name: 'Закрепить' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await stackMenu(page).getByRole('button', { name: 'Закрепить' }).click()
    await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(1)

    const before = await placedRect.getAttribute('x')
    await openSection(page, 'Размещение')
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

    // Give it a clearance zone via the "Крепление груза" sidebar section.
    await openSection(page, 'Проверки')
    await page.getByRole('button', { name: /^Крепление груза/ }).click()
    await page.getByRole('button', { name: 'Зона отступа' }).click()

    const before = await placedRect.getAttribute('x')

    await openSection(page, 'Размещение')

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
    // Rotate the selected pin from its mini-panel.
    await stackTools(page).getByRole('button', { name: 'Повернуть' }).click()
    await expect(page.getByText(/не разрешает поворот/)).toBeVisible()
  })
})

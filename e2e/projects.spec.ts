import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Header badge shows e.g. "12/22 ед. · 54%"
function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
}

test.describe('Projects', () => {
  test('creating a new project switches to it', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Новый' }).first().click()
    await expect(page.getByText('Создан новый расчёт')).toBeVisible()
    await expect(page.getByText('Список грузов пуст')).toBeVisible()
  })

  test('switching between projects updates cargo list', async ({ page }) => {
    await page.goto('/')
    const initial = await headerBadge(page).textContent()
    await page.getByRole('button', { name: 'Новый' }).first().click()
    await expect(page.getByText('Список грузов пуст')).toBeVisible()

    // Switch back to the demo project
    await page.getByText('Демо-расчёт').first().click()
    const afterSwitch = await headerBadge(page).textContent()
    expect(afterSwitch).toBe(initial)
  })
})

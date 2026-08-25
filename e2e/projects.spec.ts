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
    // The store starts empty and only fills in once the demo project loads
    // (an async effect) — wait for that to settle instead of reading the
    // badge's transient "0/0" from the very first paint.
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const initial = await headerBadge(page).textContent()
    await page.getByRole('button', { name: 'Новый' }).first().click()
    await expect(page.getByText('Список грузов пуст')).toBeVisible()

    // Switch back to the demo project
    await page.getByText('Демо-расчёт').first().click()
    const afterSwitch = await headerBadge(page).textContent()
    expect(afterSwitch).toBe(initial)
  })

  test('renaming a project updates its name in the list', async ({ page }) => {
    await page.goto('/')
    const row = page.locator('div.group', { hasText: 'Демо-расчёт' }).first()
    await row.hover()
    await row.getByTitle('Переименовать').click()
    // Re-querying `row` by hasText after clicking would fail: the name
    // display gets replaced by an <input> whose *value* isn't text content,
    // so the hasText filter no longer matches. Target the edit input
    // directly instead — only one project row is ever in edit mode at once.
    const input = page.locator('div.group input').first()
    await input.fill('Переименованный расчёт')
    await input.press('Enter')
    await expect(page.getByText('Переименованный расчёт', { exact: true })).toBeVisible()
    await expect(page.getByText('Демо-расчёт', { exact: true })).not.toBeVisible()
  })

  test('duplicating a project adds a second, independent copy', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const row = page.locator('div.group', { hasText: 'Демо-расчёт' }).first()
    await row.hover()
    await row.getByTitle('Дублировать').click()
    await expect(page.getByText('Дублировано')).toBeVisible()
    // The duplicate is suffixed, e.g. "Демо-расчёт (копия)".
    await expect(page.getByText('Демо-расчёт (копия)')).toBeVisible()
  })

  test('deleting a project removes it after confirming the alert dialog', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    // Duplicate first so there's a second, disposable project to delete —
    // deleting the only project isn't the scenario worth covering here.
    const row = page.locator('div.group', { hasText: 'Демо-расчёт' }).first()
    await row.hover()
    await row.getByTitle('Дублировать').click()
    await expect(page.getByText('Дублировано')).toBeVisible()

    const rows = page.locator('div.group', { hasText: /Демо-расчёт/ })
    const countBefore = await rows.count()
    const target = rows.last()
    await target.hover()
    await target.getByTitle('Удалить').click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Удалить' }).last().click()
    await expect(page.getByText('Удалено')).toBeVisible()
    await expect(page.locator('div.group', { hasText: /Демо-расчёт/ })).toHaveCount(countBefore - 1)
  })
})

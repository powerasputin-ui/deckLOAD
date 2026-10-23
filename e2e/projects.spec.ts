import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { projectMenuItem, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

// Everything done to calculations as a whole lives in the calculation's menu,
// top left (spec 5.2).
test.describe('Projects', () => {
  test('creating a new project switches to it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Новый расчёт')
    await expect(page.getByText('Создан новый расчёт')).toBeVisible()
    await expect(page.getByText('Список грузов пуст')).toBeVisible()
  })

  test('switching between projects updates cargo list', async ({ page }) => {
    await page.goto('/')
    // The store starts empty and only fills in once the demo project loads
    // (an async effect) — wait for that to settle instead of reading the
    // transient "0/0" from the very first paint.
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const initial = await headerBadge(page).textContent()
    await projectMenuItem(page, 'Новый расчёт')
    await expect(page.getByText('Список грузов пуст')).toBeVisible()

    await projectMenuItem(page, 'Все расчёты…')
    await page.getByRole('dialog').getByText('Демо-расчёт', { exact: true }).click()
    await expect(headerBadge(page)).toHaveText(initial ?? '')
  })

  test('renaming a project updates its name', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Переименовать…')
    const input = page.getByRole('textbox', { name: 'Название расчёта' })
    await input.fill('Переименованный расчёт')
    await input.press('Enter')
    await expect(page.getByRole('button', { name: 'Меню расчёта «Переименованный расчёт»' })).toBeVisible()
  })

  test('duplicating a project adds a second, independent copy', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Дублировать')
    await expect(page.getByText('Дублировано')).toBeVisible()
    // The duplicate is suffixed and becomes the open calculation.
    await expect(page.getByRole('button', { name: 'Меню расчёта «Демо-расчёт (копия)»' })).toBeVisible()
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
  })

  test('deleting a project removes it after confirming the alert dialog', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    // Duplicate first so there's a second, disposable project to delete —
    // deleting the only project isn't the scenario worth covering here.
    await projectMenuItem(page, 'Дублировать')
    await expect(page.getByText('Дублировано')).toBeVisible()

    await projectMenuItem(page, 'Удалить расчёт…')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Удалить «Демо-расчёт (копия)»?')
    await dialog.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByText('Удалено')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Меню расчёта «Демо-расчёт»' })).toBeVisible()
    await projectMenuItem(page, 'Все расчёты…')
    await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(1)
  })
})

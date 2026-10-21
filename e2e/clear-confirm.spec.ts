import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

// "Очистить" replaces the whole calculation — cargo, placements and the
// deck's own photo/outline/zones/lashing points/vessel data — and drops the
// undo history, so it must never fire on a single stray click.
test.describe('Clearing the calculation', () => {
  test('asks first; Cancel and Escape keep everything', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await page.getByRole('button', { name: 'Очистить' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Очистить текущий расчёт?')
    await expect(dialog).toContainText('фото палубы')

    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await page.getByRole('button', { name: 'Очистить' }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
  })

  test('confirming wipes the cargo', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click()

    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(page.getByText('Список грузов пуст')).toBeVisible()
    await expect(page.getByText('Текущий расчёт очищен')).toBeVisible()
  })

  test('"Сбросить к примеру" in the settings asks first too', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Сбросить к примеру' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Заменить расчёт демонстрационным примером?')
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()
  })

  test('Space activates the focused dialog button (the global 2D shortcut must not swallow it)', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await page.getByRole('button', { name: 'Очистить' }).click()
    const cancel = page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' })
    await cancel.focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('alertdialog')).toBeHidden()
  })
})

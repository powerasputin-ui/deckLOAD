import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { projectMenuItem, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

// «Очистить расчёт…» replaces the whole calculation — cargo, placements and
// the deck's own photo/outline/zones/lashing points/vessel data — and drops
// the undo history, so it must never fire on a single stray click.
test.describe('Clearing the calculation', () => {
  test('asks first; Cancel and Escape keep everything', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await projectMenuItem(page, 'Очистить расчёт…')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Очистить текущий расчёт?')
    await expect(dialog).toContainText('фото палубы')

    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await projectMenuItem(page, 'Очистить расчёт…')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
  })

  test('confirming wipes the cargo', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await projectMenuItem(page, 'Очистить расчёт…')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click()

    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(page.getByText('Добавьте груз из каталога или задайте свой')).toBeVisible()
    await expect(page.getByText('Текущий расчёт очищен')).toBeVisible()
  })

  // Spec 5.2: «Открыть пример» (it was «Сбросить к примеру», which replaced
  // the current calculation behind a confirmation) opens the example as a
  // new calculation, so there is nothing to confirm and nothing is lost.
  test('«Открыть пример» opens the example as a new calculation and keeps the current one', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Очистить расчёт…')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click()
    await expect(page.getByText('Добавьте груз из каталога или задайте свой')).toBeVisible()

    await projectMenuItem(page, 'Открыть пример')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Все расчёты…')
    await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(2)
  })

  test('Space activates the focused dialog button (the global 2D shortcut must not swallow it)', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Очистить расчёт…')
    const cancel = page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' })
    await cancel.focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('alertdialog')).toBeHidden()
  })
})

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { addOwnCargo, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

test.describe('Undo/redo', () => {
  test('Ctrl+Z undoes adding a cargo item, Ctrl+Y redoes it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    const undoBtn = page.getByRole('button', { name: 'Отменить (Ctrl+Z)' })
    const redoBtn = page.getByRole('button', { name: 'Повторить (Ctrl+Y)' })
    await expect(undoBtn).toBeDisabled()
    await expect(redoBtn).toBeDisabled()

    await addOwnCargo(page)
    await expect(headerBadge(page)).toHaveText(/\/23 ед\./)
    await expect(undoBtn).toBeEnabled()

    await page.keyboard.press('Control+z')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await expect(redoBtn).toBeEnabled()

    await page.keyboard.press('Control+y')
    await expect(headerBadge(page)).toHaveText(/\/23 ед\./)
  })

  test('Ctrl+Z inside a text field triggers the native input undo, not the global history', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    const undoBtn = page.getByRole('button', { name: 'Отменить (Ctrl+Z)' })
    await addOwnCargo(page)
    await expect(headerBadge(page)).toHaveText(/\/23 ед\./)

    // The new cargo's «всего» in the list.
    const qtyInput = page.getByLabel('Всего, Груз 4', { exact: true })
    await qtyInput.click()
    await qtyInput.fill('9')
    await page.keyboard.press('Control+z')

    // The global history must still show the "add cargo" step as undoable —
    // a field-scoped Ctrl+Z must not have consumed it.
    await expect(undoBtn).toBeEnabled()
    await expect(headerBadge(page)).toHaveText(/\/23 ед\./)
  })
})

import { test, expect, type Page } from '@playwright/test'
import { unitsCount } from './helpers'

// Spec 6.10: «Вид» sets how the deck is shown — the grid, cargo names, free
// space and the theme. The theme is kept in this browser, the rest with the
// calculation, so all of it is still as set after a reload.

async function switchOff(page: Page, name: string) {
  await page.getByRole('button', { name: 'Вид' }).click()
  const toggle = page.getByRole('switch', { name })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
}

test.describe('«Вид»', () => {
  test('the grid, cargo names, free space and the theme are still as set after a reload', async ({ page }) => {
    await page.goto('/')
    await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)

    const grid = page.locator('svg rect[fill="url(#deck-grid)"]')
    const freeSpace = page.locator('svg path[fill="url(#free-hatch)"]')
    const containerNames = page.locator('svg text', { hasText: /^Контейнер/ })
    await expect(grid).toHaveCount(1)
    await expect(freeSpace).toHaveCount(1)
    await expect(containerNames.first()).toBeVisible()

    await switchOff(page, 'Сетка')
    await expect(grid).toHaveCount(0)
    await switchOff(page, 'Названия грузов')
    await expect(containerNames).toHaveCount(0)
    await switchOff(page, 'Свободное место')
    await expect(freeSpace).toHaveCount(0)

    await page.getByRole('button', { name: 'Вид' }).click()
    await page.getByRole('radio', { name: 'Тёмная' }).click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await page.keyboard.press('Escape')

    // Saving the calculation waits 400 ms after the last change.
    await page.waitForTimeout(700)
    await page.reload()
    await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)

    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await expect(grid).toHaveCount(0)
    await expect(containerNames).toHaveCount(0)
    await expect(freeSpace).toHaveCount(0)
    await page.getByRole('button', { name: 'Вид' }).click()
    for (const name of ['Сетка', 'Названия грузов', 'Свободное место']) {
      await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false')
    }
    await expect(page.getByRole('switch', { name: 'Содержимое при наведении' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Тёмная' })).toHaveAttribute('aria-checked', 'true')
  })

  test('«Условные обозначения» open in the same panel and go back to the settings', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Вид' }).click()
    await page.getByRole('button', { name: 'Условные обозначения' }).click()
    await expect(page.getByRole('heading', { name: 'Условные обозначения' })).toBeVisible()
    await expect(page.getByText('Закреплён: авторасстановка его не двигает')).toBeVisible()
    await expect(page.getByText('Розетка', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Назад к настройкам вида' }).click()
    await expect(page.getByRole('switch', { name: 'Сетка' })).toBeVisible()

    // Closed on the legend, «Вид» opens on its settings again.
    await page.getByRole('button', { name: 'Условные обозначения' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Вид' }).click()
    await expect(page.getByRole('switch', { name: 'Сетка' })).toBeVisible()
  })
})

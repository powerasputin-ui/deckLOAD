import { test, expect } from '@playwright/test'

test.describe('Cargo management', () => {
  test('adding a cargo item increases requested count', async ({ page }) => {
    await page.goto('/')
    // Start with a clean project
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(
      page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз 1' }).first()
    ).toBeVisible()
  })

  test('cargo bigger than deck is reported as unplaced', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()

    // Fill the new cargo dimensions via labelled inputs (first item card)
    const itemCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' }).first()
    await itemCard.locator('label:has-text("Шир.") + input').fill('100')
    await itemCard.locator('label:has-text("Длин.") + input').fill('100')
    await itemCard.locator('label:has-text("Кол-во") + input').fill('1')

    await expect(page.getByText('Превышает размеры палубы')).toBeVisible()
  })

  test('back-to-top button appears below the cargo list (not overlapping) and scrolls the page', async ({ page }) => {
    await page.goto('/')
    // Add enough items to force the internal list to overflow and scroll.
    for (let i = 0; i < 15; i++) {
      await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    }

    const list = page.locator('[data-slot="scroll-area-viewport"]').last()
    await list.evaluate((el) => { el.scrollTop = 300 })

    const backToTop = page.getByRole('button', { name: 'Наверх' })
    await expect(backToTop).toBeVisible()

    // Positioned below the scroll box, not overlapping it.
    const listBox = await list.boundingBox()
    const btnBox = await backToTop.boundingBox()
    expect(btnBox!.y).toBeGreaterThanOrEqual(listBox!.y + listBox!.height - 1)

    await backToTop.click()
    await expect(backToTop).not.toBeVisible()
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)
  })
})

import { test, expect } from '@playwright/test'
import { clearCalculation, openSection } from './helpers'

test.describe('Power socket markers', () => {
  test('placing a socket does not block cargo on top of it, and it can be removed', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByRole('radio', { name: 'Ручной' }).click()

    // Sockets are in «Судно» (stage 3, spec 7.5).
    await openSection(page, 'Судно')
    await page.getByRole('button', { name: 'Поставить розетку' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')
    // Near the left edge, where the socket snaps onto the deck perimeter.
    await background.click({ position: { x: 5, y: bgBox.height / 2 }, force: true })

    // The socket is listed — the click placed it, not just armed the tool.
    const listed = page.getByRole('list', { name: 'Розетки на палубе' }).getByRole('listitem')
    await expect(listed).toHaveCount(1)

    // The socket is purely visual — placing cargo right at/near the exact
    // same spot must not be blocked.
    await openSection(page, 'Грузы')
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    await expect(page.getByText(/0\/1 ед\./)).toBeVisible()
    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()
    await background.click({ position: { x: 60, y: bgBox.height / 2 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()

    await openSection(page, 'Судно')
    await page.getByRole('button', { name: 'Удалить розетку 1' }).click()
    await expect(listed).toHaveCount(0)
  })
})

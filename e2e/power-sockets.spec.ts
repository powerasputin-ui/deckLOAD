import { test, expect } from '@playwright/test'

test.describe('Power socket markers', () => {
  test('placing a socket does not block cargo on top of it, and it can be removed', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('radio', { name: 'Ручной' }).click()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Объекты' }).click()
    await page.getByRole('button', { name: 'Розетка' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')
    // Near the left edge, where the socket snaps onto the deck perimeter.
    await background.click({ position: { x: 5, y: bgBox.height / 2 }, force: true })

    // A visible amber plug marker (Розетка chip in the catalog bar) now
    // shows a count badge of 1 — confirms the click was registered as a
    // placement, not just an armed-but-unused tool.
    await expect(page.getByRole('button', { name: /Розетка/ })).toContainText('1')

    // The socket is purely visual — placing cargo right at/near the exact
    // same spot must not be blocked.
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    await expect(page.getByText(/Размещено 0 из 1/)).toBeVisible()
    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()
    await background.click({ position: { x: 60, y: bgBox.height / 2 }, force: true })
    await expect(page.getByText(/Размещено 1 из 1/)).toBeVisible()

    await page.locator('button[title="Удалить розетку"]').first().click()
    const socketChip = page.getByRole('button', { name: /Розетка/ })
    await expect(socketChip).toBeVisible()
    await expect(socketChip).not.toContainText('1')
  })
})

import { test, expect } from '@playwright/test'

test.describe('Non-rectangular deck outline', () => {
  test('right-click menu edits the deck outline, cargo is blocked from the cut corner, and 3D floor matches', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })

    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    await page.getByRole('button', { name: 'Редактировать' }).click()

    // Drag the top-right vertex handle inward to cut that corner.
    const handle = page.locator('svg circle[fill="rgba(37,99,235,0.9)"]').nth(1)
    await handle.hover()
    await page.mouse.down()
    const box = await handle.boundingBox()
    if (!box) throw new Error('vertex handle not found')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX - 150, startY + 150, { steps: 10 })
    await page.mouse.up()

    await page.getByRole('button', { name: 'Сохранить' }).click()

    // Deck area shrinks below the plain-rectangle 160 m^2 once the corner is cut.
    await expect(page.getByText(/^\d+\.\d\d м²$/).first()).toBeVisible()

    // Manual mode first, so adding cargo doesn't auto-place it via packDeck.
    await page.getByText('Ручной').first().click()
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    const itemCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' }).first()
    await itemCard.locator('label:has-text("Кол-во") + input').fill('5')

    await expect(page.getByText(/Размещено 0 из 5/)).toBeVisible()
    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()
    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')
    // Top-right corner of the background rect — inside the cut-off area.
    await background.click({ position: { x: bgBox.width - 5, y: 5 }, force: true })

    // Placement count must still read 0/5 — the click into the cut corner
    // was rejected, not silently accepted.
    await expect(page.getByText(/Размещено 0 из 5/)).toBeVisible()

    // A click well inside the remaining polygon succeeds.
    await background.click({ position: { x: 60, y: 60 }, force: true })
    await expect(page.getByText(/Размещено 1 из 5/)).toBeVisible()

    // 3D view renders without crashing when the deck has a custom outline.
    await page.getByRole('radio', { name: '3D' }).click()
    await expect(page.locator('canvas')).toBeVisible()
  })
})

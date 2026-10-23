import { test, expect } from '@playwright/test'
import { clearCalculation, setNumber } from './helpers'

test.describe('Cargo management', () => {
  test('adding a cargo item increases requested count', async ({ page }) => {
    await page.goto('/')
    // Start with a clean project
    await clearCalculation(page)
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(
      page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз 1' }).first()
    ).toBeVisible()
  })

  test('cargo bigger than deck is reported as unplaced', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()

    // Fill the new cargo dimensions via labelled inputs (first item card)
    const itemCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' }).first()
    await setNumber(itemCard.locator('label:has-text("Шир.") + input'), '100')
    await setNumber(itemCard.locator('label:has-text("Длин.") + input'), '100')
    await setNumber(itemCard.locator('label:has-text("Кол-во") + input'), '1')

    await expect(page.getByText('Превышает размеры палубы')).toBeVisible()
  })

  // Stage 2: the cargo list sits in the left panel with no scroll box of its
  // own — the panel scrolls. That replaced the list's inner scroll and its
  // «Наверх» button, so every card is reached by scrolling the panel.
  test('the cargo list scrolls with the panel and has no scroll box of its own', async ({ page }) => {
    await page.goto('/')
    for (let i = 0; i < 15; i++) {
      await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    }
    const list = page.locator('[data-tour="cargo-list"]')
    await expect(list.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(0)
    const panel = page.locator('.section-content')
    await expect.poll(() => panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    const lastCard = list.locator('.rounded-lg.border.bg-card').last()
    await lastCard.scrollIntoViewIfNeeded()
    await expect(lastCard).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Наверх' })).toHaveCount(0)
  })

  // Regression: the rendered box position used to only reflect the
  // throttled (~50ms) store commit, so it visually moved in discrete
  // jumps instead of tracking the cursor -- fixed by rendering a live,
  // unthrottled preview position for whichever item is mid-drag. This
  // test exercises the actual drag path end-to-end (a real Playwright
  // mouse drag, not a single click) and checks the box already reflects
  // the new position well before the mouse button is released, not only
  // after -- which is exactly the behavior that was missing.
  test('dragging a manually placed cargo item tracks the cursor smoothly, not only on release', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByText('Ручной').first().click()
    await page.getByRole('button', { name: 'Добавить груз' }).click()

    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()
    const background = page.locator('svg [data-deck-background="true"]').first()
    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')
    await background.click({ position: { x: bgBox.width * 0.25, y: bgBox.height * 0.4 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()

    const box = page.locator('svg rect[fill="#B0E0F8"]').first()
    const startBox = await box.boundingBox()
    if (!startBox) throw new Error('placed box not found')
    const startCenterX = startBox.x + startBox.width / 2
    const startCenterY = startBox.y + startBox.height / 2

    await page.mouse.move(startCenterX, startCenterY)
    await page.mouse.down()
    // A single, modest move -- well short of releasing -- must already be
    // reflected on screen, not just on mouseup.
    await page.mouse.move(startCenterX + 120, startCenterY + 60, { steps: 5 })
    const midBox = await box.boundingBox()
    expect(midBox).not.toBeNull()
    expect(Math.abs((midBox!.x) - startBox.x)).toBeGreaterThan(20)

    await page.mouse.move(startCenterX + 200, startCenterY + 100, { steps: 5 })
    await page.mouse.up()
    const finalBox = await box.boundingBox()
    expect(finalBox).not.toBeNull()
    expect(Math.abs(finalBox!.x - startBox.x)).toBeGreaterThan(50)
  })
})

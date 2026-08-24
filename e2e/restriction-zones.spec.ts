import { test, expect } from '@playwright/test'

test.describe('Restriction (obstacle) zones', () => {
  test('drag-to-create a zone hard-blocks placement inside it and allows placement outside it', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Объекты' }).click()
    await page.getByRole('button', { name: 'Прямоугольник' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const box = await background.boundingBox()
    if (!box) throw new Error('deck background not found')

    // Drag a zone in the top-left quadrant of the deck, in POSITION-relative
    // (not absolute-page) coordinates — the deck's absolute page position
    // shifts as surrounding panels change height (finalize form appearing/
    // disappearing, category list expanding), so every later interaction
    // re-resolves these same relative offsets against a freshly-measured
    // bounding box instead of reusing stale absolute coordinates.
    const relStartX = 40
    const relStartY = 40
    const relEndX = 160
    const relEndY = 120
    await page.mouse.move(box.x + relStartX, box.y + relStartY)
    await page.mouse.down()
    await page.mouse.move(box.x + relEndX, box.y + relEndY, { steps: 10 })
    await page.mouse.up()

    const zoneNameInput = page.getByPlaceholder('Название зоны')
    await expect(zoneNameInput).toBeVisible()
    const zoneForm = zoneNameInput.locator('xpath=ancestor::div[contains(@class, "absolute")][1]')
    await zoneForm.getByRole('button', { name: 'Кран' }).click()
    await zoneForm.getByRole('button', { name: 'Добавить' }).click()

    // A hard-block zone renders as a polygon distinct from cargo footprints.
    await expect(zoneNameInput).toBeHidden()

    // Arm a small cargo item and try to place it inside the zone.
    await page.getByRole('button', { name: 'Контейнеры' }).click()
    await page.getByRole('button', { name: /Паллета EUR/ }).click()

    // Click the actual rendered zone polygon's own screen-space centroid
    // (not a guessed offset from the drag gesture) — robust against any
    // rounding/clamping the draw-to-create step applies to the raw drag.
    const zonePolygon = page.locator('svg polygon[fill^="rgba(220"]').first()
    const zoneBox = await zonePolygon.boundingBox()
    if (!zoneBox) throw new Error('zone polygon not found')
    await page.mouse.click(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2)
    await expect(page.getByText(/Размещено 0 из 0/)).toBeVisible()

    // Placing well outside the zone succeeds.
    const box3 = await background.boundingBox()
    if (!box3) throw new Error('deck background not found (2)')
    await background.click({ position: { x: box3.width - 60, y: box3.height - 40 }, force: true })
    await expect(page.getByText(/Размещено 1 из 1/)).toBeVisible()
  })
})

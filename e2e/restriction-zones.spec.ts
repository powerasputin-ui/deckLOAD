import { test, expect } from '@playwright/test'

test.describe('Restriction (obstacle) zones', () => {
  test('drag-to-create a zone hard-blocks placement inside it and allows placement outside it', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Зоны ограничений' }).click()
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

  test('the drawn shape stays visible on the deck between drag-release and confirming the name (regression)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Зоны ограничений' }).click()
    await page.getByRole('button', { name: 'Прямоугольник' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const box = await background.boundingBox()
    if (!box) throw new Error('deck background not found')

    await page.mouse.move(box.x + 40, box.y + 40)
    await page.mouse.down()
    await page.mouse.move(box.x + 160, box.y + 120, { steps: 10 })
    await page.mouse.up()

    // The finalize form is open, but the drawn shape must already be on
    // screen at this point, not only after "Добавить" is clicked.
    await expect(page.getByPlaceholder('Название зоны')).toBeVisible()
    await expect(page.locator('svg polygon[fill^="rgba(220"]').first()).toBeVisible()
  })

  test('freeform point-by-point drawing produces a zone that also hard-blocks placement', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Зоны ограничений' }).click()
    await page.getByRole('button', { name: /произвольная область/ }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const points: [number, number][] = [
      [40, 40],
      [200, 40],
      [200, 150],
      [40, 150],
    ]
    for (const [x, y] of points) {
      await background.click({ position: { x, y }, force: true })
    }
    await background.click({ position: { x: points[0][0], y: points[0][1] }, force: true })

    const zoneNameInput = page.getByPlaceholder('Название зоны')
    await expect(zoneNameInput).toBeVisible()
    await expect(page.locator('svg polygon[fill^="rgba(220"]').first()).toBeVisible()
    const zoneForm = zoneNameInput.locator('xpath=ancestor::div[contains(@class, "absolute")][1]')
    await zoneForm.getByRole('button', { name: 'Фальшборт' }).click()
    await zoneForm.getByRole('button', { name: 'Добавить' }).click()
    await expect(zoneNameInput).toBeHidden()

    await page.getByRole('button', { name: 'Контейнеры' }).click()
    await page.getByRole('button', { name: /Паллета EUR/ }).click()
    const zonePolygon = page.locator('svg polygon[fill^="rgba(220"]').first()
    const zoneBox = await zonePolygon.boundingBox()
    if (!zoneBox) throw new Error('zone polygon not found')
    await page.mouse.click(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2)
    await expect(page.getByText(/Размещено 0 из 0/)).toBeVisible()
  })
})

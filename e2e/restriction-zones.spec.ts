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
    await expect(page.getByText(/0\/0 ед\./)).toBeVisible()

    // Placing well outside the zone succeeds.
    const box3 = await background.boundingBox()
    if (!box3) throw new Error('deck background not found (2)')
    await background.click({ position: { x: box3.width - 60, y: box3.height - 40 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()
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
    await expect(page.getByText(/0\/0 ед\./)).toBeVisible()
  })

  test('a freeform zone gets corner resize handles that scale its outline, and the delete button does not overlap them (regression)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Зоны ограничений' }).click()
    await page.getByRole('button', { name: /произвольная область/ }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const points: [number, number][] = [
      [40, 40],
      [140, 40],
      [140, 110],
      [40, 110],
    ]
    for (const [x, y] of points) {
      await background.click({ position: { x, y }, force: true })
    }
    await background.click({ position: { x: points[0][0], y: points[0][1] }, force: true })
    const zoneNameInput = page.getByPlaceholder('Название зоны')
    const zoneForm = zoneNameInput.locator('xpath=ancestor::div[contains(@class, "absolute")][1]')
    await zoneForm.getByRole('button', { name: 'Кран' }).click()
    await zoneForm.getByRole('button', { name: 'Добавить' }).click()
    await expect(zoneNameInput).toBeHidden()

    // Select the zone (click its body without moving it).
    const zonePolygon = page.locator('svg polygon[fill^="rgba(220"]').first()
    const before = await zonePolygon.boundingBox()
    if (!before) throw new Error('zone polygon not found')
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)

    // A freeform ('custom') zone must now show 4 corner resize handles,
    // same as the 4 bbox-derived shapes — this used to be entirely absent.
    const handles = page.locator('svg rect[stroke="#dc2626"]')
    await expect(handles).toHaveCount(4)

    // Drag the SE handle outward — the outline must scale with the bbox,
    // not just the bbox numbers, and the zone must not vanish.
    const seHandle = handles.nth(3)
    const handleBox = await seHandle.boundingBox()
    if (!handleBox) throw new Error('resize handle not found')
    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 60, startY + 40, { steps: 10 })
    await page.mouse.up()

    const after = await zonePolygon.boundingBox()
    if (!after) throw new Error('zone polygon vanished after resize')
    expect(after.width).toBeGreaterThan(before.width + 20)
    expect(after.height).toBeGreaterThan(before.height + 15)

    // The delete button (round, red, offset outside the NE corner) must
    // still be independently clickable without triggering a resize.
    const deleteButton = page.locator('svg circle[fill="#ef4444"]').first()
    await expect(deleteButton).toBeVisible()
    const delBox = await deleteButton.boundingBox()
    if (!delBox) throw new Error('delete button not found')
    await page.mouse.click(delBox.x + delBox.width / 2, delBox.y + delBox.height / 2)
    await expect(page.locator('svg polygon[fill^="rgba(220"]')).toHaveCount(0)
  })

  test('dragging a freeform zone across many pointer-move steps keeps its outline in sync with its position (regression: used to drift off the deck)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Зоны ограничений' }).click()
    await page.getByRole('button', { name: /произвольная область/ }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const points: [number, number][] = [
      [40, 40],
      [140, 40],
      [140, 110],
      [40, 110],
    ]
    for (const [x, y] of points) {
      await background.click({ position: { x, y }, force: true })
    }
    await background.click({ position: { x: points[0][0], y: points[0][1] }, force: true })
    const zoneNameInput = page.getByPlaceholder('Название зоны')
    const zoneForm = zoneNameInput.locator('xpath=ancestor::div[contains(@class, "absolute")][1]')
    await zoneForm.getByRole('button', { name: 'Кран' }).click()
    await zoneForm.getByRole('button', { name: 'Добавить' }).click()
    await expect(zoneNameInput).toBeHidden()

    const zonePolygon = page.locator('svg polygon[fill^="rgba(220"]').first()
    const before = await zonePolygon.boundingBox()
    if (!before) throw new Error('zone polygon not found')

    // A real drag fires many intermediate pointermove events — this is
    // exactly what exposed the bug (a one-shot programmatic move did not).
    const startX = before.x + before.width / 2
    const startY = before.y + before.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 80, startY + 30, { steps: 25 })
    await page.mouse.up()

    const after = await zonePolygon.boundingBox()
    if (!after) throw new Error('zone polygon vanished after drag')
    // The shape must keep its own size — a desynced outline would stretch,
    // shrink, or displace the polygon relative to its own bbox, or in the
    // worst case push it far outside the visible deck area entirely.
    expect(Math.abs(after.width - before.width)).toBeLessThan(10)
    expect(Math.abs(after.height - before.height)).toBeLessThan(10)
    const deckBox = await background.boundingBox()
    if (!deckBox) throw new Error('deck background not found')
    expect(after.x).toBeGreaterThan(deckBox.x - 20)
    expect(after.x).toBeLessThan(deckBox.x + deckBox.width + 20)
  })

  test('zone chip width/length fields resize the zone, and the round delete button removes it', async ({ page }) => {
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
    const zoneNameInput = page.getByPlaceholder('Название зоны')
    const zoneForm = zoneNameInput.locator('xpath=ancestor::div[contains(@class, "absolute")][1]')
    await zoneForm.getByRole('button', { name: 'Кран' }).click()
    await zoneForm.getByRole('button', { name: 'Добавить' }).click()
    await expect(zoneNameInput).toBeHidden()

    const zonePolygon = page.locator('svg polygon[fill^="rgba(220"]').first()
    const before = await zonePolygon.boundingBox()
    if (!before) throw new Error('zone polygon not found')

    const widthField = page.getByTitle(/^Ширина/)
    await widthField.fill('3')
    await widthField.blur()
    await expect(async () => {
      const after = await zonePolygon.boundingBox()
      expect(after?.width).toBeLessThan(before.width - 20)
    }).toPass()

    // The round red delete button (matching the one used on placed cargo)
    // removes the zone.
    await page.getByTitle('Удалить зону').click()
    await expect(page.locator('svg polygon[fill^="rgba(220"]')).toHaveCount(0)
  })

  test('the drawing tool disarms itself the moment a zone is finished, so a stray click does not start a second one (regression)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Зоны ограничений' }).click()

    const rectButton = page.getByRole('button', { name: 'Прямоугольник' })
    await rectButton.click()
    await expect(rectButton).toHaveClass(/border-red-400/)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const box = await background.boundingBox()
    if (!box) throw new Error('deck background not found')
    await page.mouse.move(box.x + 40, box.y + 40)
    await page.mouse.down()
    await page.mouse.move(box.x + 160, box.y + 120, { steps: 10 })
    await page.mouse.up()

    // The tool must show as disarmed already — before "Добавить" is even
    // clicked, not only after — since the whole point is that a stray
    // click on the deck in between must not start drawing a second zone.
    await expect(page.getByPlaceholder('Название зоны')).toBeVisible()
    await expect(rectButton).not.toHaveClass(/border-red-400/)

    // A click on empty deck while the name form is still open must not
    // start a second drag-to-create.
    await background.click({ position: { x: 250, y: 200 }, force: true })
    await expect(page.locator('svg polygon[fill^="rgba(220"]')).toHaveCount(1)
  })
})

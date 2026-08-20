import { test, expect } from '@playwright/test'

async function cutTopRightCorner(page: import('@playwright/test').Page) {
  const background = page.locator('svg [data-deck-background="true"]').first()
  await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
  await page.getByRole('button', { name: 'Редактировать' }).click()

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
}

test.describe('Load zones on a non-rectangular deck', () => {
  test('a new zone defaults inside the polygon, not the bounding-box origin', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await cutTopRightCorner(page)

    await page.getByRole('button', { name: 'Зоны нагрузки' }).click()
    await page.getByRole('button', { name: 'Добавить зону' }).click()

    const xInput = page.locator('label:has-text("X (") + input, label:has-text("X (") ~ input').first()
    const xValue = await xInput.inputValue()
    // Bounding-box default would be exactly 0 — a non-zero value confirms
    // the outline-aware centroid default kicked in instead.
    expect(Number(xValue)).toBeGreaterThan(0)
  })

  test('the zone rectangle is clipped to the real deck outline', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await cutTopRightCorner(page)

    await page.getByRole('button', { name: 'Зоны нагрузки' }).click()
    await page.getByRole('button', { name: 'Добавить зону' }).click()

    const clippedGroup = page.locator('svg g[clip-path="url(#deck-outline-clip)"]')
    // At least one clipped group exists (background/grid/free-space already
    // used this) and the zone's own rect must render inside one of them.
    await expect(clippedGroup.first()).toBeVisible()
    const zoneRectInClippedGroup = clippedGroup.locator('rect[stroke-dasharray="6 3"]')
    await expect(zoneRectInClippedGroup.first()).toBeAttached()
  })

  test('dragging a zone toward the cut corner stops at the deck boundary', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await cutTopRightCorner(page)

    await page.getByRole('button', { name: 'Зоны нагрузки' }).click()
    await page.getByRole('button', { name: 'Добавить зону' }).click()

    const xInput = page.locator('label:has-text("X (") + input, label:has-text("X (") ~ input').first()
    const startX = Number(await xInput.inputValue())

    // Drag the zone rect a large distance toward the cut corner (up/right).
    const zoneRect = page.locator('svg rect[stroke-dasharray="6 3"]').first()
    const box = await zoneRect.boundingBox()
    if (!box) throw new Error('zone rect not found')
    const fromX = box.x + box.width / 2
    const fromY = box.y + box.height / 2
    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(fromX + 400, fromY - 400, { steps: 15 })
    await page.mouse.up()

    const endX = Number(await xInput.inputValue())
    // If the drag were unconstrained (old bounding-box-only clamp), a 400px
    // rightward drag on a ~20m-wide deck would move X by several meters.
    // With the polygon gate, the move is rejected once it would cross the
    // real contour, so the change must be far smaller than the raw drag
    // implies (rather than asserting an exact stopping point, which depends
    // on the precise cut geometry from the drag above).
    expect(endX - startX).toBeLessThan(3)
  })
})

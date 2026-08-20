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

  test('a zone can still be freely dragged and resized on a non-rectangular deck (regression: used to freeze solid)', async ({ page }) => {
    // A load zone is only clipped visually to the outline on render — it is
    // NOT hard-gated against the polygon on drag/resize, because a zone can
    // be sized larger than the polygon's extent at some point (e.g. a wide
    // zone alongside a corner cut), and requiring every drag step to land
    // fully inside the polygon made dragging/resizing freeze solid the
    // moment no position satisfied it.
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await cutTopRightCorner(page)

    await page.getByRole('button', { name: 'Зоны нагрузки' }).click()
    await page.getByRole('button', { name: 'Добавить зону' }).click()

    const xInput = page.locator('label:has-text("X (") + input, label:has-text("X (") ~ input').first()
    const widthInput = page.locator('label:has-text("Шир. (") + input, label:has-text("Шир. (") ~ input').first()
    const startX = Number(await xInput.inputValue())
    const startWidth = Number(await widthInput.inputValue())

    // Move it — should actually move, not freeze.
    const zoneRect = page.locator('svg rect[stroke-dasharray="6 3"]').first()
    const box = await zoneRect.boundingBox()
    if (!box) throw new Error('zone rect not found')
    const fromX = box.x + box.width / 2
    const fromY = box.y + box.height / 2
    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(fromX - 60, fromY - 40, { steps: 10 })
    await page.mouse.up()
    const afterMoveX = Number(await xInput.inputValue())
    expect(afterMoveX).not.toBeCloseTo(startX, 1)

    // Resize it via a corner handle — should also actually resize.
    const corner = page.locator('svg circle[fill="#2563eb"]').first()
    const cBox = await corner.boundingBox()
    if (!cBox) throw new Error('resize handle not found')
    const cx = cBox.x + cBox.width / 2
    const cy = cBox.y + cBox.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 30, cy - 20, { steps: 10 })
    await page.mouse.up()
    const afterResizeWidth = Number(await widthInput.inputValue())
    expect(afterResizeWidth).not.toBeCloseTo(startWidth, 1)
  })
})

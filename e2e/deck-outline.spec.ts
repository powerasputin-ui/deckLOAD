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

  test('board offset is still enforced near the deck\'s straight edges after drawing a custom outline', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(3).fill('1') // board offset = 1m

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

    await page.getByText('Ручной').first().click()
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    const itemCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' }).first()
    await itemCard.locator('label:has-text("Кол-во") + input').fill('3')
    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()

    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')

    // Right against the left/bottom edges (straight, unaffected by the
    // top-right cut) — inside the 1m board-offset zone. Must be rejected.
    await background.click({ position: { x: 3, y: bgBox.height - 3 }, force: true })
    await expect(page.getByText(/Размещено 0 из 3/)).toBeVisible()

    // Well past the offset on both axes — must succeed.
    await background.click({ position: { x: bgBox.width * 0.3, y: bgBox.height * 0.7 }, force: true })
    await expect(page.getByText(/Размещено 1 из 3/)).toBeVisible()
  })

  // Regression: handleAutoRedistribute (page.tsx) built packDeckVariants'
  // options without `outline`, so "Автораспределение" on a non-rectangular
  // deck generated candidate layouts as if the deck were still the full
  // rectangle -- items could land in the cut-off area, and the live
  // (correctly outline-aware) recompute right after then flagged those same
  // freshly-created pins as "Закреплённая позиция вне палубы", even though
  // nothing about the deck or cargo was actually invalid -- the variant
  // generator itself had silently ignored the outline.
  test('"Автораспределение" on a non-rectangular deck does not flag its own placements as outside the deck', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

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

    // Auto mode (default) — a sizeable item comfortably below deck capacity
    // (matches the real user report: containers of this size, well under
    // what the deck can hold), so a "doesn't fit" report here can only mean
    // the outline-blind bug, not a genuine capacity shortfall.
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    const itemCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' }).first()
    await itemCard.locator('label:has-text("Кол-во") + input').fill('2')
    await itemCard.locator('label:has-text("Шир. (m)") + input').fill('6')
    await itemCard.locator('label:has-text("Длин. (m)") + input').fill('2.4')

    await page.getByRole('button', { name: 'Автораспределение (варианты)' }).click()
    await page.getByText(/Вариант 1/).click()

    await expect(page.getByText(/Не поместилось/)).not.toBeVisible()
  })
})

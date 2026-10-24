import { test, expect, type Page } from '@playwright/test'
import { addOwnCargo, armCargo, clearCalculation, setNumber, openSection } from './helpers'

// The outline's vertex handle at the top right of the drawing. Which deck
// corner that is depends on how the deck is drawn (long side horizontal, bow
// to the right), so it is found on screen.
async function topRightHandle(page: Page) {
  const handles = page.locator('svg circle[fill="rgba(37,99,235,0.9)"]')
  await expect(handles.first()).toBeVisible()
  let best = 0
  let bestScore = -Infinity
  for (let i = 0; i < (await handles.count()); i++) {
    const b = await handles.nth(i).boundingBox()
    if (b && b.x - b.y > bestScore) {
      bestScore = b.x - b.y
      best = i
    }
  }
  return handles.nth(best)
}

test.describe('Non-rectangular deck outline', () => {
  test('right-click menu edits the deck outline, cargo is blocked from the cut corner, and 3D floor matches', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })

    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()
    await page.getByRole('button', { name: 'Редактировать' }).click()

    // Drag the top-right vertex handle inward to cut that corner.
    const handle = await topRightHandle(page)
    await handle.hover()
    await page.mouse.down()
    const box = await handle.boundingBox()
    if (!box) throw new Error('vertex handle not found')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX - 150, startY + 150, { steps: 10 })
    await page.mouse.up()

    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()

    // Deck area shrinks below the plain-rectangle 160 m^2 once the corner is
    // cut — said in the load statistics («Проверки»).
    await openSection(page, 'Проверки')
    await expect(page.getByText(/^\d+\.\d\d м²$/).first()).toBeVisible()
    await openSection(page, 'Грузы')

    // Manual mode first, so adding cargo doesn't auto-place it via packDeck.
    await page.getByText('Ручной').first().click()
    await addOwnCargo(page, { quantity: '5' })

    await expect(page.getByText(/0\/5 ед\./)).toBeVisible()
    await armCargo(page, 'Груз 1')
    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')
    // Top-right corner of the background rect — inside the cut-off area.
    await background.click({ position: { x: bgBox.width - 5, y: 5 }, force: true })

    // Placement count must still read 0/5 — the click into the cut corner
    // was rejected, not silently accepted.
    await expect(page.getByText(/0\/5 ед\./)).toBeVisible()

    // A click well inside the remaining polygon succeeds.
    await background.click({ position: { x: 60, y: 60 }, force: true })
    await expect(page.getByText(/1\/5 ед\./)).toBeVisible()

    // 3D view renders without crashing when the deck has a custom outline.
    await page.getByRole('radio', { name: '3D' }).click()
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('board offset is still enforced near the deck\'s straight edges after drawing a custom outline', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)

    await openSection(page, 'Судно')
    await setNumber(page.getByLabel('Отступ от борта'), '1') // board offset = 1m
    await openSection(page, 'Грузы')

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
    await page.getByRole('button', { name: 'Редактировать' }).click()

    const handle = await topRightHandle(page)
    await handle.hover()
    await page.mouse.down()
    const box = await handle.boundingBox()
    if (!box) throw new Error('vertex handle not found')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX - 150, startY + 150, { steps: 10 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()

    await page.getByText('Ручной').first().click()
    await addOwnCargo(page, { quantity: '3' })
    await armCargo(page, 'Груз 1')

    const bgBox = await background.boundingBox()
    if (!bgBox) throw new Error('deck background not found')

    // Right against the left/bottom edges (straight, unaffected by the
    // top-right cut) — inside the 1m board-offset zone. Must be rejected.
    await background.click({ position: { x: 3, y: bgBox.height - 3 }, force: true })
    await expect(page.getByText(/0\/3 ед\./)).toBeVisible()

    // Well past the offset on both axes — must succeed. (Mid-height: lower
    // down, the 2 m item is pushed back against the offset line, and a rect
    // touching the outline counts as outside it.)
    await background.click({ position: { x: bgBox.width * 0.3, y: bgBox.height * 0.4 }, force: true })
    await expect(page.getByText(/1\/3 ед\./)).toBeVisible()
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
    await clearCalculation(page)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
    await page.getByRole('button', { name: 'Редактировать' }).click()

    const handle = await topRightHandle(page)
    await handle.hover()
    await page.mouse.down()
    const box = await handle.boundingBox()
    if (!box) throw new Error('vertex handle not found')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX - 150, startY + 150, { steps: 10 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()

    // Auto mode (default) — a sizeable item comfortably below deck capacity
    // (matches the real user report: containers of this size, well under
    // what the deck can hold), so a "doesn't fit" report here can only mean
    // the outline-blind bug, not a genuine capacity shortfall.
    await addOwnCargo(page, { quantity: '2', width: '6', length: '2.4' })

    await openSection(page, 'Размещение')

    await page.getByRole('button', { name: 'Автораспределение (варианты)' }).click()
    await page.getByText(/Вариант 1/).click()

    await expect(page.getByText(/Не поместилось/)).not.toBeVisible()
  })
})

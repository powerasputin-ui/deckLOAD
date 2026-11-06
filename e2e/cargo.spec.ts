import { test, expect } from '@playwright/test'
import { addOwnCargo, armCargo, cargoRow, clearCalculation, openSection } from './helpers'

test.describe('Cargo management', () => {
  test('adding a cargo item increases requested count', async ({ page }) => {
    await page.goto('/')
    // Start with a clean project
    await clearCalculation(page)
    await addOwnCargo(page)
    await expect(cargoRow(page, 'Груз 1')).toBeVisible()
  })

  test('cargo bigger than deck is reported as unplaced', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await addOwnCargo(page, { length: '100', width: '100', quantity: '1' })

    await expect(page.getByText('Превышает размеры палубы')).toBeVisible()
  })

  // Revision 2026-11-05: one button follows the cargo's state. «Поставить»,
  // and once all of the cargo is on the deck the stamp ends by itself and the
  // button is «Убрать»; that takes the cargo off, and «Поставить» is back.
  test('«Поставить» turns into «Убрать» once the cargo is on the deck, and back', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByText('Ручной').first().click()
    await addOwnCargo(page)
    await armCargo(page, 'Груз 1')
    const place = page.getByRole('button', { name: 'Поставить «Груз 1»', exact: true })
    await expect(place).toHaveAttribute('aria-pressed', 'true')
    await page.locator('svg [data-deck-background="true"]').first().click({ position: { x: 60, y: 60 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()
    await expect(page.getByTestId('stamp-hint')).toHaveCount(0)
    await expect(place).toHaveCount(0)
    const takeOff = page.getByRole('button', { name: 'Убрать «Груз 1» с палубы', exact: true })
    await takeOff.click()
    await expect(page.getByText(/0\/1 ед\./)).toBeVisible()
    await expect(takeOff).toHaveCount(0)
    await expect(place).toBeVisible()
    await expect(place).toHaveAttribute('aria-pressed', 'false')
  })

  // Stage 2: the cargo list sits in the left panel with no scroll box of its
  // own — the panel scrolls. That replaced the list's inner scroll and its
  // «Наверх» button, so every card is reached by scrolling the panel.
  test('the cargo list scrolls with the panel and has no scroll box of its own', async ({ page }) => {
    await page.goto('/')
    // Fifteen more rows, from the cargo table's own «Добавить груз».
    await openSection(page, 'Грузы')
    await page.getByRole('button', { name: 'Таблица', exact: true }).click()
    const drawer = page.getByRole('region', { name: 'Таблица грузов' })
    for (let i = 0; i < 15; i++) {
      await drawer.getByRole('button', { name: 'Добавить груз' }).click()
    }
    await drawer.getByRole('button', { name: 'Свернуть таблицу грузов' }).click()
    const list = page.getByRole('list', { name: 'Список грузов' })
    await expect(list.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(0)
    const panel = page.locator('.section-content')
    await expect.poll(() => panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    const lastRow = page.getByTestId('cargo-list-row').last()
    await lastRow.scrollIntoViewIfNeeded()
    await expect(lastRow).toBeInViewport()
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
    await addOwnCargo(page)
    await armCargo(page, 'Груз 1')
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

// Revision 2026-11-06: a cargo that fits no trip has no stack on the deck to
// right-click; its row in the list has a menu that removes it.
test('a cargo that fits no trip goes from its row\'s right-click menu, with an undo', async ({ page }) => {
  await page.goto('/')
  await clearCalculation(page)
  // 30 m long on the 20 m demo deck: no trip takes it.
  await addOwnCargo(page, { name: 'Длинный', length: '30', width: '1', weightT: '5' })
  const misfit = page.getByText(/Не поместилось/)
  await expect(misfit).toBeVisible()

  await cargoRow(page, 'Длинный').getByTitle('Длинный', { exact: true }).click({ button: 'right' })
  await page.getByRole('menu', { name: 'Действия с грузом «Длинный»' }).getByRole('button', { name: 'Удалить груз' }).click()
  await expect(cargoRow(page, 'Длинный')).toHaveCount(0)
  await expect(misfit).toBeHidden()

  await page.locator('[data-sonner-toast]').filter({ hasText: 'Груз «Длинный» удалён' }).getByRole('button', { name: 'Отменить' }).click()
  await expect(cargoRow(page, 'Длинный')).toBeVisible()
})

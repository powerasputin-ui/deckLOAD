import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clearCalculation } from './helpers'

// A minimal valid 1x1 PNG, base64-encoded — enough for the upload path to
// decode it without needing a real photo asset in the repo.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

// The photo is no longer cropped in a dialog: it is uploaded WHOLE and lands
// on the deck as a free rectangle that is then moved/scaled/calibrated in
// place (DeckVisualization's "Фоновое фото" popover).
async function placePhotoOnDeck(page: Page) {
  await page.goto('/')
  await clearCalculation(page)

  const background = page.locator('svg [data-deck-background="true"]').first()
  await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
  await page.getByRole('button', { name: 'Загрузить фото' }).click()
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'deck.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  })
  await expect(page.locator('svg image')).toHaveCount(1)
}

// Opens the photo popover, arms "Переместить / масштабировать", then closes
// the popover so it doesn't cover the editing panel at the canvas' bottom-left.
async function startEditingPhoto(page: Page) {
  await page.getByTitle('Фоновое фото палубы').click()
  await page.getByRole('button', { name: 'Переместить / масштабировать' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Калибровать по известному расстоянию' })).toBeVisible()
}

test.describe('Photo scale calibration', () => {
  test('two-point calibration rescales the photo so the clicked segment equals the real distance', async ({ page }) => {
    await placePhotoOnDeck(page)
    await startEditingPhoto(page)

    const image = page.locator('svg image')
    const background = page.locator('svg [data-deck-background="true"]').first()
    const imageBefore = await image.boundingBox()
    const bgBox = await background.boundingBox()
    if (!imageBefore || !bgBox) throw new Error('photo or deck not found')

    await page.getByRole('button', { name: 'Калибровать по известному расстоянию' }).click()
    await expect(page.getByText(/Отметьте на фото две точки/)).toBeVisible()

    // Two points 200 CSS px apart on the same horizontal line.
    await background.click({ position: { x: 100, y: 60 }, force: true })
    await background.click({ position: { x: 300, y: 60 }, force: true })
    await expect(page.getByText('Введите реальное расстояние между точками')).toBeVisible()

    await page.locator('label:has-text("Реальное расстояние") + input').fill('2')
    await page.getByRole('button', { name: 'Применить', exact: true }).click()

    // The deck is 20 m wide (after "Очистить"), so the clicked segment was
    // 200 * 20 / bgBox.width metres long and the photo must now be scaled by
    // real / current = 2 / that.
    const currentMetres = (200 * 20) / bgBox.width
    const expectedScale = 2 / currentMetres
    await expect(async () => {
      const after = await image.boundingBox()
      expect(after).not.toBeNull()
      expect(after!.width / imageBefore.width).toBeCloseTo(expectedScale, 1)
    }).toPass()

    // Calibration stays armed for another measurement (0 of 2 points), and the
    // photo is still there.
    await expect(page.getByText(/\(0\/2\)/)).toBeVisible()
    await expect(image).toHaveCount(1)
  })

  test('"Применить" stays disabled until the distance is a positive number (comma accepted)', async ({ page }) => {
    await placePhotoOnDeck(page)
    await startEditingPhoto(page)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await page.getByRole('button', { name: 'Калибровать по известному расстоянию' }).click()
    await background.click({ position: { x: 100, y: 60 }, force: true })
    await background.click({ position: { x: 300, y: 60 }, force: true })

    const distance = page.locator('label:has-text("Реальное расстояние") + input')
    const apply = page.getByRole('button', { name: 'Применить', exact: true })
    await expect(apply).toBeDisabled()
    await distance.fill('0')
    await expect(apply).toBeDisabled()
    await distance.fill('2,5')
    await expect(apply).toBeEnabled()
  })

  test('canceling mid-calibration leaves the photo movable', async ({ page }) => {
    await placePhotoOnDeck(page)
    await startEditingPhoto(page)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await page.getByRole('button', { name: 'Калибровать по известному расстоянию' }).click()
    await background.click({ position: { x: 100, y: 60 }, force: true })
    await expect(page.getByText(/\(1\/2\)/)).toBeVisible()

    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Калибровать по известному расстоянию' })).toBeVisible()

    // Dragging the photo still works after the canceled calibration.
    const image = page.locator('svg image')
    const before = await image.boundingBox()
    const svgBox = await page.locator('svg', { has: page.locator('image') }).first().boundingBox()
    if (!before || !svgBox) throw new Error('photo not found')
    // Grab it where it sticks out above the deck: over the deck itself the
    // free-space hatch overlay sits on top of the photo and takes the pointer.
    const startX = before.x + 30
    const startY = svgBox.y + 20
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 40, startY, { steps: 5 })
    await page.mouse.up()

    await expect(async () => {
      const after = await image.boundingBox()
      expect(after).not.toBeNull()
      expect(after!.x - before.x).toBeGreaterThan(20)
    }).toPass()

    await page.getByRole('button', { name: 'Готово', exact: true }).click()
    await expect(image).toHaveCount(1)
  })
})

import { test, expect } from '@playwright/test'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function openCropDialogWithPhoto(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Очистить' }).click()

  const background = page.locator('svg [data-deck-background="true"]').first()
  await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
  await page.getByRole('button', { name: 'Загрузить фото' }).click()
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'deck.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  })
  await expect(page.getByText('Настройте фото палубы')).toBeVisible()
}

test.describe('Photo scale calibration', () => {
  test('two-point calibration applies a zoom and still saves a background image', async ({ page }) => {
    await openCropDialogWithPhoto(page)

    await page.getByRole('button', { name: 'Откалибровать по известному расстоянию' }).click()
    await expect(page.getByText(/отметьте на нём две точки/)).toBeVisible()

    const canvas = page.locator('canvas')
    await canvas.click({ position: { x: 50, y: 50 } })
    await canvas.click({ position: { x: 150, y: 50 } })
    await expect(page.getByText('Введите реальное расстояние между точками')).toBeVisible()

    const distanceInput = page.locator('input[placeholder="напр. 5.2"]')
    await distanceInput.fill('2')
    await page.getByRole('button', { name: 'Применить калибровку' }).click()

    // Back to pan mode, no crash, zoom slider visible again. Exact match:
    // a 1x1 test photo means computeCalibratedZoom's min-cover clamp always
    // fires here (see plan/commit history), and that warning toast's own
    // text contains "масштаб" as a substring, which a non-exact getByText
    // would ambiguously match too.
    await expect(page.getByText('Масштаб', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Откалибровать по известному расстоянию' })).toBeVisible()

    // Confirm still works and produces a background image.
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Настройте фото палубы')).not.toBeVisible()
    await expect(page.locator('svg image')).toHaveCount(1)
  })

  test('an unrealistically small real distance clamps to the cover floor and warns', async ({ page }) => {
    await openCropDialogWithPhoto(page)

    await page.getByRole('button', { name: 'Откалибровать по известному расстоянию' }).click()
    const canvas = page.locator('canvas')
    await canvas.click({ position: { x: 50, y: 50 } })
    await canvas.click({ position: { x: 150, y: 50 } })

    // A tiny real distance implies an unrealistically large scale -> zoom
    // below the cover floor -> must clamp + warn, not silently produce a
    // broken crop.
    const distanceInput = page.locator('input[placeholder="напр. 5.2"]')
    await distanceInput.fill('0.0001')
    await page.getByRole('button', { name: 'Применить калибровку' }).click()

    await expect(page.getByText(/Фото не покрывает всю палубу/)).toBeVisible()
  })

  test('canceling mid-calibration leaves normal pan/drag working', async ({ page }) => {
    await openCropDialogWithPhoto(page)

    await page.getByRole('button', { name: 'Откалибровать по известному расстоянию' }).click()
    const canvas = page.locator('canvas')
    await canvas.click({ position: { x: 50, y: 50 } })
    await expect(page.getByText(/\(1\/2\)/)).toBeVisible()

    await page.getByRole('button', { name: 'Отмена калибровки' }).click()
    await expect(page.getByText('Масштаб')).toBeVisible()

    // Panning still works after a canceled calibration.
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not found')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 5 })
    await page.mouse.up()

    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Настройте фото палубы')).not.toBeVisible()
    await expect(page.locator('svg image')).toHaveCount(1)
  })
})

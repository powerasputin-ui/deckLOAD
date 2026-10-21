import { test, expect } from '@playwright/test'
import { clearCalculation } from './helpers'

// A minimal valid 1x1 PNG, base64-encoded — enough for createImageBitmap to
// decode without needing a real photo asset in the repo.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test.describe('Deck right-click context menu', () => {
  test('dismisses on outside click and on Escape', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()

    // Outside click dismisses it.
    await page.mouse.click(10, 10)
    await expect(page.getByRole('button', { name: 'Редактировать' })).not.toBeVisible()

    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible()

    // Escape dismisses it too.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Редактировать' })).not.toBeVisible()
  })

  test('"Загрузить фото" uploads the same way as the toolbar photo button — the photo lands whole on the deck', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
    await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible()
    await page.getByRole('button', { name: 'Загрузить фото' }).click()

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'deck.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    })

    // No crop dialog any more: the photo is rendered on the deck right away
    // (compressed, never cropped) and can then be moved/scaled in place.
    await expect(page.locator('svg image')).toHaveCount(1)
    await expect(page.getByText('Настройте фото палубы')).toHaveCount(0)
  })
})

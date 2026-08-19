import { test, expect } from '@playwright/test'

// A minimal valid 1x1 PNG, base64-encoded — enough for createImageBitmap to
// decode without needing a real photo asset in the repo.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test.describe('Deck right-click context menu', () => {
  test('dismisses on outside click and on Escape', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

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

  test('"Загрузить фото" opens the same crop flow as the toolbar upload button', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 400, y: 200 }, button: 'right', force: true })
    await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible()
    await page.getByRole('button', { name: 'Загрузить фото' }).click()

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'deck.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    })

    await expect(page.getByText('Настройте фото палубы')).toBeVisible()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Настройте фото палубы')).not.toBeVisible()

    // The cropped/compressed photo is now rendered as the deck background.
    await expect(page.locator('svg image')).toHaveCount(1)
  })
})

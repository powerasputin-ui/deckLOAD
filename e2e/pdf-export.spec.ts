import { test, expect } from '@playwright/test'

test.describe('PDF export', () => {
  test('downloading the deck plan produces a deckload-*.pdf file', async ({ page }) => {
    await page.goto('/')
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Скачать PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
    await expect(page.getByText('PDF скачан')).toBeVisible()
  })

  test('exporting an empty deck does not crash', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Скачать PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
  })

  test('exporting with a power-socket marker on the deck still works (regression: foreignObject tainted the rasterization canvas)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Объекты' }).click()
    await page.getByRole('button', { name: /Розетка/ }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.scrollIntoViewIfNeeded()
    const box = await background.boundingBox()
    if (!box) throw new Error('deck background not found')
    // Click near the left edge — power sockets snap to the nearest point
    // on the deck's own perimeter.
    await page.mouse.click(box.x + 5, box.y + box.height / 2)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Скачать PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
    await expect(page.getByText('PDF скачан')).toBeVisible()
  })
})

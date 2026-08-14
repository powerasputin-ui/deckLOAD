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
})

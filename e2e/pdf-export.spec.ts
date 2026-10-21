import { test, expect } from '@playwright/test'
import { clearCalculation } from './helpers'

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

  // Phase 0, L15: the plan is rasterized from the 2D <svg>, which the 3D
  // view doesn't have — exporting from 3D failed with «Схема палубы ещё не
  // готова». It now switches to 2D for the export and back afterwards.
  test('exporting from the 3D view still downloads the plan and returns to 3D', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: '3D' }).click()
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Скачать PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
    await expect(page.getByRole('radio', { name: '3D' })).toHaveAttribute('data-state', 'on')
  })

  test('exporting an empty deck does not crash', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Скачать PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
  })

  test('exporting with a power-socket marker on the deck still works (regression: foreignObject tainted the rasterization canvas)', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
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

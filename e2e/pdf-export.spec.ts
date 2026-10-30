import { test, expect } from '@playwright/test'
import { clearCalculation, openSection, sheetCount } from './helpers'

test.describe('PDF export', () => {
  // Spec 11: a sheet per trip — the demo is one — and the totals.
  test('downloading the deck plan produces a deckload-*.pdf file with the trip\'s sheet and the totals', async ({ page }) => {
    await page.goto('/')
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Скачать PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
    expect(await sheetCount(download)).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('PDF скачан')).toBeVisible()
  })

  // Phase 0, L15: exporting from 3D failed with «Схема палубы ещё не
  // готова» when the plan was a snapshot of the 2D <svg>. It is drawn from
  // the calculation now, so the view stays as it is.
  test('exporting from the 3D view still downloads the plan and stays in 3D', async ({ page }) => {
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

  test('exporting with a power-socket marker on the deck still works', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await openSection(page, 'Судно')
    await page.getByRole('button', { name: 'Поставить розетку' }).click()

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

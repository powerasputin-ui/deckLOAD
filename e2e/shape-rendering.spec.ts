import { test, expect } from '@playwright/test'

test.describe('Non-rectangular cargo shape rendering', () => {
  test('a preset circle keeps its shape (not a plain box) in manual mode', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByText('Ручной').first().click()

    // Open the presets catalog and arm the "Круг" (circle) template from
    // the "Объекты" category.
    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Объекты' }).click()
    await page.getByText('Круг', { exact: true }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 60, y: 60 }, force: true })

    // The regression: DeckVisualization used to hand-rebuild the manual-mode
    // render list from manualPlacements and drop the `shape` field, so every
    // non-rectangular preset silently fell back to a plain <rect>.
    await expect(page.locator('svg ellipse')).toHaveCount(1)

    // Switching to auto mode and back must not regress it either.
    await page.getByText('Авто').first().click()
    await page.getByText('Ручной').first().click()
    await expect(page.locator('svg ellipse')).toHaveCount(1)
  })
})

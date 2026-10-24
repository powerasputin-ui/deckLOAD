import { test, expect } from '@playwright/test'
import { addOwnCargo, armCargo, clearCalculation, openSection } from './helpers'

test.describe('Lashing points (securing-force check)', () => {
  test('attaching a point to a cargo corner shows a pass/fail marker computed by checkLashingBalance', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByRole('radio', { name: 'Ручной' }).click()

    // Manual mode + a freshly placed item gives a deterministic corner: the
    // stamp's top-left corner lands exactly at the clicked pixel.
    await addOwnCargo(page)
    await armCargo(page, 'Груз 1')
    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 100, y: 100 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()

    await openSection(page, 'Проверки')

    await page.getByRole('button', { name: /Крепление груза/ }).click()
    await page.getByRole('button', { name: 'Добавить крепление' }).click()

    // First click on the placed item near its top-left corner attaches the
    // line's cargo-side end to that corner — a few pixels inside the stack,
    // since its edge may sit a fraction of a pixel off the click that placed
    // it; second click out on open deck sets the anchor.
    await background.click({ position: { x: 106, y: 106 }, force: true })
    await background.click({ position: { x: 250, y: 200 }, force: true })

    // A pass/fail marker must now be rendered for the attached point.
    const marker = page.locator('svg circle[data-lashing-check]')
    await expect(marker.first()).toBeVisible()

    // The sidebar's summary line reflects at least one secured/attached point.
    await expect(page.getByText(/Закреплено грузов: 1/)).toBeVisible()
  })
})

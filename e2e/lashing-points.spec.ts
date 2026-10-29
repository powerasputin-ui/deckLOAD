import { test, expect } from '@playwright/test'
import { addOwnCargo, armCargo, clearCalculation, inspector } from './helpers'

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

    // The stack's «Крепление» is in its inspector (spec 6.5): Esc puts the
    // cargo away, a click on the stack selects it.
    await page.keyboard.press('Escape')
    await expect(async () => {
      await page.locator('svg g[data-cargo-name="Груз 1"]').first().click({ force: true })
      await expect(inspector(page)).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    const lashing = inspector(page).getByTestId('inspector-lashing')
    await lashing.getByText('Крепление', { exact: true }).click()
    await lashing.getByRole('button', { name: 'Добавить точку крепления' }).click()

    // First click on the placed item near its top-left corner attaches the
    // line's cargo-side end to that corner — a few pixels inside the stack,
    // since its edge may sit a fraction of a pixel off the click that placed
    // it; second click out on open deck sets the anchor.
    await background.click({ position: { x: 106, y: 106 }, force: true })
    await background.click({ position: { x: 250, y: 200 }, force: true })

    // A pass/fail marker must now be rendered for the attached point.
    const marker = page.locator('svg circle[data-lashing-check]')
    await expect(marker.first()).toBeVisible()

    // The inspector counts it against what the norms ask, and lists it.
    // «Груз 1» has no weight: the norms can't say how many, so only what's set.
    await expect(lashing.getByTestId('lashing-count')).toHaveText('Задано точек: 1')
    await expect(lashing.getByRole('list', { name: 'Точки крепления штабеля' }).getByRole('listitem')).toHaveCount(1)
  })
})

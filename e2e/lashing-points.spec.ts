import { test, expect } from '@playwright/test'

test.describe('Lashing points (securing-force check)', () => {
  test('attaching a point to a cargo corner shows a pass/fail marker computed by checkLashingBalance', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('radio', { name: 'Ручной' }).click()

    // Manual mode + a freshly placed item gives a deterministic corner: the
    // stamp's top-left corner lands exactly at the clicked pixel.
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()
    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 100, y: 100 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()

    await page.getByRole('button', { name: /Крепление груза/ }).click()
    await page.getByRole('button', { name: 'Добавить крепление' }).click()

    // First click on the placed item's top-left corner attaches the line's
    // cargo-side end; second click out on open deck sets the anchor.
    await background.click({ position: { x: 100, y: 100 }, force: true })
    await background.click({ position: { x: 250, y: 200 }, force: true })

    // A pass/fail marker (green #16a34a or red #dc2626 anchor circle) must
    // now be rendered for the attached point.
    const marker = page.locator('svg circle[fill="#16a34a"], svg circle[fill="#dc2626"]')
    await expect(marker.first()).toBeVisible()

    // The sidebar's summary line reflects at least one secured/attached point.
    await expect(page.getByText(/Закреплено грузов: 1/)).toBeVisible()
  })
})

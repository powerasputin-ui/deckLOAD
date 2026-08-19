import { test, expect } from '@playwright/test'

test.describe('Click-to-place quantity cap', () => {
  test('is scoped per item, not a global sum across every cargo type', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByText('Ручной').first().click()

    // Two items, quantity 1 each — the bug let placing item A a second time
    // succeed as long as item B's quota (quantity 1, unplaced) hadn't been
    // used yet, since the check summed BOTH items' quantities together.
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()

    // Arm and place item 1 (top-left area of the deck). `force: true` skips
    // Playwright's actionability check, which the free-space hatch overlay
    // (a sibling rect painted on top) otherwise fails — same pattern already
    // used for SVG clicks elsewhere in this suite.
    await page.getByText('Груз 1', { exact: true }).first().click()
    await background.click({ position: { x: 40, y: 40 }, force: true })
    await expect(page.getByText('Размещено 1 из 2')).toBeVisible()

    // Item 1's stamp stays armed — click empty deck elsewhere to try placing
    // a SECOND unit of item 1, whose own quantity (1) is already satisfied.
    await background.click({ position: { x: 300, y: 200 }, force: true })
    await expect(page.getByText(/Все 1 ед\. груза «Груз 1» уже размещены/)).toBeVisible()
    await expect(page.getByText('Размещено 1 из 2')).toBeVisible()

    // Item 2 is unaffected — still places normally.
    await page.getByText('Груз 2', { exact: true }).first().click()
    await background.click({ position: { x: 300, y: 200 }, force: true })
    await expect(page.getByText('Размещено 2 из 2')).toBeVisible()
  })
})

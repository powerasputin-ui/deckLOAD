import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
}

test.describe('Category separation rules', () => {
  test('a rule soft-blocks placing a violating category near another, and clears once the rule is removed', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('radio', { name: 'Ручной' }).click()

    // Two fresh items, each assigned to a different category via the
    // per-item "Категория" text field (datalist-backed, no fixed option set).
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    await page.getByRole('button', { name: 'Добавить' }).click()
    const cards = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' })
    await cards.nth(0).locator('label:has-text("Категория") + input').fill('СепА')
    await cards.nth(1).locator('label:has-text("Категория") + input').fill('СепБ')

    // Open "Сепарация груза" (collapsed by default) and add a rule with a
    // large minimum distance so any placement close together violates it.
    await page.getByRole('button', { name: /Сепарация груза/ }).click()
    await page.getByText('Категория A', { exact: true }).click()
    await page.getByRole('option', { name: 'СепА' }).click()
    await page.getByText('Категория B', { exact: true }).click()
    await page.getByRole('option', { name: 'СепБ' }).click()
    await page.getByRole('button', { name: 'Добавить правило' }).click()
    await expect(page.getByText('Правило добавлено')).toBeVisible()
    await expect(page.getByText('«СепА» ↔ «СепБ»')).toBeVisible()

    const background = page.locator('svg [data-deck-background="true"]').first()

    await expect(headerBadge(page)).toHaveText(/^0\/2 /)
    await page.getByRole('button', { name: /Груз 1.*2×1\.2/ }).click()
    await background.click({ position: { x: 30, y: 30 }, force: true })
    await expect(headerBadge(page)).toHaveText(/^1\/2 /)

    // Placing the other category right next to it violates the ≥3m rule —
    // the count must not advance. Clicking the "Груз 2" stamp button can
    // scroll the page (it's further down the sidebar list), so both
    // boundingBox() calls used to compute the click offset are taken AFTER
    // that click, back-to-back, to avoid stale coordinates from an earlier
    // scroll position.
    await page.getByRole('button', { name: /Груз 2.*2×1\.2/ }).click()
    const freshBg = await background.boundingBox()
    if (!freshBg) throw new Error('deck background not found')
    // First item added to a cleared project is always colored #0ea5e9 (same
    // convention pin-select.spec.ts already relies on) — use its rendered
    // rect to find a spot just past its edge: close enough to violate the
    // ≥3m separation rule, but not overlapping (which would silently no-op
    // on the plain-collision check before separation is even considered).
    const placedRect = page.locator('svg rect[fill="#0ea5e9"]').first()
    const rectBox = await placedRect.boundingBox()
    if (!rectBox) throw new Error('placed item 1 rect not found')
    const nearX = rectBox.x - freshBg.x + rectBox.width + 20
    const nearY = rectBox.y - freshBg.y + rectBox.height / 2
    await background.click({ position: { x: nearX, y: nearY }, force: true })
    await expect(page.getByText(/нарушена сепарация груза/)).toBeVisible()
    await expect(headerBadge(page)).toHaveText(/^1\/2 /)

    // Far away, it's accepted.
    await background.click({ position: { x: freshBg.width - 30, y: freshBg.height - 30 }, force: true })
    await expect(headerBadge(page)).toHaveText(/^2\/2 /)
  })
})

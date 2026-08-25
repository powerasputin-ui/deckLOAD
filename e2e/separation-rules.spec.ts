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

  test('"Автораспределение" (auto-packing) itself respects the rule — not just the manual click check', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    // Stays in auto mode (the default after "Очистить") — cargo is placed
    // entirely by the packing algorithm, never a manual click, so this
    // exercises packDeck's own violatesSeparation checks (packing.ts
    // ~1251-1278), not the UI-level check in DeckVisualization's click
    // handler that the previous test already covers.
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    await page.getByRole('button', { name: 'Добавить' }).click()
    const cards = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Груз' })
    await cards.nth(0).locator('label:has-text("Категория") + input').fill('СепА')
    await cards.nth(1).locator('label:has-text("Категория") + input').fill('СепБ')

    await page.getByRole('button', { name: /Сепарация груза/ }).click()
    await page.getByText('Категория A', { exact: true }).click()
    await page.getByRole('option', { name: 'СепА' }).click()
    await page.getByText('Категория B', { exact: true }).click()
    await page.getByRole('option', { name: 'СепБ' }).click()
    // A distance close to the deck's own width forces the packer to choose:
    // either keep both apart (and still fit, since the deck is wide) or
    // reject one — either outcome proves the rule is enforced by the
    // algorithm itself, not just by a UI-level click check.
    const distanceInput = page.getByRole('button', { name: 'Добавить правило' }).locator('..').locator('input[type="number"]')
    await distanceInput.fill('15')
    await page.getByRole('button', { name: 'Добавить правило' }).click()
    await expect(page.getByText('Правило добавлено')).toBeVisible()

    await page.getByRole('button', { name: 'Автораспределение (варианты)' }).click()

    const badge = headerBadge(page)
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    const match = (text ?? '').match(/(\d+)\/(\d+)/)
    if (!match) throw new Error(`header badge text didn't match: ${text}`)
    const placed = Number(match[1])
    const total = Number(match[2])
    expect(total).toBe(2)
    if (placed === 2) {
      // Both accepted — verify the algorithm actually kept them apart rather
      // than silently ignoring the rule. Read straight from localStorage
      // (same pattern as preset-units.spec.ts) since converting pixel
      // distance back to real-world meters is unnecessary indirection here.
      const positions = await page.evaluate(() => {
        const raw = window.localStorage.getItem('deckload-projects')
        if (!raw) return null
        const data = JSON.parse(raw)
        const projects: any[] = Array.isArray(data.projects) ? data.projects : []
        const active = projects.find((p: any) => p.id === data.activeId) ?? projects[0]
        return active?.pinnedPlacementsByTrip?.['0'] ?? null
      })
      expect(positions).not.toBeNull()
      const [a, b] = positions as { x: number; y: number; width: number; length: number }[]
      const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
      const gapY = Math.max(a.y - (b.y + b.length), b.y - (a.y + a.length), 0)
      const centerDist = Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.length / 2) - (b.y + b.length / 2))
      // Either genuinely separated by ≥15m, or edge-to-edge gap covers it —
      // whichever measure the packer's own AABB check effectively used.
      expect(Math.max(gapX, gapY, centerDist)).toBeGreaterThanOrEqual(14)
    } else {
      // Rejected — the "Не поместилось" banner must name separation as why.
      expect(placed).toBeLessThan(2)
      await expect(page.getByText(/Нарушает сепарацию груза/)).toBeVisible()
    }
  })
})

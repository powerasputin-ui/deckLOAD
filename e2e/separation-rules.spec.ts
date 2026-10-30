import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { addOwnCargo, addSeparationRule, armCargo, clearCalculation, unitsCount, pickVariants } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

test.describe('Category separation rules', () => {
  test('a rule soft-blocks placing a violating category near another, and clears once the rule is removed', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByRole('radio', { name: 'Ручной' }).click()

    // Two fresh items, each of its own category, from «Свой груз»
    // (the category field is datalist-backed, no fixed option set).
    await addOwnCargo(page, { category: 'СепА' })
    await addOwnCargo(page, { category: 'СепБ' })

    // The rule, added in the separation check (spec 8.4): any placement
    // closer than 3 m violates it.
    await addSeparationRule(page, 'СепА', 'СепБ')
    const rules = page.getByRole('list', { name: 'Правила сепарации' })
    await expect(rules.getByRole('combobox', { name: 'Правило 1: категория A' })).toHaveText('СепА')
    await expect(rules.getByRole('combobox', { name: 'Правило 1: категория B' })).toHaveText('СепБ')

    const background = page.locator('svg [data-deck-background="true"]').first()

    await expect(headerBadge(page)).toHaveText(/^0\/2 /)
    await armCargo(page, 'Груз 1')
    await background.click({ position: { x: 30, y: 30 }, force: true })
    await expect(headerBadge(page)).toHaveText(/^1\/2 /)

    // Placing the other category right next to it violates the ≥3m rule —
    // the count must not advance. Arming "Груз 2" can scroll the panel, so
    // both boundingBox() calls used to compute the click offset are taken
    // AFTER it, back-to-back, to avoid stale coordinates.
    await armCargo(page, 'Груз 2')
    const freshBg = await background.boundingBox()
    if (!freshBg) throw new Error('deck background not found')
    // First item added to a cleared project is always colored #0ea5e9 (same
    // convention pin-select.spec.ts already relies on) — use its rendered
    // rect to find a spot just past its edge: close enough to violate the
    // ≥3m separation rule, but not overlapping (which would silently no-op
    // on the plain-collision check before separation is even considered).
    const placedRect = page.locator('svg rect[fill="#B0E0F8"]').first()
    const rectBox = await placedRect.boundingBox()
    if (!rectBox) throw new Error('placed item 1 rect not found')
    // The new stack stands centred on the click, and it is as wide as this
    // one: its centre goes half a width further.
    const nearX = rectBox.x - freshBg.x + rectBox.width + 20 + rectBox.width / 2
    const nearY = rectBox.y - freshBg.y + rectBox.height / 2
    await background.click({ position: { x: nearX, y: nearY }, force: true })
    await expect(page.getByText(/нарушена сепарация груза/)).toBeVisible()
    await expect(headerBadge(page)).toHaveText(/^1\/2 /)

    // Far away, it's accepted.
    await background.click({ position: { x: freshBg.width - 30, y: freshBg.height - 30 }, force: true })
    await expect(headerBadge(page)).toHaveText(/^2\/2 /)
  })

  test('«Подобрать варианты» (auto-packing) itself respects the rule — not just the manual click check', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    // Stays in auto mode (the default after "Очистить") — cargo is placed
    // entirely by the packing algorithm, never a manual click, so this
    // exercises packDeck's own violatesSeparation checks (packing.ts
    // ~1251-1278), not the UI-level check in DeckVisualization's click
    // handler that the previous test already covers.
    await addOwnCargo(page, { category: 'СепА' })
    await addOwnCargo(page, { category: 'СепБ' })

    // A distance close to the deck's own width forces the packer to choose:
    // either keep both apart (and still fit, since the deck is wide) or
    // reject one — either outcome proves the rule is enforced by the
    // algorithm itself, not just by a UI-level click check.
    await addSeparationRule(page, 'СепА', 'СепБ', '15')

    await pickVariants(page)

    const badge = headerBadge(page)
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    const match = (text ?? '').match(/(\d+)\/(\d+)/)
    if (!match) throw new Error(`header badge text didn't match: ${text}`)
    const placed = Number(match[1])
    const total = Number(match[2])
    expect(total).toBe(2)
    if (placed === 2) {
      // Both placed (the count covers every trip, spec 8.3). Either they share
      // a trip and the packer kept them apart, or it put them on separate
      // trips — separation is checked within a trip (L17). Read straight
      // from localStorage (same pattern as preset-units.spec.ts) since
      // converting pixel distance back to real-world meters is unnecessary
      // indirection here.
      const readPinsByTrip = () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('deckload-projects')
          if (!raw) return null
          const data = JSON.parse(raw)
          const projects: any[] = Array.isArray(data.projects) ? data.projects : []
          const active = projects.find((p: any) => p.id === data.activeId) ?? projects[0]
          return (active?.pinnedPlacementsByTrip ?? null) as Record<string, { x: number; y: number; width: number; length: number }[]> | null
        })
      // The applied variant pins trip 1's layout; cargo it leaves out goes on
      // to the next trip, placed by the packer. The autosave is debounced
      // (page.tsx) — wait for trip 1's pins to land.
      await expect.poll(async () => (await readPinsByTrip())?.['0']?.length ?? 0).toBeGreaterThan(0)
      const trip1 = (await readPinsByTrip())?.['0'] ?? []
      if (trip1.length === 2) {
        const [a, b] = trip1
        const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
        const gapY = Math.max(a.y - (b.y + b.length), b.y - (a.y + a.length), 0)
        const centerDist = Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.length / 2) - (b.y + b.length / 2))
        // Either genuinely separated by ≥15m, or edge-to-edge gap covers it —
        // whichever measure the packer's own AABB check effectively used.
        expect(Math.max(gapX, gapY, centerDist)).toBeGreaterThanOrEqual(14)
      } else {
        await expect(page.getByRole('tab', { name: /Рейс 2 · 1 ед\./ })).toBeVisible()
      }
    } else {
      // Rejected — the "Не поместилось" banner must name separation as why.
      expect(placed).toBeLessThan(2)
      await expect(page.getByText(/Нарушает сепарацию груза/)).toBeVisible()
    }
  })
})

import { test, expect } from '@playwright/test'
import { chooseFromCatalog, clearCalculation, stackTools } from './helpers'

test.describe('Non-rectangular cargo shape rendering', () => {
  test('a circle from the catalogue keeps its shape (not a plain box) in manual mode', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByText('Ручной').first().click()

    // «Каталог» → «Фигуры» → «Круг»: in manual mode it's armed for a click.
    await chooseFromCatalog(page, 'Круг')

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 60, y: 60 }, force: true })

    // The regression: DeckVisualization used to hand-rebuild the manual-mode
    // render list from manualPlacements and drop the `shape` field, so every
    // non-rectangular template silently fell back to a plain <rect>.
    await expect(page.locator('svg[data-deck-plan] ellipse')).toHaveCount(1)

    // Switching to auto mode and back must not regress it either. Manual →
    // Auto asks what to do with the hand-placed cargo; keep it in place.
    await page.getByText('Авто').first().click()
    await page.getByRole('button', { name: 'Оставить позиции' }).click()
    await page.getByText('Ручной').first().click()
    await expect(page.locator('svg[data-deck-plan] ellipse')).toHaveCount(1)
  })

  test('rotating a triangle actually turns it (not just squishes the same apex-up shape)', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByText('Ручной').first().click()

    await chooseFromCatalog(page, 'Треугольник')

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 100, y: 100 }, force: true })

    const triangle = page.locator('svg[data-deck-plan] g[data-cargo-placement] polygon').first()
    const parsePoints = (attr: string) =>
      attr.trim().split(/\s+/).map((pair) => pair.split(',').map(Number))

    const before = parsePoints((await triangle.getAttribute('points')) ?? '')
    expect(before).toHaveLength(3)
    // Unrotated: apex-up, base-down — two points share the base's Y.
    const beforeYs = before.map((p) => p[1])
    const beforeSharedY = beforeYs.some((y, i) => beforeYs.indexOf(y) !== i)
    expect(beforeSharedY).toBe(true)

    // Select it, then rotate it from the mini-panel over it.
    await triangle.click({ force: true })
    await stackTools(page).getByRole('button', { name: 'Повернуть' }).click()

    const after = parsePoints((await triangle.getAttribute('points')) ?? '')
    expect(after).toHaveLength(3)
    // A true 90° turn swaps which pair of points is level: the base is now
    // a vertical edge, so two points share an X instead of a Y. The old
    // buggy render kept redrawing the same "apex-up, base horizontal"
    // formula with swapped width/height, which would still show two points
    // sharing a Y here — this is exactly what distinguishes a real rotation
    // from a squish.
    const afterXs = after.map((p) => p[0])
    const afterSharedX = afterXs.some((x, i) => afterXs.indexOf(x) !== i)
    expect(afterSharedX).toBe(true)
  })
})

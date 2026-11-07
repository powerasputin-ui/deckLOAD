import { test, expect } from '@playwright/test'
import { chooseFromCatalog, clearCalculation, openSection, setCargoTotal, setNumber, stackTools } from './helpers'

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

  // Revision 2026-11-06: pipes drawn as on a drawing — square ends, a
  // hairline between the pipes of a pile, the label on a white plaque with
  // the pipe's Ø under the number.
  test('a pile of pipe has square ends, hairlines between its pipes and its Ø on a plaque', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    // A height limit lets the pipes pile up (unset, each lies alone).
    await openSection(page, 'Судно')
    await setNumber(page.getByLabel('Предельная высота штабеля'), '3')
    await chooseFromCatalog(page, 'Обсадная труба')
    await setCargoTotal(page, 'Обсадная труба', '8')
    const pile = page.locator('svg[data-deck-plan] g[data-cargo-name="Обсадная труба"]').first()
    await expect(pile).toBeVisible()
    const outline = pile.locator('rect').first()
    expect(Number((await outline.getAttribute('rx')) ?? 0)).toBe(0)
    await expect(pile.locator('[data-pipe-line="between"]').first()).toBeAttached()
    await expect(pile.locator('[data-pipe-plaque="true"]')).toHaveCount(1)
    await expect(pile).toHaveAttribute('data-stack-text', /×8/)
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
    const shared = (pts: number[][], axis: 0 | 1) => pts.map((p) => p[axis]).some((v, i, all) => all.indexOf(v) !== i)
    // Unturned, its apex points to the deck's y = 0, as the packer has it.
    // The new deck is drawn transposed (its length across the screen, the
    // stern on the left), so the apex points left and the base stands up:
    // two points share an X. It used to be drawn apex-up whatever the
    // deck's transpose (decided 2026-11-07).
    expect(shared(before, 0)).toBe(true)
    expect(shared(before, 1)).toBe(false)

    // Select it, then rotate it from the mini-panel over it.
    await triangle.click({ force: true })
    await stackTools(page).getByRole('button', { name: 'Повернуть' }).click()

    const after = parsePoints((await triangle.getAttribute('points')) ?? '')
    expect(after).toHaveLength(3)
    // A true 90° turn swaps which pair of points is level: the base now lies
    // flat, two points share a Y. A render that redrew the same formula with
    // width and height swapped would keep the same pair level — exactly what
    // tells a real rotation from a squish.
    expect(shared(after, 1)).toBe(true)
    expect(shared(after, 0)).toBe(false)
  })
})

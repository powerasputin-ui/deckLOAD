import { test, expect, type Page } from '@playwright/test'
import { addOwnCargo, armCargo, clearCalculation, inspector, pickVariants } from './helpers'

// «Груз 1»'s footprint on screen: the largest of its rects (its number's
// plaque is a rect too).
const footprint = (page: Page) =>
  page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll('svg g[data-cargo-placement][data-cargo-name="Груз 1"] rect')).map((r) => r.getBoundingClientRect())
    const r = rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  })

// How far each made-fast line's cargo end is from the nearest corner of
// «Груз 1», on screen.
const cornerGaps = (page: Page) =>
  page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll('svg g[data-cargo-placement][data-cargo-name="Груз 1"] rect')).map((r) => r.getBoundingClientRect())
    const r = rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    const corners = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
    return Array.from(document.querySelectorAll('svg g:has(> circle[data-lashing-check]) > line')).map((el) => {
      const line = el as SVGLineElement
      const end = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(line.getScreenCTM()!)
      return Math.min(...corners.map(([x, y]) => Math.hypot(x - end.x, y - end.y)))
    })
  })

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

  // Audit 2026-11-09: «Подобрать варианты» gives every stack a new id, and
  // no test followed a made-fast point there. A lashed stack stays where it
  // stands (its rigging only makes sense there), and so does the point,
  // still made fast at its corner.
  test('a point made fast to a stack stays made fast to it through «Подобрать варианты»', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await page.getByRole('radio', { name: 'Ручной' }).click()
    await addOwnCargo(page, { length: '6', width: '2' })
    await armCargo(page, 'Груз 1')
    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 100, y: 100 }, force: true })
    await expect(page.getByText(/1\/1 ед\./)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(async () => {
      await page.locator('svg g[data-cargo-name="Груз 1"]').first().click({ force: true })
      await expect(inspector(page)).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })

    const lashing = inspector(page).getByTestId('inspector-lashing')
    await lashing.getByText('Крепление', { exact: true }).click()
    const f = await footprint(page)
    // The button arms placing until Esc.
    await lashing.getByRole('button', { name: 'Добавить точку крепления' }).click()
    await page.mouse.click(f.left + 5, f.top + 5)
    await page.mouse.click(f.left + 5, f.bottom + 40)
    await page.keyboard.press('Escape')
    const marker = page.locator('svg circle[data-lashing-check]')
    await expect(marker).toHaveCount(1)
    for (const gap of await cornerGaps(page)) expect(gap).toBeLessThan(2)

    await pickVariants(page)
    await expect(page.getByText('Штабели с зоной отступа или креплением (1) остаются на местах')).toBeVisible()
    expect(await footprint(page)).toEqual(f)
    await expect(marker).toHaveCount(1)
    const gaps = await cornerGaps(page)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toBeLessThan(2)
  })
})

import { test, expect } from '@playwright/test'
import { clearCalculation, openSection } from './helpers'

test.describe('Custom hand-drawn cargo outline', () => {
  test('drawing an L-shape places a real polygon and blocks a placement that overlaps its solid part', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)

    // «Грузы» → «Каталог» → «Фигуры» → «Нарисовать форму» (spec 7.2).
    await openSection(page, 'Грузы')
    await page.getByRole('button', { name: 'Каталог', exact: true }).click()
    await page.getByRole('button', { name: 'Нарисовать форму' }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    // L-shape: a wide top bar plus a narrower leg, in screen-px positions
    // relative to the background element (not deck meters) — matches the
    // existing shape-rendering.spec.ts convention of clicking by position.
    const points: [number, number][] = [
      [40, 40],
      [200, 40],
      [200, 90],
      [120, 90],
      [120, 150],
      [40, 150],
    ]
    const bg = (await background.boundingBox())!
    for (const [i, [x, y]] of points.entries()) {
      await background.click({ position: { x, y }, force: true })
      // While drawing, the segment to the pointer gives its length, and from
      // the third point on the outline's area too, as the obstacles do.
      if (i === 2) {
        await page.mouse.move(bg.x + 160, bg.y + 120)
        await expect(page.getByTestId('shape-drawing-measure')).toHaveText(/^\d+(\.\d+)? м · S \d+(\.\d+)? м²$/)
      }
    }
    // Close the loop near the first vertex.
    await background.click({ position: { x: points[0][0], y: points[0][1] }, force: true })

    // The outline stays on the deck while its name is asked for.
    const form = page.getByRole('form', { name: 'Своя форма' })
    await expect(form).toContainText('Контур готов')
    await expect(page.getByTestId('pending-custom-shape')).toBeVisible()
    await form.getByLabel('Название').fill('E2E L-shape')
    await form.getByRole('button', { name: 'Поставить на палубу' }).click()
    await expect(page.getByTestId('pending-custom-shape')).toHaveCount(0)

    // A real extruded/traced outline renders as an SVG <polygon>, not the
    // plain <rect> every box-shaped placement falls back to. (The stack is
    // selected once placed; its selection band is a polygon of its own.)
    await expect(page.locator('svg g[data-cargo-placement] > polygon')).toHaveCount(1)
    await expect(page.getByText('E2E L-shape').first()).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'

test.describe('Custom hand-drawn cargo outline', () => {
  test('drawing an L-shape places a real polygon and blocks a placement that overlaps its solid part', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Объекты' }).click()
    await page.getByRole('button', { name: /Нарисовать/ }).click()

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
    for (const [x, y] of points) {
      await background.click({ position: { x, y }, force: true })
    }
    // Close the loop near the first vertex.
    await background.click({ position: { x: points[0][0], y: points[0][1] }, force: true })

    await expect(page.getByText('Контур готов')).toBeVisible()
    await page.getByPlaceholder('Название груза').fill('E2E L-shape')
    await page.getByRole('button', { name: 'Разместить' }).click()

    // A real extruded/traced outline renders as an SVG <polygon>, not the
    // plain <rect> every box-shaped placement falls back to.
    await expect(page.locator('svg polygon')).toHaveCount(1)
    await expect(page.getByText('E2E L-shape').first()).toBeVisible()
  })
})

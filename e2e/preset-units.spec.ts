import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

test.describe('Preset dimensions follow the current unit', () => {
  test('the catalog chip shows ft-converted dims, and placing it creates a correctly-sized item (regression: presets are authored in meters but were shown/placed unconverted)', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    // Manual mode makes click-to-place unambiguous (auto mode's packer may
    // silently reject/ignore a click over already-occupied space).
    await page.getByRole('radio', { name: 'Ручной' }).click()

    // Switch to feet before opening the preset catalog.
    await page.getByRole('radio', { name: 'фт' }).click()
    await expect(page.getByText('20 м')).not.toBeVisible()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Контейнеры' }).click()

    // "Химический танк-контейнер 2500л" is 1.8 x 1.8 m in the PRESETS
    // catalog (never placed by the demo project) — in ft that's ~5.91 x
    // 5.91, never 1.8/1.8 (which would be the un-converted bug). Locate the
    // catalog chip by its name text, then its enclosing <button>, so the
    // assertion isn't coupled to exact accessible-name whitespace/joining.
    const chip = page.locator('button', { has: page.getByText('Химический танк-контейнер 2500л', { exact: true }) })
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('5.91')

    await chip.click()
    const deckSvg = page.locator('svg').filter({ has: page.locator('[data-deck-background="true"]') }).first()
    // Arming the chip requires scrolling the preset bar (which lives BELOW
    // the deck) into view, which pushes the deck partly off the top of the
    // viewport — box.y goes negative. page.mouse.click() takes viewport
    // coordinates, so a candidate point near the deck's top edge then
    // resolves to a NEGATIVE y, lands outside the deck entirely, and
    // silently disarms the chip; the loop below reads that as "placed" and
    // breaks having placed nothing. Scroll the deck back into view and
    // re-measure so every candidate is a real on-deck point.
    await deckSvg.scrollIntoViewIfNeeded()
    const box = await deckSvg.boundingBox()
    if (!box) throw new Error('deck svg not visible')
    // Try a spread of points across the deck — the demo project is ~50%
    // full, so some spots will collide with existing cargo; retry until one
    // lands in free space (confirmed by the armed chip losing its "активен"
    // state, i.e. the click actually placed something).
    const candidates = [
      [0.08, 0.08], [0.5, 0.08], [0.9, 0.08],
      [0.08, 0.5], [0.5, 0.5], [0.9, 0.5],
      [0.08, 0.9], [0.5, 0.9], [0.9, 0.9],
    ]
    const viewport = page.viewportSize()
    for (const [fx, fy] of candidates) {
      const stillArmed = await page.getByRole('button', { name: /активен/ }).count()
      if (stillArmed === 0) break
      const x = box.x + box.width * fx
      const y = box.y + box.height * fy
      // Never click outside the viewport — that hits nothing, disarms the
      // chip, and ends the loop early with a false "placed" signal.
      if (y < 0 || x < 0 || (viewport && (y > viewport.height || x > viewport.width))) continue
      await page.mouse.click(x, y)
      await page.waitForTimeout(150)
    }

    // The new item's own width (persisted in the deck's current unit, ft
    // here) must be the ft-converted value, not the raw 1.8m from PRESETS —
    // check the actual stored project data rather than a DOM field, since
    // several items in the demo project can share similar-looking width
    // inputs and make a generic "last matching input" locator ambiguous.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const raw = window.localStorage.getItem('deckload-projects')
        if (!raw) return null
        const data = JSON.parse(raw)
        const projects: any[] = Array.isArray(data.projects) ? data.projects : []
        const active = projects.find((p: any) => p.id === data.activeId) ?? projects[0]
        const item = active?.items?.find((it: any) => it.name === 'Химический танк-контейнер 2500л')
        return item?.width ?? null
      })
    }).not.toBeNull()

    const storedWidth = await page.evaluate(() => {
      const raw = window.localStorage.getItem('deckload-projects')
      if (!raw) return null
      const data = JSON.parse(raw)
      const projects: any[] = Array.isArray(data.projects) ? data.projects : []
      const active = projects.find((p: any) => p.id === data.activeId) ?? projects[0]
      const item = active?.items?.find((it: any) => it.name === 'Химический танк-контейнер 2500л')
      return item?.width ?? null
    })
    expect(storedWidth).not.toBeNull()
    expect(storedWidth as number).toBeGreaterThan(5.8)
    expect(storedWidth as number).toBeLessThan(6.0)
  })
})

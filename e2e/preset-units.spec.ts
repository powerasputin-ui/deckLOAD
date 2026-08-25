import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('header').locator('text=/\\d+\\/\\d+ ед\\. · \\d+%/').first()
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
    for (const [fx, fy] of candidates) {
      const stillArmed = await page.getByRole('button', { name: /активен/ }).count()
      if (stillArmed === 0) break
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
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

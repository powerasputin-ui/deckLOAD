import { test, expect, type Locator, type Page } from '@playwright/test'
import { sectionBar, statusLine } from './helpers'

// Spec 5.4, 5.5 and 14 («Раскладка»): at 1440, 1280 and 1024 px wide the page
// doesn't scroll sideways, the frame's key parts lie inside the window and
// none of their text is cut.

const SECTIONS = ['Судно', 'Грузы', 'Размещение', 'Проверки', 'Отчёт']

function keyParts(page: Page): [string, Locator][] {
  return [
    ...SECTIONS.map((s): [string, Locator] => [`раздел «${s}»`, sectionBar(page).getByRole('button', { name: new RegExp(`^${s}`) })]),
    ['«Авто»', page.getByRole('radio', { name: 'Авто' })],
    ['«Ручной»', page.getByRole('radio', { name: 'Ручной' })],
    ['«2D»', page.getByRole('radio', { name: '2D' })],
    ['«3D»', page.getByRole('radio', { name: '3D' })],
    ['«Скачать PDF»', page.getByRole('button', { name: 'Скачать PDF' })],
    ['палуба', page.locator('svg[data-deck-plan]')],
    ['строка статуса', statusLine(page)],
  ]
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
] as const) {
  test(`${width}×${height}: no sideways scroll, the frame inside the window, no text cut`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await expect(page.locator('svg[data-deck-plan] g[data-cargo-placement]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    const outside: string[] = []
    const cut: string[] = []
    for (const [name, part] of keyParts(page)) {
      const box = await part.boundingBox()
      if (!box || box.x < 0 || box.y < 0 || box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5) outside.push(name)
      if (await part.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) cut.push(name)
    }
    expect(outside).toEqual([])
    expect(cut).toEqual([])
  })
}

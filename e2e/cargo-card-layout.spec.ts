import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

// Phase 0, C1 (stopgap until the cargo table): at 1280–1440 px the six fields
// of a cargo card shared one row 34 px each, so «6,06» or «2200» didn't fit in
// its field and «Ярусов» was cut off.
for (const width of [1280, 1440]) {
  test(`cargo card fields fit inside the card at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    const card = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Кол-во' }).first()
    const problems = await card.evaluate((cardEl) => {
      const cardBox = cardEl.getBoundingClientRect()
      const out: string[] = []
      for (const input of cardEl.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')) {
        const box = input.getBoundingClientRect()
        if (box.left < cardBox.left - 0.5 || box.right > cardBox.right + 0.5) out.push(`field «${input.value}» sticks out of the card`)
        if (input.scrollWidth > input.clientWidth) out.push(`«${input.value}» doesn't fit in its field`)
      }
      for (const label of cardEl.querySelectorAll('label')) {
        if (label.scrollWidth > label.clientWidth + 0.5) out.push(`label «${label.textContent}» is cut off`)
      }
      return out
    })
    expect(problems).toEqual([])
  })
}

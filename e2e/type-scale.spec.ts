import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

// Visible text outside the deck drawing (svg) set smaller than 12 px.
async function textBelow12px(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim()
      const el = node.parentElement
      if (!text || !el || el.closest('svg')) continue
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      if (style.visibility === 'hidden' || box.width === 0 || box.height === 0) continue
      const size = parseFloat(style.fontSize)
      if (size < 12) out.push(`${size}px «${text.slice(0, 40)}»`)
    }
    return out
  })
}

// Stage 1 (spec 9.3): nothing smaller than 12 px outside the deck.
test('no text outside the deck is smaller than 12 px, sections and settings open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

  for (const title of ['Зоны нагрузки', 'Сепарация груза', 'Крепление груза', 'Остойчивость судна']) {
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).click()
  }
  await page.getByRole('button', { name: 'Пресеты' }).click()
  expect(await textBelow12px(page)).toEqual([])

  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible()
  expect(await textBelow12px(page)).toEqual([])
})

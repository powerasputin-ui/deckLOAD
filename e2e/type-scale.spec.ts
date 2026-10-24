import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openSection, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
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

// Stage 1 (spec 9.3): nothing smaller than 12 px outside the deck — checked
// in every section of the frame, with their blocks open, and in the menus.
test('no text outside the deck is smaller than 12 px, in every section and menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

  // «Грузы» with the catalogue open, then with the short form.
  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'Каталог', exact: true }).click()
  expect(await textBelow12px(page)).toEqual([])
  await page.getByRole('button', { name: 'Свой груз' }).click()
  expect(await textBelow12px(page)).toEqual([])

  await openSection(page, 'Судно')
  await page.getByRole('button', { name: /^Зоны нагрузки/ }).click()
  expect(await textBelow12px(page)).toEqual([])

  // The stability workspace, in the deck's place, with all its groups open.
  await page.getByRole('button', { name: 'Открыть остойчивость' }).click()
  const workspace = page.getByTestId('stability-workspace')
  const closed = workspace.locator('details:not([open]) > summary')
  while ((await closed.count()) > 0) await closed.first().click()
  expect(await textBelow12px(page)).toEqual([])
  await workspace.getByRole('button', { name: 'К палубе' }).click()

  // The cargo table across the bottom, with a row's «Дополнительно» open.
  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'Таблица', exact: true }).click()
  await page.getByRole('button', { name: 'Дополнительно: Ящик' }).click()
  expect(await textBelow12px(page)).toEqual([])
  await page.getByRole('button', { name: 'Свернуть таблицу грузов' }).click()

  await openSection(page, 'Размещение')
  expect(await textBelow12px(page)).toEqual([])

  await openSection(page, 'Проверки')
  for (const title of ['Сепарация груза', 'Крепление груза']) {
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).click()
  }
  expect(await textBelow12px(page)).toEqual([])

  await openSection(page, 'Отчёт')
  expect(await textBelow12px(page)).toEqual([])

  await page.getByRole('button', { name: 'Вид' }).click()
  await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible()
  expect(await textBelow12px(page)).toEqual([])
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^Меню расчёта/ }).click()
  await expect(page.getByRole('button', { name: 'Все расчёты…' })).toBeVisible()
  expect(await textBelow12px(page)).toEqual([])
})

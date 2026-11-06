import { test, expect, type Page } from '@playwright/test'
import { clearCalculation, openSection, sectionBar } from './helpers'

// WCAG 2.2, 2.5.8: no control under 24 × 24 px. The audit of 2026-11-05
// found three — the switches (32 × 18), a toast's close button (20 × 20) and
// the empty deck's «Открыть пример» (20 tall); this keeps them, and any new
// one, from coming back. Drawing marks inside the deck's <svg> aren't counted.
async function smallControls(page: Page): Promise<string[]> {
  // A menu opening or closing is drawn scaled down for a moment: measure
  // once it has settled.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  return page.evaluate(() =>
    [...document.querySelectorAll('button, [role=button], [role=switch], [role=checkbox], [role=tab], [role=radio], a[href], input[type=checkbox], input[type=radio]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('svg') && (r.width < 24 || r.height < 24)
      })
      .map((el) => `${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`)
  )
}

test('no control is under 24 px, in any section, with a toast up, on the empty deck', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  const found: string[] = []
  for (const title of ['Судно', 'Грузы', 'Размещение', 'Проверки', 'Отчёт'] as const) {
    await openSection(page, title)
    found.push(...(await smallControls(page)).map((s) => `${title}: ${s}`))
  }
  await page.getByRole('button', { name: 'Вид' }).click()
  await expect(page.getByText('Сетка', { exact: true })).toBeVisible()
  found.push(...(await smallControls(page)).map((s) => `Вид: ${s}`))
  await page.keyboard.press('Escape')
  await expect(page.getByText('Сетка', { exact: true })).toBeHidden()

  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'Закрепить «Ящик»' }).click()
  await expect(page.locator('[data-sonner-toast]').first()).toBeVisible()
  found.push(...(await smallControls(page)).map((s) => `toast: ${s}`))

  await clearCalculation(page)
  await openSection(page, 'Проверки')
  await expect(page.getByRole('region', { name: 'На палубе пока нет груза' })).toBeVisible()
  found.push(...(await smallControls(page)).map((s) => `empty: ${s}`))
  expect(found).toEqual([])
})

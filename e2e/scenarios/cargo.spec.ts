import { test, expect, type Page } from '@playwright/test'
import { clearCalculation, openSection, unitsCount } from '../helpers'

// Appendix C, scenarios 7–8. Scenario 8 is in its full version (stage 3);
// scenario 7 still goes through the presets until the catalogue replaces
// them in group C.

const card = (page: Page, name: string) => page.locator('.rounded-lg.border.bg-card').filter({ hasText: name }).first()

test('Сценарий 7: добавить груз', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)

  // A container from the presets, put on the deck with a click.
  await page.getByRole('button', { name: 'Пресеты' }).click()
  await page.getByRole('button', { name: 'Контейнеры' }).click()
  await page.getByText('Контейнер 20ft', { exact: true }).click()
  await page.locator('svg[data-deck-plan] [data-deck-background="true"]').first().click({ position: { x: 60, y: 60 }, force: true })
  await page.keyboard.press('Escape')
  await expect(page.locator('svg[data-deck-plan] g[data-cargo-name="Контейнер 20ft"]')).toHaveCount(1)

  // A cargo of its own goes to the list, and in auto mode onto the deck.
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(card(page, 'Груз 2')).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/2\/2 ед\./)
})

// Full version (stage 3): the cargo table, edited from the keyboard, with
// every column in sight at 1280 px.
test('Сценарий 8: изменить груз', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'Таблица', exact: true }).click()
  const table = page.getByRole('table', { name: 'Таблица грузов' })
  const quantity = table.getByLabel('Количество, Контейнер 20ft')
  const placed = table.getByTestId('cargo-row').filter({ has: page.getByLabel('Количество, Контейнер 20ft') }).getByTestId('cargo-placed')
  await expect(placed).toHaveText(/^4 из 4/)

  // Tab commits the cell…
  await quantity.click()
  await quantity.press('Control+A')
  await quantity.pressSequentially('5')
  await quantity.press('Tab')
  await expect(placed).toHaveText(/^5 из 5/)
  // …and so does Enter, moving to the same cell of the next row.
  await quantity.click()
  await quantity.press('Control+A')
  await quantity.pressSequentially('6')
  await quantity.press('Enter')
  await expect(placed).toHaveText(/^6 из 6/)
  await expect(table.getByLabel('Количество, Паллета EUR')).toBeFocused()
  await expect(unitsCount(page)).toHaveText(/24\/24 ед\./)

  // Every column is in sight: nothing scrolls sideways, no header is cut.
  const hidden = await table.evaluate((el) => {
    const scroller = el.parentElement!
    const box = scroller.getBoundingClientRect()
    const out: string[] = []
    if (scroller.scrollWidth > scroller.clientWidth + 1) out.push(`scrolls sideways by ${scroller.scrollWidth - scroller.clientWidth} px`)
    for (const th of el.querySelectorAll('thead th')) {
      const r = th.getBoundingClientRect()
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push(`«${th.textContent}» out of sight`)
    }
    return out
  })
  expect(hidden).toEqual([])
})

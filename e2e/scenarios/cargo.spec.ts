import { test, expect } from '@playwright/test'
import { addOwnCargo, cargoRow, clearCalculation, openSection, unitsCount } from '../helpers'

// Appendix C, scenarios 7–8, in their full version (stage 3).

test('Сценарий 7: добавить груз', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)
  await openSection(page, 'Грузы')

  // Two actions (spec 2.3): «Каталог», «Контейнер 20ft» — in auto mode it
  // stands on the deck at once, and the list has it.
  await page.getByRole('button', { name: 'Каталог', exact: true }).click()
  await page.getByRole('region', { name: 'Каталог грузов' }).getByRole('button', { name: /^Контейнер 20ft,/ }).click()
  await expect(page.locator('svg[data-deck-plan] g[data-cargo-name="Контейнер 20ft"]')).toHaveCount(1)
  await expect(cargoRow(page, 'Контейнер 20ft')).toContainText(/Размещено 1\s*из/)
  await expect(page.getByTestId('cargo-summary')).toHaveText('1 тип · 1 ед. · 2.2 т')

  // A cargo of its own: the short form, then the list, and in auto mode
  // the deck.
  await addOwnCargo(page, { name: 'Ящик с запчастями', length: '1.5', width: '1', height: '1', weightT: '0.8' })
  await expect(cargoRow(page, 'Ящик с запчастями')).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/2\/2 ед\./)
  await expect(page.getByTestId('cargo-summary')).toHaveText('2 типа · 2 ед. · 3 т')
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

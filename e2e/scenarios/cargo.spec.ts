import { test, expect, type Page } from '@playwright/test'
import { clearCalculation, unitsCount } from '../helpers'

// Appendix C, scenarios 7–8, from the entry points of stage 2. Stage 3
// rewrites them for the catalog, the custom cargo form and the table.

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

test('Сценарий 8: изменить груз', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  const quantity = card(page, 'Паллета EUR').locator('label:has-text("Кол-во") + input')

  // Tab and Enter both commit the new quantity, and all of it is placed.
  await quantity.click()
  await quantity.press('Control+A')
  await quantity.pressSequentially('14')
  await quantity.press('Tab')
  await expect(card(page, 'Паллета EUR').getByText('14/14 разм.')).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/24\/24 ед\./)

  await quantity.click()
  await quantity.press('Control+A')
  await quantity.pressSequentially('12')
  await quantity.press('Enter')
  await expect(card(page, 'Паллета EUR').getByText('12/12 разм.')).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
})

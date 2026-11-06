import { test, expect } from '@playwright/test'
import { addOwnCargo, cargoRow, openSection, sectionBar, setNumber, unfoldVesselBlocks } from './helpers'

// Spec 2026-11-06, 4–8: a fixed platform beside the vessels. The start
// screen asks which platform; «Платформа» has its card; the cargo has a
// status; there are no trips and no lashing check; the PDF is one sheet.
test('a fixed platform: its card, cargo on board, arriving and leaving, one deck and its PDF', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  await page.getByRole('button', { name: 'Справка' }).click()
  await page.getByRole('button', { name: 'Показать стартовый экран' }).click()
  const start = page.getByRole('dialog', { name: 'DeckLoad' })
  await start.getByRole('button', { name: 'Начать с платформы' }).click()
  await start.getByRole('group', { name: 'Какая платформа' }).getByRole('button', { name: /^Стационарная платформа/ }).click()
  await expect(start).toBeHidden()

  // «Платформа», at its card.
  await expect(sectionBar(page).getByRole('button', { name: /^Платформа/ })).toHaveAttribute('aria-current', 'page')
  await unfoldVesselBlocks(page)
  await expect(page.getByRole('radiogroup', { name: 'Тип объекта' }).getByRole('radio', { name: 'Стационарная' })).toHaveAttribute('aria-checked', 'true')
  const name = page.getByLabel('Название', { exact: true })
  await name.fill('МСП-1')
  await name.press('Enter')
  await setNumber(page.getByLabel('Допускаемая нагрузка на палубу'), '60')
  // The compass names its sides.
  await expect(page.locator('[data-hull-side="bow"]').first()).toContainText('СЕВЕР')

  // A box on board, pallets arriving, drums leaving.
  await addOwnCargo(page, { name: 'Контейнер', length: '6', width: '2.4', height: '2.6', weightT: '20', quantity: '1' })
  await addOwnCargo(page, { name: 'Паллеты', length: '1.2', width: '0.8', height: '1.5', weightT: '1', quantity: '4' })
  await addOwnCargo(page, { name: 'Бочки', length: '1.2', width: '1.2', height: '1', weightT: '2', quantity: '3' })
  await cargoRow(page, 'Контейнер').getByRole('combobox', { name: 'Статус «Контейнер»' }).selectOption('onboard')
  await cargoRow(page, 'Бочки').getByRole('combobox', { name: 'Статус «Бочки»' }).selectOption('outgoing')
  await expect(page.getByTestId('cargo-status-summary')).toHaveText('Приход: 4 ед., 4 т · Отгрузка: 3 ед., 6 т · На борту: 1 ед., 20 т')
  await expect(cargoRow(page, 'Бочки')).toContainText('не на плане')
  await expect(page.locator('[data-status-item="units"]')).toHaveText('5/5 ед.')
  await expect(page.locator('[data-status-item="weight"]')).toHaveText('24 из 60 т')

  // One deck: no trips, no lashing check.
  await expect(page.getByRole('tablist', { name: /Рейсы/ })).toHaveCount(0)
  await openSection(page, 'Проверки')
  const checks = page.getByRole('list', { name: 'Список проверок' })
  await expect(checks).toContainText('Нагрузка на палубу')
  await expect(checks).not.toContainText('Крепление')
  await expect(checks).not.toContainText('Остойчивость')

  // The PDF: one sheet, «План палубы».
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: /Скачать PDF/ }).first().click()])
  expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
})

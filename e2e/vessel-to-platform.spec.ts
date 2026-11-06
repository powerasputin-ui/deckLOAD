import { test, expect } from '@playwright/test'
import { openSection, sectionBar, statusLine } from './helpers'

// Spec 2026-11-06, 13: a vessel's trip, its cargo onto a platform as
// «приход» — the vessel's calculation stays as it is; taken again, the trip
// replaces what it brought.

test('a semi-submersible takes the demo vessel\'s first trip as «приход», and taking it again replaces it', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  // The demo vessel's calculation; a new semi-submersible beside it.
  await page.getByRole('button', { name: 'Справка' }).click()
  await page.getByRole('button', { name: 'Показать стартовый экран' }).click()
  const start = page.getByRole('dialog', { name: 'DeckLoad' })
  await start.getByRole('button', { name: 'Начать с платформы' }).click()
  await start.getByRole('group', { name: 'Какая платформа' }).getByRole('button', { name: /^ППБУ/ }).click()

  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'С судна' }).click()
  const panel = page.getByRole('region', { name: 'Груз с судна' })
  await expect(panel.getByLabel('Расчёт судна')).toHaveText('Демо-расчёт')
  const take = panel.getByRole('button', { name: /^Взять как приход: \d+ ед\./ })
  const label = (await take.textContent())!
  const units = Number(/: (\d+) ед\./.exec(label)![1])
  await take.click()

  // On the list as «приход», each with where it came from.
  const rows = page.getByTestId('cargo-source')
  await expect(rows.first()).toHaveText('с «Демо-расчёт», рейс 1')
  const kinds = await rows.count()
  await expect(page.getByTestId('cargo-status-summary')).toHaveText(new RegExp(`^Приход: ${units} ед\\.`))
  await expect(statusLine(page).locator('[data-status-item="units"]')).toHaveText(new RegExp(`/${units} ед\\.`))

  // Again: the same cargo, not twice as much.
  await page.getByRole('button', { name: 'С судна' }).click()
  await expect(panel.getByRole('checkbox', { name: `Заменить взятое раньше с «Демо-расчёт», рейс 1: ${units} ед.` })).toBeChecked()
  await panel.getByRole('button', { name: /^Взять как приход/ }).click()
  await expect(rows).toHaveCount(kinds)
  await expect(page.getByTestId('cargo-status-summary')).toHaveText(new RegExp(`^Приход: ${units} ед\\.`))
})

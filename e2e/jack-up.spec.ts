import { test, expect, type Locator, type Page } from '@playwright/test'
import { addOwnCargo, openSection, sectionBar, setNumber, unfoldVesselBlocks } from './helpers'

// Spec 2026-11-06, 11: a self-elevating unit — on its legs, the run's cargo
// by the leg; afloat, its KG at the new draught.

const block = (page: Page, fold: string): Locator => page.locator(`[data-fold="${fold}"]`)

test('a jack-up: a heavy box by a leg overloads it; afloat, the KG and draught follow the cargo', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  await page.getByRole('button', { name: 'Справка' }).click()
  await page.getByRole('button', { name: 'Показать стартовый экран' }).click()
  const start = page.getByRole('dialog', { name: 'DeckLoad' })
  await start.getByRole('button', { name: 'Начать с платформы' }).click()
  await start.getByRole('group', { name: 'Какая платформа' }).getByRole('button', { name: /^СПБУ/ }).click()
  await unfoldVesselBlocks(page)

  // A deck of 30 × 30 m, a leg at each corner.
  await setNumber(page.getByLabel('Ширина (борт–борт)'), '30')
  await setNumber(page.getByLabel('Длина (нос–корма)'), '30')
  await unfoldVesselBlocks(page)
  const data = block(page, 'jack-data')
  await setNumber(data.getByLabel('Высота палубы над основной плоскостью, м'), '20')
  await setNumber(data.getByLabel('VDL в работе, т', { exact: true }), '3500')
  await setNumber(data.getByLabel('Опора, доп., т', { exact: true }), '4100')
  const corners: [string, string][] = [['30', '30'], ['30', '0'], ['0', '0'], ['0', '30']]
  for (const [i, [stern, port]] of corners.entries()) {
    await data.getByRole('button', { name: 'Добавить опору' }).click()
    await setNumber(data.getByLabel(`От кормы, м, Опора ${i + 1}`), stern)
    await setNumber(data.getByLabel(`От левого борта, м, Опора ${i + 1}`), port)
  }

  // The day's report on its legs: 4 000 t on each.
  const report = block(page, 'jack-report')
  await setNumber(report.getByLabel('VDL, т', { exact: true }), '2800')
  for (let i = 1; i <= 4; i++) await setNumber(report.getByLabel(`Нагрузка, Опора ${i}, т`), '4000')
  await expect(page.locator('[data-status-item="legs"]')).toHaveText('Опора до 4000 из 4100 т')

  // 300 t in a box by a corner: that leg takes most of it.
  await addOwnCargo(page, { name: 'Ящик', length: '2', width: '2', height: '2', weightT: '300', quantity: '1' })
  await expect(page.locator('[data-status-item="vdl"]')).toHaveText('VDL 3100 из 3500 т')
  await openSection(page, 'Проверки')
  const checks = page.getByRole('list', { name: 'Список проверок' })
  await expect(checks).toContainText(/«Опора \d» \d+ т при допустимой 4100 т — больше допустимой/)
  await expect(page.locator('[data-status-item="legs"]')).toHaveText(/^Опора до 4[12]\d\d из 4100 т$/)

  // Water brought: where it stands decides the legs — unsaid, no loads
  // (audit 2026-11-07); at the legs' centre, an equal share.
  await sectionBar(page).getByRole('button', { name: /^СПБУ/ }).click()
  await unfoldVesselBlocks(page)
  const transfers = block(page, 'jack-transfers')
  await transfers.getByRole('button', { name: 'Добавить строку' }).click()
  await transfers.getByLabel('Что, строка 1').fill('Вода')
  await setNumber(transfers.getByLabel('Вес, т, строка 1'), '200')
  await setNumber(transfers.getByLabel('ЦТ над ОП, м, строка 1'), '5')
  await openSection(page, 'Проверки')
  await expect(checks).toContainText('Прочий приход: не указано, где «Вода» — у опоры или в центре опор')
  await expect(page.locator('[data-status-item="legs"]')).toHaveCount(0)
  await sectionBar(page).getByRole('button', { name: /^СПБУ/ }).click()
  await unfoldVesselBlocks(page)
  await transfers.getByLabel('Где, строка 1').selectOption('centre')
  await expect(page.locator('[data-status-item="legs"]')).toHaveText(/^Опора до 4[12]\d\d из 4100 т$/)
  await transfers.getByRole('button', { name: 'Удалить «Вода»' }).click()

  // Afloat: the draught and the KG follow the 300 t.
  await sectionBar(page).getByRole('button', { name: /^СПБУ/ }).click()
  await unfoldVesselBlocks(page)
  await page.getByRole('radiogroup', { name: 'Положение установки' }).getByRole('radio', { name: 'На плаву' }).click()
  await setNumber(report.getByLabel('Осадка, м', { exact: true }), '4')
  await setNumber(report.getByLabel('Водоизм., т', { exact: true }), '8000')
  await setNumber(report.getByLabel('KG испр., м', { exact: true }), '12')
  await setNumber(report.getByLabel('VDL, т', { exact: true }), '2000')
  const afloat = data.getByRole('group', { name: 'На плаву' })
  await setNumber(afloat.getByLabel('Предел VDL, т', { exact: true }), '2500')
  await setNumber(afloat.getByLabel('TPC, т/см', { exact: true }), '20')
  await setNumber(afloat.getByLabel('Осадка наиб., м', { exact: true }), '4.5')
  for (const [i, [draft, kg]] of [['4', '12.5'], ['4.5', '12']].entries()) {
    await afloat.getByRole('button', { name: 'Строка KG' }).click()
    await setNumber(afloat.getByLabel(`Осадка, строка ${i + 1}`, { exact: true }), draft)
    await setNumber(afloat.getByLabel(`Допустимый KG, строка ${i + 1}`, { exact: true }), kg)
  }
  // (96 000 + 300 · 21) / 8 300 = 12.33 m at 4 + 300 / 2 000 = 4.15 m, where 12.35 is allowed.
  await expect(page.locator('[data-status-item="kg"]')).toHaveText('KG 12.33 из 12.35 м')
  await openSection(page, 'Проверки')
  await expect(checks).toContainText('12.33 м при допустимом 12.35 м на осадке 4.15 м')
  await expect(checks).toContainText('4.15 м при наибольшей 4.50 м')

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: /Скачать PDF/ }).first().click()])
  expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
})

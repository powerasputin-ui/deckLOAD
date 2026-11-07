import { test, expect, type Locator, type Page } from '@playwright/test'
import { addOwnCargo, openSection, sectionBar, setCargoTotal, setNumber, unfoldVesselBlocks } from './helpers'

// Spec 2026-11-06, 7: a semi-submersible's deck plan against its manual —
// the manual's modes, the daily report, pipe arriving; VDL and KG in
// operation and on the way to survival, the draught held by ballast.

const block = (page: Page, fold: string): Locator => page.locator(`[data-fold="${fold}"]`)

async function mode(page: Page, name: 'Рабочий режим' | 'Штормовой режим', v: { draft: string; disp: string; vdl: string; kgDraft: string; kg: string }) {
  const m = page.getByRole('group', { name })
  await setNumber(m.getByLabel('Осадка, м', { exact: true }), v.draft)
  await setNumber(m.getByLabel('Водоизм., т', { exact: true }), v.disp)
  await setNumber(m.getByLabel('Предел VDL, т', { exact: true }), v.vdl)
  await m.getByRole('button', { name: 'Строка KG' }).click()
  await setNumber(m.getByLabel('Осадка, строка 1', { exact: true }), v.kgDraft)
  await setNumber(m.getByLabel('Допустимый KG, строка 1', { exact: true }), v.kg)
}

test('a semi-submersible: its manual, the daily report, pipe arriving — VDL and KG in operation and in a storm', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  await page.getByRole('button', { name: 'Справка' }).click()
  await page.getByRole('button', { name: 'Показать стартовый экран' }).click()
  const start = page.getByRole('dialog', { name: 'DeckLoad' })
  await start.getByRole('button', { name: 'Начать с платформы' }).click()
  await start.getByRole('group', { name: 'Какая платформа' }).getByRole('button', { name: /^ППБУ/ }).click()
  await unfoldVesselBlocks(page)

  // A deck of 30 × 40 m, 38 m over the baseline; ballast at 4 m.
  await setNumber(page.getByLabel('Ширина (борт–борт)'), '30')
  await setNumber(page.getByLabel('Длина (нос–корма)'), '40')
  await unfoldVesselBlocks(page)
  const data = block(page, 'semi-data')
  await setNumber(data.getByLabel('Высота палубы над основной плоскостью, м'), '38')
  await setNumber(data.getByLabel('Высота откачиваемого балласта, м'), '4')
  await mode(page, 'Рабочий режим', { draft: '21', disp: '50000', vdl: '5000', kgDraft: '21', kg: '20.9' })
  await mode(page, 'Штормовой режим', { draft: '17', disp: '45000', vdl: '4600', kgDraft: '17', kg: '22.5' })

  const report = block(page, 'semi-report')
  await setNumber(report.getByLabel('Осадка, м', { exact: true }), '21')
  await setNumber(report.getByLabel('Водоизм., т', { exact: true }), '50000')
  await setNumber(report.getByLabel('KG испр., м', { exact: true }), '20')
  await setNumber(report.getByLabel('VDL, т', { exact: true }), '4000')
  await setNumber(report.getByLabel('Балласт, т', { exact: true }), '9000')

  // 500 t of pipe arriving: within both modes.
  await addOwnCargo(page, { name: 'Трубы', length: '12', width: '1', height: '1', weightT: '50', quantity: '10' })
  await expect(page.locator('[data-status-item="vdl"]')).toHaveText('VDL 4500 из 5000 т')
  await expect(page.locator('[data-status-item="kg"]')).toHaveText(/^KG 20\.3\d из 20\.90 м$/)
  await openSection(page, 'Проверки')
  const checks = page.getByRole('list', { name: 'Список проверок' })
  await expect(checks).toContainText('в работе 4500 т при допустимом 5000 т · в шторм 4500 т при допустимом 4600 т')

  // 1 000 t: the storm is over its VDL — the cargo would have to come off.
  await setCargoTotal(page, 'Трубы', '20')
  // Within the operating 5 000 t, over the storm's 4 600: the line shows
  // the limit that is broken (audit 2026-11-07).
  await expect(page.locator('[data-status-item="vdl"]')).toHaveText('VDL 5000 из 4600 т в шторм')
  await openSection(page, 'Проверки')
  await expect(checks).toContainText('в шторм 5000 т при допустимом 4600 т — в шторм придётся снимать груз')
  await expect(page.locator('[data-status-item="errors"]')).toBeVisible()

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: /Скачать PDF/ }).first().click()])
  expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
})

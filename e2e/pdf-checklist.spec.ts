import { test, expect } from '@playwright/test'
import { chooseFromCatalog, chooseLibraryVessel, openSection, sheetCount, unitsCount } from './helpers'

// Spec 2.3 and 11: the PDF is checked on the example and on both library
// vessels with typical cargo. Each plan downloads with a sheet per trip and
// the totals; with PDF_CHECKLIST_DIR set, the files are kept there for the
// checklist to be gone through by eye (docs/superpowers/plans, stage 5).
const keep = process.env.PDF_CHECKLIST_DIR

async function download(page: import('@playwright/test').Page, name: string) {
  await openSection(page, 'Отчёт')
  const trips = await page.getByRole('list', { name: 'Листы PDF' }).getByRole('button').count()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PDF' }).last().click()
  const file = await pending
  expect(await sheetCount(file)).toBeGreaterThanOrEqual(trips + 1)
  if (keep) await file.saveAs(`${keep}/${name}.pdf`)
}

test('the example\'s PDF', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  await download(page, 'demo')
})

for (const vessel of ['Алексей Кузнецов (IMO 9692648)', 'Коммандер (IMO 9340609)']) {
  test(`${vessel}: the PDF with containers, pallets and pipe`, async ({ page }) => {
    await page.goto('/')
    await chooseLibraryVessel(page, vessel)
    await chooseFromCatalog(page, 'Контейнер 20ft', 6)
    await chooseFromCatalog(page, 'Паллета EUR', 12)
    await chooseFromCatalog(page, 'Обсадная труба', 8)
    await expect(unitsCount(page)).toHaveText('26/26 ед.')
    await download(page, vessel.split(' ')[0])
  })
}

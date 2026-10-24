import { test, expect } from '@playwright/test'
import { chooseFromCatalog, cargoRow, openSection, unitsCount } from './helpers'

test.describe('Catalogue sizes follow the current unit', () => {
  test('the catalogue shows ft-converted sizes, and choosing a cargo creates a correctly-sized item (regression: templates are written in metres but were shown/placed unconverted)', async ({ page }) => {
    await page.goto('/')
    await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

    // Switch to feet («Судно») before opening the catalogue («Грузы»).
    await openSection(page, 'Судно')
    await page.getByRole('radio', { name: 'фт' }).click()
    await expect(page.getByText('20 м')).not.toBeVisible()

    // "Химический танк-контейнер 2500л" is 1.8 × 1.8 m in the templates (not
    // in the demo project) — in ft that's ~5.91 × 5.91, never 1.8 × 1.8
    // (which would be the unconverted bug).
    await openSection(page, 'Грузы')
    await page.getByRole('button', { name: 'Каталог', exact: true }).click()
    const entry = page.getByRole('region', { name: 'Каталог грузов' }).getByRole('button', { name: /^Химический танк-контейнер 2500л,/ })
    await expect(entry).toContainText('5.91×5.91×7.74 фт')

    await chooseFromCatalog(page, 'Химический танк-контейнер 2500л')
    await expect(cargoRow(page, 'Химический танк-контейнер 2500л')).toBeVisible()

    // The new item's own width, kept in the deck's current unit (ft here),
    // must be the converted value — read from the saved project.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('deckload-projects')
          if (!raw) return null
          const data = JSON.parse(raw)
          const projects: { id: string; items?: { name: string; width: number }[] }[] = Array.isArray(data.projects) ? data.projects : []
          const active = projects.find((p) => p.id === data.activeId) ?? projects[0]
          return active?.items?.find((it) => it.name === 'Химический танк-контейнер 2500л')?.width ?? null
        })
      )
      .toBeCloseTo(5.906, 2)
  })
})

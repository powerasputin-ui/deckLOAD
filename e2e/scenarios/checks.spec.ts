import { test, expect, type Page } from '@playwright/test'
import { addSeparationRule, chooseLibraryVessel, inspector, openSection, unitsCount } from '../helpers'

// Appendix C, scenarios 15–16, from the entry points of stage 2. Stage 4
// rewrites them for the single list of checks.

const deck = (page: Page) => page.locator('svg[data-deck-plan]')

// Placed by hand 1.5 m apart: a dangerous cargo, tied down too weakly, and
// an ordinary one.
const CLOSE = {
  id: 'close',
  name: 'Сепарация',
  createdAt: 0,
  updatedAt: 0,
  deck: {
    width: 8,
    length: 20,
    unit: 'm',
    gap: 0.1,
    boardOffset: 0.2,
    clearance: 6,
    lashingPoints: [{ id: 'l1', x: 1.5, y: 1.5, label: 'Точка 1', placementId: 'mg', itemId: 'g', cornerX: 2, cornerY: 2, mslKg: 100, verticalAngleDeg: 45, deviceType: 'chain_g80_10' }],
  },
  items: [
    { id: 'g', name: 'Газ', width: 2, length: 2, height: 1, quantity: 1, color: '#dc2626', allowRotation: true, weight: 5000, category: 'Опасный груз' },
    { id: 'f', name: 'Ящик', width: 1, length: 1, height: 1, quantity: 1, color: '#0ea5e9', allowRotation: true, weight: 1000, category: 'Обычный' },
  ],
  manualPlacements: [
    { id: 'mg', itemId: 'g', name: 'Газ', x: 2, y: 2, width: 2, length: 2, layers: 1, rotated: false, color: '#dc2626', weight: 5000 },
    { id: 'mf', itemId: 'f', name: 'Ящик', x: 2, y: 5.5, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9', weight: 1000 },
  ],
  pinnedPlacementsByTrip: {},
  separationRules: [],
  mode: 'manual',
  sortStrategy: 'area-desc',
  globalRotation: true,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,
  showCargoContents: true,
}

test('Сценарий 15: сепарация и крепление', async ({ page }) => {
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('deckload-projects', JSON.stringify({ activeId: project.id, projects: [project] }))
  }, CLOSE)
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/2\/2 ед\./)

  // The rule «Опасный груз ↔ Обычный ≥ 3 м», in the separation check.
  await addSeparationRule(page, 'Опасный груз', 'Обычный')

  // The two stand 1.5 m apart: the check fails, and the deck joins them with
  // a dashed line saying how far apart they are.
  await expect(page.locator('[data-check="separation"]')).toHaveAttribute('data-check-status', 'error')
  await expect(deck(page).locator('[data-separation]')).toHaveText('1.5 м из 3 м')

  // The weak lashing: the check warns, the stack wears the amber chain, and
  // its inspector says so.
  await expect(page.locator('[data-check="lashing"]')).not.toHaveAttribute('data-check-status', 'ok')
  const gas = deck(page).locator('g[data-cargo-name="Газ"]')
  await expect(gas.locator('[data-mark="lashing-short"]')).toHaveCount(1)
  await expect(async () => {
    await gas.click({ force: true })
    await expect(inspector(page)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
  await expect(inspector(page).getByText('Не хватает крепления')).toBeVisible()
})

test('Сценарий 16: остойчивость', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await chooseLibraryVessel(page, 'Алексей Кузнецов (IMO 9692648)')
  await expect(deck(page).getByText('49.10 м')).toBeVisible()

  // The library vessel brings its data: «Судно» sums up the open trip, and
  // the stability workspace takes the deck's place with the whole of it
  // (spec 2026-10-24, 6.1, 6.2).
  await expect(page.getByTestId('vessel-stability-summary')).toContainText('Нужна проверка')
  await page.getByRole('button', { name: 'Открыть остойчивость' }).click()
  const workspace = page.getByTestId('stability-workspace')
  await expect(workspace.getByText('GM с поправкой на свободную поверхность')).toBeVisible()
  await expect(workspace.getByText('Данные из библиотеки:')).toBeVisible()
  // One hydrostatic point: outside it the numbers are an estimate.
  await expect(workspace.getByText('Числа ниже — только оценка')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(deck(page)).toBeVisible()
  await openSection(page, 'Проверки')
  await expect(page.locator('[data-check="stability"]')).toHaveAttribute('data-check-status', 'warn')
})

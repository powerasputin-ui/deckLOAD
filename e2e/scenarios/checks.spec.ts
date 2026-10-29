import { test, expect, type Page } from '@playwright/test'
import { addSeparationRule, chooseLibraryVessel, inspector, openCheck, openSection, unitsCount } from '../helpers'

// Appendix C, scenarios 15–16 in their full versions (stage 4).

const deck = (page: Page) => page.locator('svg[data-deck-plan]')

// Placed by hand: a dangerous cargo and an ordinary one 1.5 m apart, and a
// 100 t pipe stack tied down by one point where the norms ask for two.
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
    lashingPoints: [{ id: 'l1', x: 4.5, y: 14.5, label: 'Точка 1', placementId: 'mp', itemId: 'p', cornerX: 5, cornerY: 15, mslKg: 50_000, verticalAngleDeg: 45, deviceType: 'chain_g80_10' }],
  },
  items: [
    { id: 'g', name: 'Газ', width: 2, length: 2, height: 1, quantity: 1, color: '#dc2626', allowRotation: true, weight: 5000, category: 'Опасный груз' },
    { id: 'f', name: 'Ящик', width: 1, length: 1, height: 1, quantity: 1, color: '#0ea5e9', allowRotation: true, weight: 1000, category: 'Обычный' },
    { id: 'p', name: 'Труба', width: 2, length: 1, height: 1, quantity: 1, color: '#16a34a', allowRotation: true, weight: 100_000, category: 'Металлопродукция' },
  ],
  manualPlacements: [
    { id: 'mg', itemId: 'g', name: 'Газ', x: 2, y: 2, width: 2, length: 2, layers: 1, rotated: false, color: '#dc2626', weight: 5000 },
    { id: 'mf', itemId: 'f', name: 'Ящик', x: 2, y: 5.5, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9', weight: 1000 },
    { id: 'mp', itemId: 'p', name: 'Труба', x: 5, y: 15, width: 2, length: 1, layers: 1, rotated: false, color: '#16a34a', weight: 100_000 },
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
  await expect(unitsCount(page)).toHaveText(/3\/3 ед\./)

  // The rule «Опасный груз ↔ Обычный ≥ 3 м», in the separation check.
  await addSeparationRule(page, 'Опасный груз', 'Обычный')

  // The two stand 1.5 m apart: the check fails and says so; the deck joins
  // them with a dashed line and the distance, and steps back from the rest.
  const separation = page.locator('[data-check="separation"]')
  await expect(separation).toHaveAttribute('data-check-status', 'error')
  await expect(separation.getByRole('list', { name: 'Сепарация: подробности' })).toContainText('«Газ» и «Ящик»: 1.50 из 3 м')
  await expect(deck(page).locator('[data-separation]')).toHaveText('1.5 м из 3 м')
  await expect(deck(page).locator('g[data-cargo-name="Газ"]')).not.toHaveAttribute('data-dimmed', 'true')
  await expect(deck(page).locator('g[data-cargo-name="Ящик"]')).not.toHaveAttribute('data-dimmed', 'true')
  await expect(deck(page).locator('g[data-cargo-name="Труба"]')).toHaveAttribute('data-dimmed', 'true')

  // The lashing: ⚠, with how many points the pipe needs and has.
  const lashing = await openCheck(page, 'lashing')
  await expect(lashing).toHaveAttribute('data-check-status', 'warn')
  await expect(lashing.getByRole('list', { name: 'Крепление: подробности' })).toContainText('«Труба»: нужно 2, задано 1')
  await expect(deck(page).locator('g[data-cargo-name="Труба"] [data-mark="lashing-short"]')).toHaveCount(1)

  // Its inspector says the same, in its «Крепление».
  await page.keyboard.press('Escape')
  await expect(async () => {
    await deck(page).locator('g[data-cargo-name="Труба"]').click({ force: true })
    await expect(inspector(page)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
  await expect(inspector(page).getByText('Не хватает крепления')).toBeVisible()
  const own = inspector(page).getByTestId('inspector-lashing')
  await own.getByText('Крепление', { exact: true }).click()
  await expect(own.getByTestId('lashing-count')).toHaveText('Нужно 2, задано 1')
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
  // The vessel's data comes folded, with where it's from.
  await expect(workspace.getByText('Данные из библиотеки:')).toBeVisible()
  await expect(workspace.locator('details').first()).toBeVisible()
  await expect(workspace.locator('details[open]')).toHaveCount(0)
  // The result and its verdicts are in view.
  await expect(workspace.getByText('GM с поправкой на свободную поверхность')).toBeVisible()
  await expect(workspace.getByRole('list', { name: 'Причины' })).toBeVisible()
  // One hydrostatic point: outside it the numbers are an estimate, and the
  // warning stands above them.
  const warning = workspace.getByText('Числа ниже — только оценка')
  await expect(warning).toBeVisible()
  const gm = workspace.getByTestId('stability-gm')
  expect((await warning.boundingBox())!.y).toBeLessThan((await gm.boundingBox())!.y)
  await page.keyboard.press('Escape')
  await expect(deck(page)).toBeVisible()
  await openSection(page, 'Проверки')
  await expect(page.locator('[data-check="stability"]')).toHaveAttribute('data-check-status', 'warn')
})

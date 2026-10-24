import { test, expect, type Locator, type Page } from '@playwright/test'
import { openSection, setNumber, statusLine } from './helpers'

// Stage 2a (spec 2026-10-24, section 8): the booklet check end to end — the
// ways into the stability workspace, a pasted limit passing and then failing
// the trip, icing, the water in pipes, and the PDF.

// 1000 t lightship at KG 5, KM 8 at 1000–3000 t, 500 t of ballast pressed
// full low down: 1500 t, GM 4.33 m, a draught of 3 m. The vessel's side and
// other decks are given, so icing has everything it needs.
const vessel = {
  particulars: {
    name: 'Проба',
    lengthBpp: 60,
    breadth: 14,
    lightshipWeightKg: 1_000_000,
    lightshipKG: 5,
    lightshipLCG: 30,
    lightshipTCG: 0,
    longitudinalOrigin: 'aft-perpendicular',
    maxDraftM: 5,
    loadLineLengthM: 60,
    windageAreaM2: 1500,
    windageLeverM: 8,
    otherExposedDeckAreaM2: 0,
  },
  hydrostatics: {
    points: [
      { displacementKg: 1_000_000, draftM: 2, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
      { displacementKg: 3_000_000, draftM: 6, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
    ],
  },
  variableWeights: [{ id: 'b', name: 'Балласт', weightKg: 500_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
}

const project = (items: unknown[] = []) => ({
  id: 'proba',
  name: 'Проба',
  createdAt: 0,
  updatedAt: 0,
  deck: {
    width: 10,
    length: 20,
    unit: 'm',
    gap: 0.1,
    boardOffset: 0.2,
    clearance: 6,
    vessel,
    shipFrame: { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 30, heightAboveBaselineM: 6 },
    deckForwardIsPositiveY: true,
  },
  items,
  manualPlacements: [],
  pinnedPlacementsByTrip: {},
  separationRules: [],
  mode: 'auto',
  sortStrategy: 'area-desc',
  globalRotation: true,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,
  showCargoContents: true,
})

// Two pipes Ø530, 12 m long, with no inside diameter given.
const PIPES = [{ id: 'pipe', name: 'Труба 530', width: 12, length: 0.53, height: 0.53, quantity: 2, color: '#64748b', allowRotation: true, weight: 3000, shape: 'cylinder' }]

async function openWith(page: Page, items: unknown[] = []) {
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('deckload-projects', JSON.stringify({ activeId: p.id, projects: [p] }))
  }, project(items))
  await page.goto('/')
  await expect(page.locator('[data-status-item="gm"]')).toBeVisible()
}

async function openWorkspace(page: Page): Promise<Locator> {
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Открыть остойчивость' }).click()
  return page.getByTestId('stability-workspace')
}

function group(ws: Locator, title: string): Locator {
  return ws.locator('details').filter({ has: ws.page().locator('summary span', { hasText: new RegExp(`^${title}$`) }) })
}

const gmOf = async (ws: Locator) => Number((await ws.getByTestId('stability-gm').textContent())!.replace(' м', ''))

test('opens from «Судно» and from the GM in the status line, and Esc goes back to the deck', async ({ page }) => {
  await openWith(page)
  const ws = await openWorkspace(page)
  await expect(ws).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ws).toBeHidden()

  await statusLine(page).locator('[data-status-item="gm"]').click()
  await expect(ws).toBeVisible()
  await expect(ws.getByTestId('stability-gm')).toHaveText('4.33 м')
  await page.keyboard.press('Escape')
  await expect(page.locator('svg[data-deck-plan]')).toBeVisible()
})

test('a pasted limit passes the trip, and heavy cargo high up fails it', async ({ page }) => {
  await openWith(page)
  const ws = await openWorkspace(page)
  await expect(ws.getByTestId('stability-state')).toHaveAttribute('data-verdict', 'warn')

  const limit = group(ws, 'Предел по формуляру')
  await limit.getByRole('button', { name: 'Вставить текстом' }).click()
  await limit.getByLabel('Предел по формуляру: текст для вставки').fill('2;3,5\n6;3,5')
  await limit.getByRole('button', { name: 'Вставить', exact: true }).click()
  await expect(ws.getByTestId('stability-state')).toHaveAttribute('data-verdict', 'ok')
  await expect(ws.getByText('Предел по формуляру 3.50 м при осадке 3.00 м')).toBeVisible()
  await expect(statusLine(page).locator('[data-status-item="gm"]')).toHaveText('GM 4.33 м (отход) ✓')

  // 500 t, 4 m tall: its centre 8 m above the keel. KG (5500 + 4000)/2000
  // = 4.75 — GM 3.25, under the 3.5 m the booklet asks for.
  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'Добавить груз' }).click()
  await setNumber(page.locator('label:has-text("Вес ед., кг") + input, label:has-text("Вес ед., кг") ~ input').first(), '500000')
  await setNumber(page.locator('label:has-text("Выс.") + input').first(), '4')
  await expect(ws.getByTestId('stability-state')).toHaveAttribute('data-verdict', 'error')
  await expect(ws.getByTestId('stability-gm')).toHaveText('3.25 м')
  await expect(statusLine(page).locator('[data-status-item="gm"]')).toContainText('✕')
})

test('icing raises KG and lowers GM at arrival, and leaves the departure alone', async ({ page }) => {
  await openWith(page)
  const ws = await openWorkspace(page)
  const states = ws.getByRole('radiogroup', { name: 'Результат для состояния' })
  await states.getByRole('radio', { name: /^Приход/ }).click()
  const before = await gmOf(ws)

  await group(ws, 'Обледенение').getByRole('switch', { name: 'Учитывать обледенение' }).click()
  await expect(ws.getByText('Лёд', { exact: true })).toBeVisible()
  expect(await gmOf(ws)).toBeLessThan(before - 0.05)

  await states.getByRole('radio', { name: /^Отход/ }).click()
  expect(await gmOf(ws)).toBeCloseTo(before, 6)
})

test('pipes without an inside diameter give a warning, and with one their water is counted', async ({ page }) => {
  await openWith(page, PIPES)
  const ws = await openWorkspace(page)
  await expect(ws.getByText('Вода в трубах «Труба 530» не учтена: нет внутреннего диаметра')).toBeVisible()
  await expect(ws.getByText('Вода в трубах', { exact: true })).toBeHidden()

  await openSection(page, 'Грузы')
  await setNumber(page.getByLabel('Внутренний диаметр, мм'), '500')
  await expect(ws.getByText('Вода в трубах', { exact: true })).toBeVisible()
  await expect(ws.getByText(/не учтена: нет внутреннего диаметра/)).toBeHidden()
})

test('the PDF exported from the workspace downloads, and the workspace comes back', async ({ page }) => {
  await openWith(page)
  const ws = await openWorkspace(page)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: 'Скачать PDF' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
  await expect(page.getByText('PDF скачан')).toBeVisible()
  await expect(ws).toBeVisible()
})

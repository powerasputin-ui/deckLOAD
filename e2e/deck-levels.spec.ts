import { test, expect, type Page } from '@playwright/test'
import { openSection, setNumber, statusLine, unfoldVesselBlocks } from './helpers'

// Spec 2026-11-06, 12: an area of the deck at its own level — a pipe deck
// above the main deck, a bay below it — stands its cargo that much higher
// or lower in the stability.

// 1000 t lightship at KG 5, KM 8 at 1000–3000 t, 500 t of ballast at 1 m;
// the deck 6 m above the keel.
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
  },
  hydrostatics: {
    points: [
      { displacementKg: 1_000_000, draftM: 2, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
      { displacementKg: 3_000_000, draftM: 6, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
    ],
  },
  variableWeights: [{ id: 'b', name: 'Балласт', weightKg: 500_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
}

// A 100 t box 2 m tall.
const BOX = { id: 'box', name: 'Ящик', width: 2, length: 2, height: 2, quantity: 1, color: '#64748b', allowRotation: true, weight: 100_000 }

async function openWithBox(page: Page) {
  await page.addInitScript(
    (p) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('deckload-projects', JSON.stringify({ activeId: p.id, projects: [p] }))
    },
    {
      id: 'levels',
      name: 'Уровни',
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
      items: [BOX],
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
    }
  )
  await page.goto('/')
  await expect(page.locator('[data-status-item="gm"]')).toBeVisible()
}

test('a raised area lifts its cargo and lowers the GM; a bay lowers it, no deeper than the keel', async ({ page }) => {
  await openWithBox(page)
  const gm = statusLine(page).locator('[data-status-item="gm"]')
  // On the deck: KG (5000 + 500 + 100 × 7)/1600 = 3.875, GM 4.125.
  await expect(gm).toContainText('GM 4.13 м')

  // A zone over the whole deck, 3 m above it: the box at 6 + 3 + 1 m.
  await openSection(page, 'Судно')
  await unfoldVesselBlocks(page)
  await page.getByRole('button', { name: 'Добавить зону' }).click()
  for (const [label, value] of [['X', '0'], ['Y', '0'], ['Шир.', '10'], ['Длин.', '20']]) await setNumber(page.getByLabel(`Зона 1: ${label}, м`, { exact: true }), value)
  const level = page.getByLabel('Зона 1: Над палубой, м', { exact: true })
  await expect(level).toHaveAttribute('placeholder', 'на палубе')
  await setNumber(level, '3')
  // KG (5500 + 1000)/1600 = 4.0625, GM 3.9375.
  await expect(gm).toContainText('GM 3.94 м')
  await expect(page.locator('svg[data-deck-plan] text').filter({ hasText: /т\/м² · \+3 м$/ })).toBeVisible()

  // A bay 2 m deep: the box at 6 − 2 + 1 m — KG 6000/1600 = 3.75.
  await setNumber(level, '-2')
  await expect(gm).toContainText('GM 4.25 м')
  await expect(page.locator('svg[data-deck-plan] text').filter({ hasText: /т\/м² · −2 м$/ })).toBeVisible()

  // No floor under the keel: −10 comes back as −6, the box at 0 + 1 m.
  await setNumber(level, '-10')
  await expect(level).toHaveValue('-6')
  await expect(gm).toContainText('GM 4.50 м')

  // Emptied, the area is at the deck's level again.
  await setNumber(level, '')
  await expect(gm).toContainText('GM 4.13 м')
})

import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { inspector, openSection } from './helpers'

// Stage 1 (spec 13, 14): no text on the main screen below WCAG AA contrast,
// in the light theme and in the dark one — every section, and the inspector
// of a selected stack. Labels drawn on the deck are SVG, which axe doesn't
// measure reliably: the palette's unit test covers them.

const SECTIONS = ['Судно', 'Грузы', 'Размещение', 'Проверки', 'Отчёт'] as const

// A plan with problems, so the red and amber texts show: three containers,
// one tied by a lashing too weak for it, one on an overloaded load zone.
const PROBLEMS = {
  id: 'p',
  name: 'Проблемы',
  createdAt: 0,
  updatedAt: 0,
  deck: {
    width: 12,
    length: 30,
    unit: 'm',
    gap: 0.1,
    boardOffset: 0.2,
    clearance: 6,
    loadZones: [{ id: 'z1', x: 0.5, y: 18, width: 7, length: 9, maxLoadPerArea: 0.3 }],
    lashingPoints: [{ id: 'l1', x: 0.4, y: 0.4, label: 'Точка 1', placementId: 'a', itemId: 'c', cornerX: 1, cornerY: 1, mslKg: 500, verticalAngleDeg: 45, deviceType: 'chain_g80_10' }],
  },
  items: [{ id: 'c', name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 3, color: '#0ea5e9', allowRotation: false, weight: 20000 }],
  manualPlacements: [],
  pinnedPlacementsByTrip: {
    0: [
      { id: 'a', itemId: 'c', name: 'Контейнер 20ft', x: 1, y: 1, width: 6.06, length: 2.44, layers: 1, rotated: false, color: '#0ea5e9', weight: 20000, locked: true },
      { id: 'b', itemId: 'c', name: 'Контейнер 20ft', x: 1, y: 20, width: 6.06, length: 2.44, layers: 1, rotated: false, color: '#0ea5e9', weight: 20000, locked: true },
    ],
  },
  separationRules: [],
  mode: 'auto',
  sortStrategy: 'area-desc',
  globalRotation: true,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,
  showCargoContents: true,
}

async function contrastViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ')}`)
  )
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    // Without motion: axe measures what is on screen, and a toast still
    // fading in reads as a paler, failing colour.
    test.use({ colorScheme, viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } })

    test('every section of the main screen reads at AA contrast', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('svg g[data-cargo-placement]').first()).toBeVisible()
      const found: Record<string, string[]> = {}
      for (const section of SECTIONS) {
        await openSection(page, section)
        found[section] = await contrastViolations(page)
      }
      expect(found).toEqual(Object.fromEntries(SECTIONS.map((s) => [s, []])))
    })

    test('a plan with problems reads at AA contrast: its checks, its note and the inspector of a stack with problems', async ({ page }) => {
      await page.addInitScript((project) => {
        if (sessionStorage.getItem('seeded')) return
        sessionStorage.setItem('seeded', '1')
        localStorage.setItem('deckload-projects', JSON.stringify({ activeId: project.id, projects: [project] }))
      }, PROBLEMS)
      await page.goto('/')
      await expect(page.locator('svg [data-load-zone="overloaded"]')).toBeVisible()
      await expect(page.getByText('Перегрузка: превышена нагрузка одной зоны')).toBeVisible()
      await openSection(page, 'Проверки')
      expect(await contrastViolations(page)).toEqual([])

      const tied = page.locator('svg g[data-cargo-placement]').filter({ has: page.locator('[data-mark="lashing-short"]') })
      await expect(async () => {
        await tied.click({ force: true })
        await expect(inspector(page).getByText('Не хватает крепления')).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10000 })
      expect(await contrastViolations(page)).toEqual([])
    })

    test('the inspector of a selected stack reads at AA contrast', async ({ page }) => {
      await page.goto('/')
      const stack = page.locator('svg g[data-cargo-placement]').first()
      await expect(stack).toBeVisible()
      await expect(async () => {
        await stack.click({ force: true })
        await expect(inspector(page)).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10000 })
      expect(await contrastViolations(page)).toEqual([])
    })
  })
}

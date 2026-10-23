import { test, expect, type Page } from '@playwright/test'
import { unitsCount } from './helpers'

// Spec 6.2: at «Вписать» on 1440×900 every stack's number is written — on
// the stack, or once over its group of neighbours — on the demo and on a
// library vessel with typical cargo: containers, pallets, pipes.

test.use({ viewport: { width: 1440, height: 900 } })

async function stacksWithoutNumber(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const deck = document.querySelector('svg[data-deck-plan]')!
    const grouped = new Set(
      [...deck.querySelectorAll('[data-stack-label="group"]')].flatMap((g) => (g.getAttribute('data-stack-keys') ?? '').split(' '))
    )
    return [...deck.querySelectorAll('g[data-cargo-placement]')]
      .filter((s) => !s.querySelector('[data-stack-label="own"]') && !grouped.has(s.getAttribute('data-stack-key') ?? ''))
      .map((s) => s.getAttribute('data-stack-text') ?? '?')
  })
}

test('the demo shows the number of every stack', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  await expect(page.locator('svg g[data-cargo-placement]').first()).toBeVisible()
  expect(await stacksWithoutNumber(page)).toEqual([])
  // Each number is the cargo's place in the list.
  const texts = await page.locator('svg g[data-cargo-placement]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stack-text')))
  expect(new Set(texts.map((t) => t?.split(' ')[0]))).toEqual(new Set(['1', '2', '3']))
})

test('a library vessel with containers, pallets and pipes shows the number of every stack', async ({ page }) => {
  // «Алексей Кузнецов»: 16.9 × 49.1 m.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    const now = Date.now()
    localStorage.setItem(
      'deckload-projects',
      JSON.stringify({
        activeId: 'v',
        projects: [
          {
            id: 'v',
            name: 'Кузнецов',
            createdAt: now,
            updatedAt: now,
            deck: { width: 16.9, length: 49.1, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 6 },
            items: [
              { id: 'c', name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 6, color: '#0ea5e9', allowRotation: true, weight: 2200 },
              { id: 'p', name: 'Паллета EUR', width: 1.2, length: 0.8, height: 0.14, quantity: 30, color: '#10b981', allowRotation: true, weight: 500 },
              { id: 'k', name: 'Обсадная труба', width: 9.5, length: 0.25, height: 0.25, quantity: 24, color: '#57534e', allowRotation: true, weight: 700, shape: 'cylinder' },
              { id: 'b', name: 'Бурильная труба (свеча, Range 2)', width: 9.5, length: 0.15, height: 0.15, quantity: 20, color: '#334155', allowRotation: true, weight: 400, shape: 'cylinder' },
            ],
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
          },
        ],
      })
    )
  })
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/80\/80 ед\./)
  await expect(page.locator('svg g[data-cargo-placement]').first()).toBeVisible()
  expect(await stacksWithoutNumber(page)).toEqual([])
})

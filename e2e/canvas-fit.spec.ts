import { test, expect, type Page } from '@playwright/test'
import { armCargo, chooseFromCatalog, clearCalculation, unitsCount } from './helpers'

// Spec 5.4, 12.5: the deck takes the whole area. A 49×17 m deck at 1440×900
// fills at least 90% of the central area's width, which itself is at least
// 60% of the window. Closing a panel keeps the scale; «Вписать» fits the
// deck to the canvas as it is now. Clicks and drags land where they are
// made whatever the canvas's size.

test.use({ viewport: { width: 1440, height: 900 } })

const KUZNETSOV = {
  id: 'k',
  name: 'Кузнецов',
  createdAt: 0,
  updatedAt: 0,
  deck: { width: 16.9, length: 49.1, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 6 },
  items: [{ id: 'c', name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 6, color: '#0ea5e9', allowRotation: true, weight: 2200 }],
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

const deckRect = (page: Page) => page.locator('svg[data-deck-plan] [data-deck-background]').first()

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox()
  if (!b) throw new Error(`no box for ${selector}`)
  return b
}

test('a 49×17 m deck fills 90% of the central area, a closing panel keeps its scale, «Вписать» fits it again', async ({ page }) => {
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('deckload-projects', JSON.stringify({ activeId: project.id, projects: [project] }))
  }, KUZNETSOV)
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/6\/6 ед\./)

  const main = await box(page, 'main')
  expect((main.width * main.height) / (1440 * 900)).toBeGreaterThanOrEqual(0.6)
  const fitted = await deckRect(page).boundingBox()
  expect(fitted!.width / main.width).toBeGreaterThanOrEqual(0.9)
  const fit = page.getByRole('button', { name: 'Вписать' })
  await expect(fit).toBeDisabled()

  await page.getByRole('button', { name: 'Свернуть панель' }).click()
  await expect.poll(async () => (await box(page, 'main')).width).toBeGreaterThan(main.width + 200)
  expect((await deckRect(page).boundingBox())!.width).toBeCloseTo(fitted!.width, 0)

  await fit.click()
  await expect.poll(async () => (await deckRect(page).boundingBox())!.width).toBeGreaterThan(fitted!.width + 200)
  await expect(fit).toBeDisabled()
})

// The pin of trip 1, read from the autosave once its debounce has settled.
async function storedPin(page: Page) {
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('deckload-projects') ?? 'null')
    const project = data?.projects?.find((p: { id: string }) => p.id === data.activeId)
    return (project?.pinnedPlacementsByTrip?.['0'] ?? [])[0] as { x: number; y: number } | undefined
  })
}

test('a stamp lands where the deck is clicked and a drag moves it as far as the pointer, at any canvas size', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)

  for (const panel of ['open', 'closed'] as const) {
    // From the catalogue the packer puts the container at the deck's start;
    // «Поставить» arms it for a click.
    await chooseFromCatalog(page, 'Контейнер 20ft')
    await armCargo(page, 'Контейнер 20ft')
    // With the panel closed the canvas is wider; «Вписать» fits the deck to it.
    if (panel === 'closed') {
      const before = (await deckRect(page).boundingBox())!.width
      await page.getByRole('button', { name: 'Свернуть панель' }).click()
      await page.getByRole('button', { name: 'Вписать' }).click()
      await expect.poll(async () => (await deckRect(page).boundingBox())!.width).toBeGreaterThan(before + 100)
    }

    // The demo deck, 8 × 20 m, is drawn with its length across the screen:
    // screen x is the deck's y, screen y its x.
    const rect = (await deckRect(page).boundingBox())!
    const pxPerM = rect.width / 20
    expect(rect.height / 8).toBeCloseTo(pxPerM, 0)
    await page.mouse.click(rect.x + 4 * pxPerM, rect.y + 1 * pxPerM)
    await page.keyboard.press('Escape')
    const stack = page.locator('svg g[data-cargo-placement="true"]')
    await expect(stack).toHaveCount(1)
    // The stamp's corner nearest the deck's origin goes where it was clicked.
    const placed = await storedPin(page)
    expect(placed!.y).toBeCloseTo(4, 1)
    expect(placed!.x).toBeCloseTo(1, 1)

    // 6 m to the right on screen is 6 m along the deck.
    const s = (await stack.boundingBox())!
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width / 2 + 6 * pxPerM, s.y + s.height / 2, { steps: 8 })
    await page.mouse.up()
    const moved = await storedPin(page)
    expect(moved!.y - placed!.y).toBeCloseTo(6, 0)
    expect(moved!.x).toBeCloseTo(placed!.x, 1)

    if (panel === 'closed') await page.getByRole('button', { name: 'Развернуть панель' }).click()
    await clearCalculation(page)
  }
})

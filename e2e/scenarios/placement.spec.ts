import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  addOwnCargo,
  armCargo,
  clearCalculation,
  closeCargoTable,
  inspector,
  openSection,
  sectionBar,
  setCargoCells,
  setCargoTotal,
  stackTools,
  unitsCount,
} from '../helpers'

// Appendix C, scenarios 9–14, from the entry points of stage 2: buttons on
// screen, the inspector and the mini-panel — never a right-click. Scenario 10
// is in its full version (stage 3): «Поставить», R, a click.

const deck = (page: Page) => page.locator('svg[data-deck-plan]')
const locks = (page: Page) => deck(page).locator('[data-mark="lock"]')

// The active calculation as saved, once the autosave has settled.
async function saved(page: Page) {
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('deckload-projects') ?? 'null')
    return data?.projects?.find((p: { id: string }) => p.id === data.activeId)
  })
}

// Selects a stack with a click: the inspector opens.
async function select(stack: Locator) {
  const page = stack.page()
  await expect(async () => {
    await stack.click({ force: true })
    await expect(inspector(page)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
}

// A stack's box once it has stopped moving (the view slides from under the
// inspector and back).
async function settledBox(stack: Locator) {
  const page = stack.page()
  let prev = await stack.boundingBox()
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50)
    const box = await stack.boundingBox()
    if (box && prev && box.x === prev.x && box.y === prev.y && box.width === prev.width && box.height === prev.height) return box
    prev = box
  }
  throw new Error('the stack kept moving')
}

test('Сценарий 9: авторазмещение и варианты', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

  // A container fixed in place with «Закрепить».
  const container = deck(page).locator('g[data-cargo-name="Контейнер 20ft"]').first()
  await select(container)
  await inspector(page).getByRole('button', { name: 'Закрепить' }).click()
  await expect(locks(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(inspector(page)).toHaveCount(0)
  const fixed = await saved(page)
  const pin = fixed.pinnedPlacementsByTrip['0'].find((p: { locked?: boolean }) => p.locked)

  // Variants, and the second one applied: the fixed container stays put.
  await openSection(page, 'Размещение')
  await page.getByRole('button', { name: /^Автораспределение/ }).click()
  await expect(page.getByText(/Сгенерировано вариантов/)).toBeVisible()
  const variants = page.locator('button').filter({ has: page.getByText(/ед\.$/) }).filter({ hasText: '%' })
  await expect(variants.nth(1)).toBeVisible()
  await variants.nth(1).click()
  await expect(locks(page)).toHaveCount(1)
  const after = await saved(page)
  const kept = after.pinnedPlacementsByTrip['0'].find((p: { locked?: boolean }) => p.locked)
  expect({ x: kept.x, y: kept.y }).toEqual({ x: pin.x, y: pin.y })
})

test('Сценарий 10: ручная расстановка', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)

  // «Ручной», then a cargo 3 m across and 1 m along the ship to place.
  await page.getByRole('radio', { name: 'Ручной' }).click()
  await expect(page.getByRole('radio', { name: 'Ручной' })).toHaveAttribute('aria-checked', 'true')
  await addOwnCargo(page, { width: '3', length: '1' })

  // «Поставить»; the line over the deck says what a click does; R turns
  // the cargo for the click, and it goes on the deck turned.
  await armCargo(page, 'Груз 1')
  await expect(page.getByTestId('stamp-hint')).toHaveText('Кликните по палубе, чтобы поставить «Груз 1» · R — повернуть · Esc — отмена')
  await page.keyboard.press('r')
  await deck(page).locator('[data-deck-background="true"]').first().click({ position: { x: 120, y: 120 }, force: true })
  await expect(unitsCount(page)).toHaveText(/1\/1 ед\./)
  const placed = (await saved(page)).manualPlacements[0]
  expect(placed.rotated).toBe(true)
  expect({ width: placed.width, length: placed.length }).toEqual({ width: 1, length: 3 })
})

test('Сценарий 11: переместить, повернуть, ярусы', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)
  // Two 2 × 1.2 × 1 m units stacked 2 high, with the deck to themselves:
  // room to turn.
  await addOwnCargo(page, { width: '2', length: '1.2', height: '1', quantity: '2' })
  await setCargoCells(page, 'Груз 1', { Ярусов: '2' })
  await closeCargoTable(page)
  await expect(unitsCount(page)).toHaveText(/2\/2 ед\./)
  const box = deck(page).locator('g[data-cargo-name="Груз 1"]').first()

  // A click selects and pins nothing.
  await select(box)
  expect((await saved(page)).pinnedPlacementsByTrip?.['0'] ?? []).toHaveLength(0)

  // Dragged, it stays where it was put, fixed — the inspector says so (a
  // stack this small keeps its number, not a lock badge, spec 6.2).
  await page.keyboard.press('Escape')
  const start = await settledBox(box)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 40, start.y + start.height / 2 + 20, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await saved(page)).pinnedPlacementsByTrip?.['0']?.[0]?.locked).toBe(true)
  await expect(inspector(page).getByText('Закреплён: авторасстановка его не двигает')).toBeVisible()

  // «Повернуть» and «+» from the inspector.
  const moved = deck(page).locator('g[data-cargo-placement][data-selected]')
  await expect(moved).toHaveCount(1)
  const before = (await saved(page)).pinnedPlacementsByTrip['0'][0]
  await inspector(page).getByRole('button', { name: 'Повернуть' }).click()
  await expect.poll(async () => (await saved(page)).pinnedPlacementsByTrip['0'][0].rotated).toBe(!before.rotated)
  // «−» takes a unit off (the packer puts it elsewhere), «+» brings it back.
  const layers = inspector(page).locator('[aria-live="polite"]')
  await expect(layers).toHaveText('2')
  await inspector(page).getByRole('button', { name: 'Убрать ярус' }).click()
  await expect(layers).toHaveText('1')
  await inspector(page).getByRole('button', { name: 'Добавить ярус' }).click()
  await expect(layers).toHaveText('2')
  await expect(inspector(page).getByText('Закреплён: авторасстановка его не двигает')).toBeVisible()
})

test('Сценарий 12: закрепить и открепить', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await select(deck(page).locator('g[data-cargo-name="Контейнер 20ft"]').first())

  await inspector(page).getByRole('button', { name: 'Закрепить' }).click()
  await expect(locks(page)).toHaveCount(1)
  await expect(inspector(page).getByText('Закреплён: авторасстановка его не двигает')).toBeVisible()

  await inspector(page).getByRole('button', { name: 'Вернуть в авто' }).click()
  await expect(locks(page)).toHaveCount(0)

  // The mini-panel over the stack offers the same under «⋯».
  await select(deck(page).locator('g[data-cargo-name="Контейнер 20ft"]').first())
  await stackTools(page).getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Закрепить' }).click()
  await expect(locks(page)).toHaveCount(1)
})

// Two pipes of the same size stacked four high and fixed on the deck: one
// stack of the first, two of the second.
const PIPES = {
  id: 'pipes',
  name: 'Трубы',
  createdAt: 0,
  updatedAt: 0,
  deck: { width: 8, length: 20, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 6 },
  items: [
    { id: 'a', name: 'Труба А', width: 9.5, length: 0.25, height: 0.25, quantity: 4, color: '#57534e', allowRotation: true, weight: 700, shape: 'cylinder' },
    { id: 'b', name: 'Труба Б', width: 9.5, length: 0.25, height: 0.25, quantity: 8, color: '#334155', allowRotation: true, weight: 700, shape: 'cylinder' },
  ],
  manualPlacements: [],
  pinnedPlacementsByTrip: {
    0: [
      { id: 'pa', itemId: 'a', name: 'Труба А', x: 1, y: 2, width: 0.5, length: 9.5, layers: 4, rotated: true, color: '#57534e', weight: 700, locked: true },
      { id: 'pb', itemId: 'b', name: 'Труба Б', x: 4, y: 2, width: 0.5, length: 9.5, layers: 4, rotated: true, color: '#334155', weight: 700, locked: true },
      { id: 'pb2', itemId: 'b', name: 'Труба Б', x: 6, y: 2, width: 0.5, length: 9.5, layers: 4, rotated: true, color: '#334155', weight: 700, locked: true },
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

async function dragOnto(page: Page, from: Locator, to: Locator, drop: boolean) {
  const a = await settledBox(from)
  const b = await settledBox(to)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  if (drop) await page.mouse.up()
}

test('Сценарий 13: объединить штабели труб', async ({ page }) => {
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('deckload-projects', JSON.stringify({ activeId: project.id, projects: [project] }))
  }, PIPES)
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/12\/12 ед\./)
  const pipeA = deck(page).locator('g[data-cargo-name="Труба А"]')
  const pipeB = deck(page).locator('g[data-cargo-name="Труба Б"]').first()

  // Above the height limit the target says why, and the drop changes nothing.
  await openSection(page, 'Судно')
  const clearance = page.getByLabel('Предельная высота штабеля')
  await clearance.fill('1.5')
  await clearance.blur()
  await dragOnto(page, pipeB, pipeA, false)
  await expect(deck(page).locator('[data-merge-preview]')).toContainText('Выше предельной высоты')
  await page.mouse.up()
  await expect(deck(page).locator('g[data-cargo-placement]')).toHaveCount(3)

  // Within it, the target names the merge before the drop, and the stack
  // left holds both pipes.
  await clearance.fill('6')
  await clearance.blur()
  await dragOnto(page, pipeB, pipeA, false)
  await expect(deck(page).locator('[data-merge-preview]')).toContainText(/Объединить: 8 яр\./)
  await page.mouse.up()
  await expect(deck(page).locator('g[data-cargo-placement]')).toHaveCount(2)
  await expect(deck(page).locator('g[data-cargo-placement][data-stack-text="1+2 ×8"]')).toHaveCount(1)
})

test('Сценарий 14: несколько рейсов', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await setCargoTotal(page, 'Паллета EUR', '400')

  // Two trips, each tab with what it carries; what goes to trip 2 is said,
  // and nothing is flagged as not fitting.
  await expect(page.getByRole('tab', { name: /^Рейс 1 · / })).toBeVisible()
  await expect(page.getByRole('tab', { name: /^Рейс 2 · / })).toBeVisible()
  await expect(page.getByTestId('trip-carry-over')).toContainText(/уход(ит|ят) в рейс 2/)
  await expect(page.getByText(/Не поместилось/)).toHaveCount(0)
})

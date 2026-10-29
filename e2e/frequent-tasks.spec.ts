import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  addOwnCargo,
  cargoRow,
  clearCalculation,
  closeCargoTable,
  inspector,
  openCargoTable,
  openSection,
  setCargoCells,
  stackTools,
  unitsCount,
} from './helpers'

// Spec 2.3: how many actions the frequent tasks take, pinned by tests. An
// action is a click, or a number typed over the selected one and confirmed
// with Enter. Getting to where the task starts (the section, the open table,
// a cargo to work on) isn't counted.

class Actions {
  count = 0
  constructor(private page: Page) {}
  async click(target: Locator, options?: { force?: boolean }) {
    this.count++
    await target.click(options)
  }
  async typeAndEnter(text: string) {
    this.count++
    await this.page.keyboard.type(text)
    await this.page.keyboard.press('Enter')
  }
}

// The active calculation as saved, once the autosave has settled.
async function saved(page: Page) {
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('deckload-projects') ?? 'null')
    return data?.projects?.find((p: { id: string }) => p.id === data.activeId)
  })
}

const deck = (page: Page) => page.locator('svg[data-deck-plan]')

async function demo(page: Page) {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/^22\/22 ед\./)
}

// One cargo 2 × 1.2 × 1 m on a deck of its own: room to turn.
async function oneCargo(page: Page, extra: { quantity?: string } = {}) {
  await demo(page)
  await clearCalculation(page)
  await addOwnCargo(page, { width: '2', length: '1.2', height: '1', ...extra })
}

test('Изменить количество груза: 2 действия — «всего» в списке, ввод', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Грузы')
  const a = new Actions(page)
  await a.click(page.getByLabel('Всего, Контейнер 20ft', { exact: true }))
  await a.typeAndEnter('6')
  await expect(unitsCount(page)).toHaveText(/^24\/24 ед\./)
  expect(a.count).toBe(2)
})

test('Изменить количество груза: 2 действия — ячейка «Кол-во» в таблице, ввод', async ({ page }) => {
  await demo(page)
  const table = await openCargoTable(page)
  const a = new Actions(page)
  await a.click(table.getByLabel('Количество, Контейнер 20ft', { exact: true }))
  await a.typeAndEnter('6')
  await expect(unitsCount(page)).toHaveText(/^24\/24 ед\./)
  expect(a.count).toBe(2)
})

test('Добавить груз из каталога: 2 действия — «Каталог», выбор груза', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Грузы')
  const a = new Actions(page)
  await a.click(page.getByRole('button', { name: 'Каталог', exact: true }))
  await a.click(page.getByRole('region', { name: 'Каталог грузов' }).getByRole('button', { name: /^Паллета IND,/ }))
  await expect(cargoRow(page, 'Паллета IND')).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/^23\/23 ед\./)
  expect(a.count).toBe(2)
})

test('Повернуть штабель: 2 действия — выделить, «Повернуть»', async ({ page }) => {
  await oneCargo(page)
  const stack = deck(page).locator('g[data-cargo-name="Груз 1"]').first()
  const a = new Actions(page)
  await a.click(stack, { force: true })
  await a.click(stackTools(page).getByRole('button', { name: 'Повернуть' }))
  await expect.poll(async () => (await saved(page)).pinnedPlacementsByTrip?.['0']?.[0]?.rotated).toBe(true)
  expect(a.count).toBe(2)
})

test('Изменить число ярусов: 2 действия — выделить, «−»', async ({ page }) => {
  // Two units, two to a stack: one stack of 2.
  await oneCargo(page, { quantity: '2' })
  await setCargoCells(page, 'Груз 1', { Ярусов: '2' })
  await closeCargoTable(page)
  const stack = deck(page).locator('g[data-cargo-name="Груз 1"]')
  await expect(stack).toHaveCount(1)
  const a = new Actions(page)
  await a.click(stack.first(), { force: true })
  await a.click(stackTools(page).getByRole('button', { name: 'Убрать ярус' }))
  await expect.poll(async () => (await saved(page)).pinnedPlacementsByTrip?.['0']?.[0]?.layers).toBe(1)
  expect(a.count).toBe(2)
})

test('Закрепить штабель: 2 действия — выделить, «Закрепить»', async ({ page }) => {
  await demo(page)
  const a = new Actions(page)
  await a.click(deck(page).locator('g[data-cargo-name="Контейнер 20ft"]').first(), { force: true })
  await a.click(inspector(page).getByRole('button', { name: 'Закрепить', exact: true }))
  await expect(deck(page).locator('[data-mark="lock"]')).toHaveCount(1)
  expect(a.count).toBe(2)
})

// Placed by hand: a dangerous cargo tied down too weakly, and a box.
const WEAKLY_TIED = {
  id: 'weak',
  name: 'Крепление',
  createdAt: 0,
  updatedAt: 0,
  deck: {
    width: 8,
    length: 20,
    unit: 'm',
    gap: 0.1,
    boardOffset: 0.2,
    clearance: 6,
    lashingPoints: [{ id: 'l1', x: 1.5, y: 1.5, placementId: 'mg', itemId: 'g', cornerX: 2, cornerY: 2, mslKg: 100, verticalAngleDeg: 45 }],
  },
  items: [
    { id: 'g', name: 'Газ', width: 2, length: 2, height: 1, quantity: 1, color: '#dc2626', allowRotation: true, weight: 5000, category: 'Опасный груз' },
    { id: 'f', name: 'Ящик', width: 1, length: 1, height: 1, quantity: 1, color: '#0ea5e9', allowRotation: true, weight: 1000 },
  ],
  manualPlacements: [
    { id: 'mg', itemId: 'g', name: 'Газ', x: 2, y: 2, width: 2, length: 2, layers: 1, rotated: false, color: '#dc2626', weight: 5000 },
    { id: 'mf', itemId: 'f', name: 'Ящик', x: 5, y: 12, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9', weight: 1000 },
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

test('Найти причину предупреждения: 2 действия — «⚠ N» в строке статуса, пункт списка', async ({ page }) => {
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('deckload-projects', JSON.stringify({ activeId: project.id, projects: [project] }))
  }, WEAKLY_TIED)
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/^2\/2 ед\./)
  const a = new Actions(page)
  await a.click(page.locator('[data-status-item="warnings"]'))
  await a.click(page.locator('[data-check="lashing"] > button'))
  // The reason, and the stack at fault: the other one steps back.
  await expect(page.getByRole('list', { name: 'Крепление: подробности' })).toContainText('«Газ»: не держит по расчёту сил')
  await expect(deck(page).locator('g[data-cargo-name="Газ"]')).not.toHaveAttribute('data-dimmed', 'true')
  await expect(deck(page).locator('g[data-cargo-name="Ящик"]')).toHaveAttribute('data-dimmed', 'true')
  expect(a.count).toBe(2)
})

test('Скачать PDF: 1 действие', async ({ page }) => {
  await demo(page)
  const a = new Actions(page)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), a.click(page.getByRole('button', { name: 'Скачать PDF' }))])
  expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
  expect(a.count).toBe(1)
})

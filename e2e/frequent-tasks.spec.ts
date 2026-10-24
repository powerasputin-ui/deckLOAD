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
// a cargo to work on) isn't counted. «Найти причину предупреждения» joins at
// stage 4, with «Проверки» lighting up the stacks at fault.

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

test('Скачать PDF: 1 действие', async ({ page }) => {
  await demo(page)
  const a = new Actions(page)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), a.click(page.getByRole('button', { name: 'Скачать PDF' }))])
  expect(download.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
  expect(a.count).toBe(1)
})

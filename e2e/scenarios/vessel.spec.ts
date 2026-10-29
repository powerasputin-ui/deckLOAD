import { test, expect, type Page } from '@playwright/test'
import { chooseFromCatalog, chooseLibraryVessel, clearCalculation, openCargoTable, openCheck, openSection, setNumber, tripSummaryValue, unitsCount } from '../helpers'

// Appendix C, scenarios 1–6 in their full versions (stage 4): what is on
// screen, never a right-click.

const deck = (page: Page) => page.locator('svg[data-deck-plan]')
const background = (page: Page) => deck(page).locator('[data-deck-background="true"]').first()

// The deck's area, as the trip's summary states it in «Размещение»: free
// out of the whole, «160 из 160 м²» on an empty deck.
async function deckArea(page: Page): Promise<string> {
  const free = await tripSummaryValue(page, 'Свободно')
  await expect(free).toBeVisible()
  return free.innerText()
}

test('Сценарий 1: начать с реального судна', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  // The demo has cargo: the vessel goes onto a calculation of its own, and
  // the question closes.
  await chooseLibraryVessel(page, 'Алексей Кузнецов (IMO 9692648)')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // The vessel's deck, drawn with its size and its bow and stern named.
  await expect(deck(page).getByText('49.10 м')).toBeVisible()
  await expect(deck(page).getByText('16.90 м')).toBeVisible()
  await expect(deck(page).locator('[data-hull-side="bow"]')).toContainText('НОС')
  await expect(deck(page).locator('[data-hull-side="stern"]')).toHaveText('КОРМА')

  // Its sources disagree on the deck strength: the card says so, and the
  // zones check waits.
  await expect(page.getByTestId('vessel-name')).toHaveText('Алексей Кузнецов (IMO 9692648)')
  await expect(page.getByText('лимит не выбран', { exact: true })).toBeVisible()
  await openSection(page, 'Проверки')
  await expect(page.locator('[data-check="zones"]')).toHaveAttribute('data-check-status', 'warn')

  // «5 т/м²» makes a zone over the whole deck, and the check is fine.
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: '5 т/м²' }).click()
  await expect(page.getByRole('button', { name: '5 т/м²' })).toHaveAttribute('aria-pressed', 'true')
  const zones = page.getByRole('list', { name: 'Зоны нагрузки' })
  await expect(zones.getByText('Зона 1 (вся палуба)')).toBeVisible()
  await expect(zones.getByLabel('Зона 1: Лимит, т/м²')).toHaveValue('5')
  await openSection(page, 'Проверки')
  await expect(page.locator('[data-check="zones"]')).toHaveAttribute('data-check-status', 'ok')
})

test('Сценарий 2: размеры, отступы, предельная высота, единицы', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await openSection(page, 'Судно')

  // A new width redraws the deck: 8 m across becomes 10.
  await expect(deck(page).getByText(/^8 м$/)).toBeVisible()
  await setNumber(page.getByLabel('Ширина'), '10')
  await expect(deck(page).getByText(/^10 м$/)).toBeVisible()

  // A 1 m height limit stacks a 0.14 m pallet 7 high at most.
  await setNumber(page.getByLabel('Предельная высота штабеля'), '1')
  const pallet = deck(page).locator('g[data-cargo-name="Паллета EUR"]').first()
  await expect(async () => {
    await pallet.click({ force: true })
    await expect(page.getByRole('complementary', { name: 'Инспектор' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
  await expect(page.getByRole('complementary', { name: 'Инспектор' }).getByText('макс. 7 по высоте')).toBeVisible()
  await page.keyboard.press('Escape')

  // Feet convert the fields and the cargo's sizes, in the cargo table.
  await expect(async () => {
    await page.getByRole('radio', { name: 'фт' }).click()
    await expect(page.getByLabel('Ширина')).toHaveValue(/^32\.8/, { timeout: 1000 })
  }).toPass({ timeout: 10000 })
  const table = await openCargoTable(page)
  await expect(table.getByRole('columnheader', { name: /^Д×Ш×В, фт$/ })).toBeVisible()
  await expect(table.getByLabel('Ширина, Контейнер 20ft', { exact: true })).toHaveValue(/^19\.88/)
})

// The outline's vertex handle at the top right of the drawing.
async function topRightHandle(page: Page) {
  const handles = deck(page).locator('circle[fill="rgba(37,99,235,0.9)"]')
  await expect(handles.first()).toBeVisible()
  let best = 0
  let bestScore = -Infinity
  for (let i = 0; i < (await handles.count()); i++) {
    const b = await handles.nth(i).boundingBox()
    if (b && b.x - b.y > bestScore) {
      bestScore = b.x - b.y
      best = i
    }
  }
  return handles.nth(best)
}

async function dragTopRightCornerIn(page: Page) {
  const handle = await topRightHandle(page)
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 + 150, { steps: 10 })
  await page.mouse.up()
}

// A box in each corner of an 8 × 20 m deck, placed by hand: whichever
// corner the outline cuts off, one box ends up outside it.
const FOUR_CORNERS = {
  id: 'corners',
  name: 'Углы',
  createdAt: 0,
  updatedAt: 0,
  deck: { width: 8, length: 20, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
  items: [{ id: 'b', name: 'Ящик', width: 1, length: 1, height: 1, quantity: 4, color: '#0ea5e9', allowRotation: true, weight: 500 }],
  manualPlacements: [
    [0.3, 0.3],
    [6.7, 0.3],
    [0.3, 18.7],
    [6.7, 18.7],
  ].map(([x, y], i) => ({ id: `m${i}`, itemId: 'b', name: 'Ящик', x, y, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9', weight: 500 })),
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

test('Сценарий 3: непрямоугольная палуба', async ({ page }) => {
  await page.addInitScript((project) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('deckload-projects', JSON.stringify({ activeId: project.id, projects: [project] }))
  }, FOUR_CORNERS)
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/^4\/4 ед\./)
  const rectangle = await deckArea(page)

  // «Отмена» throws an edit away.
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Форма палубы' }).click()
  await dragTopRightCornerIn(page)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await deckArea(page)).toBe(rectangle)

  // «Форма палубы»: a corner pulled in and saved makes the deck smaller…
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Форма палубы' }).click()
  await dragTopRightCornerIn(page)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect(await deckArea(page)).not.toBe(rectangle)

  // …and the boxes it leaves outside — the cut slants both edges next to
  // the corner — are hatched and need attention in «Проверки», each with
  // «Показать».
  const outside = deck(page).locator('[data-conflict="true"]')
  await expect(outside.first()).toBeVisible()
  const count = await outside.count()
  const attention = await openCheck(page, 'attention')
  await expect(attention).toHaveAttribute('data-check-status', 'error')
  await expect(attention.getByRole('button', { name: /^Показать: «Ящик»/ })).toHaveCount(count)

  // «Сбросить к прямоугольнику»: the deck is whole again, nothing to fix.
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Сбросить к прямоугольнику' }).click()
  expect(await deckArea(page)).toBe(rectangle)
  await expect(outside).toHaveCount(0)
  await openSection(page, 'Проверки')
  await expect(page.locator('[data-check="attention"]')).toHaveCount(0)
})

// A minimal valid 1×1 PNG.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('Сценарий 4: фото палубы и калибровка', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)

  // «Судно» → «Фото палубы»: the photo is uploaded whole (spec 8.1).
  await openSection(page, 'Судно')
  const photo = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Фото палубы' }) })
  const chooser = page.waitForEvent('filechooser')
  await photo.getByRole('button', { name: 'Загрузить фото' }).click()
  await (await chooser).setFiles({ name: 'deck.png', mimeType: 'image/png', buffer: TINY_PNG })
  const image = deck(page).locator('image')
  await expect(image).toHaveCount(1)
  await expect(photo.getByRole('button', { name: 'Заменить фото' })).toBeVisible()

  // Calibrated by two points and the real distance between them: the scale
  // changes.
  const before = (await image.boundingBox())!
  await photo.getByRole('button', { name: 'Калибровать', exact: true }).click()
  await expect(page.getByText(/Отметьте на фото две точки/)).toBeVisible()
  await background(page).click({ position: { x: 100, y: 60 }, force: true })
  await background(page).click({ position: { x: 300, y: 60 }, force: true })
  await page.locator('label:has-text("Реальное расстояние") + input').fill('2')
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect.poll(async () => (await image.boundingBox())!.width).not.toBeCloseTo(before.width, 0)
  await page.keyboard.press('Escape')
  await expect(photo.getByRole('button', { name: 'Калибровать', exact: true })).toHaveAttribute('aria-pressed', 'false')

  // Removed — and back with «Отменить». Edits less than 400 ms apart are
  // one undo step (the history's debounce); a person is slower than that.
  await page.waitForTimeout(500)
  await photo.getByRole('button', { name: 'Удалить фото' }).click()
  await expect(image).toHaveCount(0)
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Фото палубы удалено' }).getByRole('button', { name: 'Отменить' }).click()
  await expect(image).toHaveCount(1)
})

test('Сценарий 5: препятствия', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)

  // «Судно» → «Препятствия» → a rectangle named «Кран» (stage 3, spec 7.5).
  await openSection(page, 'Судно')
  await page.getByRole('group', { name: 'Нарисовать препятствие' }).getByRole('button', { name: 'Прямоугольник' }).click()
  const box = (await background(page).boundingBox())!
  await page.mouse.move(box.x + 40, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 10 })
  await page.mouse.up()
  const name = page.getByPlaceholder('Название зоны')
  const form = name.locator('xpath=ancestor::div[contains(@class, "absolute")][1]')
  await form.getByRole('button', { name: 'Кран' }).click()
  await form.getByRole('button', { name: 'Добавить' }).click()
  await expect(name).toBeHidden()

  // Listed with its name, which can be changed there, and its place.
  await expect(page.getByRole('list', { name: 'Препятствия на палубе' }).getByLabel('Название препятствия «Кран»')).toHaveValue('Кран')

  // Cargo doesn't go into it — saying why — and goes beside it. In manual
  // mode a pallet from the catalogue is armed for a click.
  await page.getByRole('radio', { name: 'Ручной' }).click()
  await chooseFromCatalog(page, 'Паллета EUR')
  // Over the zone the shadow is red and says why (spec 7.1); a click there
  // is refused with the same words.
  const zone = (await deck(page).locator('polygon[data-restriction-zone]').first().boundingBox())!
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2)
  await expect(deck(page).locator('[data-stamp-shadow="blocked"] [data-stamp-problem="Препятствие «Кран»"]')).toBeVisible()
  await page.mouse.click(zone.x + zone.width / 2, zone.y + zone.height / 2)
  await expect(page.getByText('Здесь нельзя — препятствие «Кран»')).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/0\/1 ед\./)
  const after = (await background(page).boundingBox())!
  await background(page).click({ position: { x: after.width - 60, y: after.height - 40 }, force: true })
  await expect(unitsCount(page)).toHaveText(/1\/1 ед\./)
})

test('Сценарий 6: зоны нагрузки', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

  // A zone over the whole deck at 0.05 t/m²: the demo's 16.6 t is twice that.
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Добавить зону' }).click()
  const field = (label: string) => page.locator(`label:has-text("${label}") + input`).first()
  await field('X').fill('0')
  await field('Y').fill('0')
  await field('Шир.').fill('8')
  await field('Длин.').fill('20')
  await field('Лимит, т/м²').fill('0.05')
  await field('Лимит, т/м²').blur()

  // The check fails, and the stacks on the zone are outlined red with «!».
  await expect(deck(page).locator('[data-load-zone="overloaded"]')).toBeVisible()
  await expect(deck(page).locator('[data-mark="overload"]').first()).toBeVisible()
  // Opened, the check names the zone and its load (spec 8.4).
  const zones = await openCheck(page, 'zones')
  await expect(zones).toHaveAttribute('data-check-status', 'error')
  await expect(zones.getByRole('list', { name: 'Зоны т/м²: подробности' })).toContainText(/Зона 1 \(вся палуба\): [\d.]+ из 0\.05 т\/м²/)
})

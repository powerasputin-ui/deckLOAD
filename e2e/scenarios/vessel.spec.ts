import { test, expect, type Page } from '@playwright/test'
import { chooseFromCatalog, clearCalculation, openCargoTable, openSection, setNumber, unitsCount } from '../helpers'

// Appendix C, scenarios 1–6, from the entry points of stage 2: what is on
// screen, never a right-click. Stages 3 and 4 rewrite them into their full
// versions (the table's last column).

const deck = (page: Page) => page.locator('svg[data-deck-plan]')
const background = (page: Page) => deck(page).locator('[data-deck-background="true"]').first()

// The deck's area, as «Проверки» states it: «Площадь палубы 160 м²».
async function deckArea(page: Page): Promise<string> {
  await openSection(page, 'Проверки')
  const label = page.getByText('Площадь палубы', { exact: true })
  await expect(label).toBeVisible()
  // The label's row, then the tile holding it and the figure.
  return label.locator('../..').innerText()
}

test('Сценарий 1: начать с реального судна', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await openSection(page, 'Судно')
  await page.getByText('Алексей Кузнецов (IMO 9692648)').click()

  // The vessel's deck, drawn with its size and its bow and stern named.
  await expect(deck(page).getByText('49.10 м')).toBeVisible()
  await expect(deck(page).getByText('16.90 м')).toBeVisible()
  await expect(deck(page).locator('[data-hull-side="bow"]')).toContainText('НОС')
  await expect(deck(page).locator('[data-hull-side="stern"]')).toHaveText('КОРМА')

  // Its sources disagree on the deck strength: a limit is picked, and the
  // check stops asking.
  await expect(page.getByText('Лимит прочности палубы не выбран')).toBeVisible()
  await page.getByRole('button', { name: '5 т/м²' }).click()
  await expect(page.getByText('Прочность палубы: 5 т/м²')).toBeVisible()
  await openSection(page, 'Проверки')
  await expect(page.getByText('лимит не выбран')).toHaveCount(0)
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

test('Сценарий 3: непрямоугольная палуба', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)
  const rectangle = await deckArea(page)

  // «Форма палубы»: a corner pulled in and saved makes the deck smaller.
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Форма палубы' }).click()
  await dragTopRightCornerIn(page)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const cut = await deckArea(page)
  expect(cut).not.toBe(rectangle)

  // «Отмена» throws an edit away.
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Форма палубы' }).click()
  await dragTopRightCornerIn(page)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await deckArea(page)).toBe(cut)
})

// A minimal valid 1×1 PNG.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('Сценарий 4: фото палубы и калибровка', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await clearCalculation(page)

  // «Фото палубы» over the deck: the photo is uploaded whole.
  await page.getByRole('button', { name: 'Фото палубы' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Загрузить фото' }).click()
  await (await chooser).setFiles({ name: 'deck.png', mimeType: 'image/png', buffer: TINY_PNG })
  const image = deck(page).locator('image')
  await expect(image).toHaveCount(1)

  // Calibrated by two points and the real distance between them.
  await page.getByRole('button', { name: 'Переместить / масштабировать' }).click()
  await page.keyboard.press('Escape')
  const before = (await image.boundingBox())!
  await page.getByRole('button', { name: 'Калибровать по известному расстоянию' }).click()
  await background(page).click({ position: { x: 100, y: 60 }, force: true })
  await background(page).click({ position: { x: 300, y: 60 }, force: true })
  await page.locator('label:has-text("Реальное расстояние") + input').fill('2')
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect.poll(async () => (await image.boundingBox())!.width).not.toBeCloseTo(before.width, 0)
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

  await expect(page.getByRole('list', { name: 'Препятствия на палубе' })).toContainText('Кран')

  // Cargo doesn't go into it — saying why — and goes beside it. In manual
  // mode a pallet from the catalogue is armed for a click.
  await page.getByRole('radio', { name: 'Ручной' }).click()
  await chooseFromCatalog(page, 'Паллета EUR')
  const zone = (await deck(page).locator('polygon[data-restriction-zone]').first().boundingBox())!
  await page.mouse.click(zone.x + zone.width / 2, zone.y + zone.height / 2)
  await expect(page.getByText('Здесь нельзя — зона ограничения «Кран»')).toBeVisible()
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
  await page.getByRole('button', { name: /^Зоны нагрузки/ }).click()
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
  await openSection(page, 'Проверки')
  await expect(page.locator('[data-check="zones"]')).toHaveAttribute('data-check-status', 'error')
})

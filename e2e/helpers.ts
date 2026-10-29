import { expect, type Locator, type Page } from '@playwright/test'

// Types a number into one of the calculator's numeric fields and commits it.
// These fields (src/components/calculator/NumberField.tsx) keep what you type
// as a draft and apply it on Enter/blur — never per keystroke, because the
// store reflows the placements already on the deck on every change — so a bare
// .fill() alone leaves the value uncommitted.
export async function setNumber(input: Locator, value: string) {
  await input.fill(value)
  await input.blur()
}

// The frame is up once its section bar is (spec 5.1) — wait for it before
// the first interaction, so typing can't land before React attaches.
export function sectionBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Разделы' })
}

// Opens a section in the left panel (spec 5.3).
export async function openSection(page: Page, title: 'Судно' | 'Грузы' | 'Размещение' | 'Проверки' | 'Отчёт') {
  await sectionBar(page).getByRole('button', { name: new RegExp(`^${title}`) }).click()
}

// «Подобрать варианты» in «Размещение» (spec 8.2): the best variant goes on
// the deck at once; the list of variants is returned.
export async function pickVariants(page: Page): Promise<Locator> {
  await openSection(page, 'Размещение')
  await page.getByRole('button', { name: 'Подобрать варианты' }).click()
  const variants = page.getByRole('list', { name: 'Варианты раскладки' }).getByRole('button')
  await expect(variants.first()).toHaveAttribute('aria-pressed', 'true')
  return variants
}

// A figure of the open trip's summary in «Размещение» (spec 8.2): the value
// next to its term, e.g. «Свободно» → «160 из 160 м²».
export async function tripSummaryValue(page: Page, term: string): Promise<Locator> {
  await openSection(page, 'Размещение')
  return page.getByTestId('trip-summary').getByText(term, { exact: true }).locator('xpath=following-sibling::dd')
}

// A check in «Проверки» (spec 8.4), opened: its row, with what it found and
// its settings.
export async function openCheck(page: Page, id: string): Promise<Locator> {
  await openSection(page, 'Проверки')
  const row = page.locator(`[data-check="${id}"]`)
  const button = row.locator('> button')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  return row
}

// A separation rule added in its check: two categories and the distance.
export async function addSeparationRule(page: Page, categoryA: string, categoryB: string, distance?: string) {
  const row = await openCheck(page, 'separation')
  const rule = row.getByRole('group', { name: 'Новое правило' })
  await rule.getByRole('combobox', { name: 'Категория A' }).click()
  await page.getByRole('option', { name: categoryA, exact: true }).click()
  await rule.getByRole('combobox', { name: 'Категория B' }).click()
  await page.getByRole('option', { name: categoryB, exact: true }).click()
  if (distance !== undefined) await setNumber(rule.getByLabel('Минимальное расстояние, м'), distance)
  await rule.getByRole('button', { name: 'Добавить правило' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Правило добавлено' })).toBeVisible()
}

// A library vessel picked in «Судно» (spec 8.1). With cargo in the
// calculation a dialog asks how: by default a new calculation for it, as
// the library always did before.
export async function chooseLibraryVessel(
  page: Page,
  label: string,
  how: 'Новый расчёт с этим судном' | 'Заменить палубу в текущем (груз останется)' = 'Новый расчёт с этим судном'
) {
  await openSection(page, 'Судно')
  await page.getByText(label, { exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  // Without cargo, nor anything tied to the old deck, there is no question.
  const asked = await dialog.waitFor({ state: 'visible', timeout: 2000 }).then(
    () => true,
    () => false
  )
  if (asked) await dialog.getByRole('button', { name: how }).click()
  await expect(dialog).toBeHidden()
}

// An item of the calculation's menu, top left (spec 5.2).
export async function projectMenuItem(page: Page, name: string) {
  await page.getByRole('button', { name: /^Меню расчёта/ }).click()
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
}

// The status line under the deck (spec 8.3): «50% · 16.6 т · 22/22 ед.».
export function statusLine(page: Page): Locator {
  return page.getByRole('status', { name: 'Итог расчёта' })
}

// Its «placed/total ед.» item alone.
export function unitsCount(page: Page): Locator {
  return page.locator('[data-status-item="units"]')
}

// «Очистить расчёт…» wipes the whole calculation (cargo, placements and the
// deck's own photo/outline/zones/…) with no way back, so it asks first —
// click through.
export async function clearCalculation(page: Page) {
  await projectMenuItem(page, 'Очистить расчёт…')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
}

// The right-click menu of a stack, the mini-panel over the selected stack and
// the inspector over the right of the deck (spec 6.5, 6.6).
export function stackMenu(page: Page): Locator {
  return page.getByRole('menu', { name: 'Действия со штабелем' })
}

export function stackTools(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Действия со штабелем' })
}

export function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Инспектор' })
}

// The stacks drawn selected (spec 6.3: a dark line and an accent band).
export function selectedStacks(page: Page): Locator {
  return page.locator('svg g[data-cargo-placement][data-selected]')
}

// The stack a rect of the deck drawing belongs to.
export function stackOf(rect: Locator): Locator {
  return rect.locator('xpath=ancestor::*[@data-cargo-placement][1]')
}

// «Грузы» (spec 7.1–7.4, stage 3). The compact list, the catalogue, the
// short form «Свой груз» and the cargo table.

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A cargo's row in the compact list.
export function cargoRow(page: Page, name: string): Locator {
  return page.getByTestId('cargo-list-row').filter({ has: page.getByTitle(name, { exact: true }) })
}

// «Свой груз»: the short form. Sides in the deck's unit, the weight in
// tonnes; what's left out keeps the form's own start.
export async function addOwnCargo(
  page: Page,
  cargo: { name?: string; length?: string; width?: string; height?: string; weightT?: string; quantity?: string; category?: string } = {}
) {
  await openSection(page, 'Грузы')
  const toggle = page.getByRole('button', { name: 'Свой груз', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const form = page.getByRole('form', { name: 'Свой груз' })
  const fields: [keyof typeof cargo, string][] = [
    ['name', 'Название'],
    ['length', 'Длина'],
    ['width', 'Ширина'],
    ['height', 'Высота'],
    ['weightT', 'Вес единицы, т'],
    ['quantity', 'Количество'],
    ['category', 'Категория'],
  ]
  for (const [key, label] of fields) {
    const value = cargo[key]
    if (value !== undefined) await form.getByLabel(label, { exact: true }).fill(value)
  }
  await form.getByRole('button', { name: 'Добавить груз' }).click()
  await expect(form).toBeHidden()
}

// «Каталог» → a template: the cargo joins the list, or one more of it does.
export async function chooseFromCatalog(page: Page, name: string, times = 1) {
  await openSection(page, 'Грузы')
  const toggle = page.getByRole('button', { name: 'Каталог', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const entry = page.getByRole('region', { name: 'Каталог грузов' }).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)},`) }).first()
  for (let i = 0; i < times; i++) await entry.click()
}

// «Поставить» on the cargo's row: armed for a click on the deck.
export async function armCargo(page: Page, name: string) {
  await openSection(page, 'Грузы')
  const place = page.getByRole('button', { name: `Поставить «${name}»`, exact: true })
  if ((await place.getAttribute('aria-pressed')) !== 'true') await place.click()
  await expect(page.getByTestId('stamp-hint')).toContainText(`«${name}»`)
}

// «Всего» of a cargo in the list: the number, typed over, Enter.
export async function setCargoTotal(page: Page, name: string, value: string) {
  await openSection(page, 'Грузы')
  const field = page.getByLabel(`Всего, ${name}`, { exact: true })
  await field.fill(value)
  await field.press('Enter')
}

// The cargo table across the bottom (spec 5.4), opened from «Грузы» if it
// isn't open, and folded away again.
export async function openCargoTable(page: Page): Promise<Locator> {
  const table = page.getByRole('table', { name: 'Таблица грузов' })
  if (!(await table.isVisible())) {
    await openSection(page, 'Грузы')
    await page.getByRole('button', { name: 'Таблица', exact: true }).click()
  }
  await expect(table).toBeVisible()
  return table
}

export async function closeCargoTable(page: Page) {
  const fold = page.getByRole('button', { name: 'Свернуть таблицу грузов' })
  if (await fold.isVisible()) await fold.click()
  await expect(page.getByRole('table', { name: 'Таблица грузов' })).toBeHidden()
}

// A cell of the cargo table — «Количество», «Длина», «Вес единицы, т»…
export async function cargoCell(page: Page, label: string, name: string): Promise<Locator> {
  return (await openCargoTable(page)).getByLabel(`${label}, ${name}`, { exact: true })
}

// «Дублировать» in the cargo table: «name (копия)» joins the list.
export async function duplicateCargo(page: Page, name: string) {
  const table = await openCargoTable(page)
  await table.getByRole('button', { name: `Дублировать: ${name}`, exact: true }).click()
  await expect(table.getByLabel(`Название, ${name} (копия)`, { exact: true })).toHaveCount(1)
}

// Several cells of one cargo, each committed.
export async function setCargoCells(page: Page, name: string, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) await setNumber(await cargoCell(page, label, name), value)
}

// A point of the deck drawing, relative to its background, as far as can be
// from every stack on it: where a stamp lands clear of the cargo the packer
// already put on the deck.
export async function clearDeckSpot(page: Page): Promise<{ x: number; y: number }> {
  const deck = await page.locator('svg [data-deck-background="true"]').first().boundingBox()
  if (!deck) throw new Error('deck background not found')
  const centers = await page.locator('svg g[data-cargo-placement="true"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  )
  let best = { x: deck.width / 2, y: deck.height / 2 }
  let bestDistance = -1
  for (const fx of [0.1, 0.3, 0.5, 0.7, 0.85]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      const x = deck.x + deck.width * fx
      const y = deck.y + deck.height * fy
      const distance = centers.length ? Math.min(...centers.map((c) => Math.hypot(c.x - x, c.y - y))) : 0
      if (distance > bestDistance) {
        bestDistance = distance
        best = { x: deck.width * fx, y: deck.height * fy }
      }
    }
  }
  return best
}

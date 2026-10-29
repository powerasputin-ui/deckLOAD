import { test, expect, type Page } from '@playwright/test'
import { inspector, openCheck, openSection, unitsCount } from './helpers'

// Appendix A of the redesign spec, «Где что было и где будет», for every
// stage up to 4: each setting and action is found at its new place by what
// it says. A row moved further on (the start screen, the report, the phone)
// waits for its stage.

const deck = (page: Page) => page.locator('svg[data-deck-plan]')
const section = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

async function demo(page: Page) {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
}

async function selectStack(page: Page, name: string) {
  await expect(async () => {
    await deck(page).locator(`g[data-cargo-name="${name}"]`).first().click({ force: true })
    await expect(inspector(page)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
}

test('A.1: the header, the calculation and its files', async ({ page }) => {
  await demo(page)
  // «?»: the tour, the shortcuts, the intro.
  await page.getByRole('button', { name: 'Справка' }).click()
  for (const item of ['Пройти тур', 'Горячие клавиши', 'Показать вступление']) await expect(page.getByRole('button', { name: item })).toBeVisible()
  await page.keyboard.press('Escape')
  // The calculation's menu.
  await page.getByRole('button', { name: /^Меню расчёта/ }).click()
  const menu = page.getByRole('dialog')
  for (const item of ['Новый расчёт', 'Дублировать', 'Переименовать…', 'Открыть файл…', 'Сохранить файл…', 'Открыть пример', 'Очистить расчёт…', 'Удалить расчёт…']) {
    await expect(menu.getByRole('button', { name: item, exact: true })).toBeVisible()
  }
  // With how many there are.
  await expect(menu.getByRole('button', { name: /^Все расчёты…/ })).toBeVisible()
  await page.keyboard.press('Escape')
  // The top bar.
  await expect(page.getByRole('button', { name: 'Скачать PDF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отменить (Ctrl+Z)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить (Ctrl+Y)' })).toBeVisible()
  for (const radio of ['Авто', 'Ручной', '2D', '3D']) await expect(page.getByRole('radio', { name: radio })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Свернуть панель' })).toBeVisible()
  // The vessel library is in «Судно».
  await openSection(page, 'Судно')
  await expect(page.getByRole('heading', { name: 'Судно из библиотеки' })).toBeVisible()
})

test('A.2: the deck — in «Судно», its gap and packing order in «Размещение»', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Судно')
  for (const label of ['Ширина (борт–борт)', 'Длина (нос–корма)', 'Отступ от борта', 'Предельная высота штабеля']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  }
  for (const unit of ['м', 'см', 'фт']) await expect(section(page, 'Палуба').getByRole('radio', { name: unit, exact: true })).toBeVisible()
  await openSection(page, 'Размещение')
  await expect(page.getByLabel('Отступ между грузами')).toBeVisible()
  await expect(page.getByLabel('Стратегия упаковки')).toBeVisible()
})

test('A.3: load zones in «Судно», with what they take', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Добавить зону' }).click()
  for (const label of ['Зона 1: X, м', 'Зона 1: Y, м', 'Зона 1: Шир., м', 'Зона 1: Длин., м', 'Зона 1: Лимит, т/м²']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  }
  await expect(section(page, 'Зоны нагрузки').getByText(/^Держит до /)).toBeVisible()
  await expect(section(page, 'Зоны нагрузки').getByText(/^Сейчас в зоне: /)).toBeVisible()
})

test('A.4: separation rules in their check', async ({ page }) => {
  await demo(page)
  const rule = (await openCheck(page, 'separation')).getByRole('group', { name: 'Новое правило' })
  for (const name of ['Категория A', 'Категория B']) await expect(rule.getByRole('combobox', { name })).toBeVisible()
  await expect(rule.getByLabel('Минимальное расстояние, м')).toBeVisible()
  await expect(rule.getByRole('button', { name: 'Добавить правило' })).toBeVisible()
})

test('A.5: lashing — in the inspector, the deck\'s own points in «Судно», the voyage in the check', async ({ page }) => {
  await demo(page)
  await selectStack(page, 'Контейнер 20ft')
  const lashing = inspector(page).getByTestId('inspector-lashing')
  await lashing.getByText('Крепление', { exact: true }).click()
  for (const name of ['Точки крепления', 'Зона отступа', 'Добавить точку крепления']) await expect(lashing.getByRole('button', { name })).toBeVisible()
  await expect(lashing.getByTestId('lashing-count')).toBeVisible()
  await lashing.getByRole('button', { name: 'Зона отступа' }).click()
  for (const side of ['Верх', 'Право', 'Низ', 'Лево']) await expect(lashing.getByLabel(`${side} (м)`)).toBeVisible()
  await page.keyboard.press('Escape')
  await openSection(page, 'Судно')
  await expect(section(page, 'Точки крепления на палубе').getByRole('button', { name: 'Поставить точку' })).toBeVisible()
  await expect((await openCheck(page, 'lashing')).getByLabel('Условия плавания')).toBeVisible()
})

test('A.6: the bow with the deck; the vessel\'s data in the stability workspace', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Судно')
  await expect(section(page, 'Палуба').getByText(/^Нос на схеме:/)).toBeVisible()
  await expect(section(page, 'Палуба').getByRole('button', { name: 'Сменить' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть остойчивость' }).click()
  await expect(page.getByTestId('stability-workspace')).toBeVisible()
})

test('A.7: rotation in «Размещение»; the view\'s settings in «Вид»; the example in the menu', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Размещение')
  await expect(page.getByRole('switch', { name: 'Разрешить поворот на 90°' })).toBeVisible()
  await page.getByRole('button', { name: 'Вид' }).click()
  for (const name of ['Сетка', 'Свободное место', 'Названия грузов', 'Содержимое при наведении']) await expect(page.getByRole('switch', { name })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Меню расчёта/ }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Открыть пример' })).toBeVisible()
})

test('A.8: variants and the trips in «Размещение», placing by hand from «Грузы», the shortcuts under «?»', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Размещение')
  await expect(page.getByRole('button', { name: 'Подобрать варианты' })).toBeVisible()
  // In manual mode the layout is the user's to clear (the demo is one trip:
  // nothing to confirm on the way).
  await page.getByRole('radio', { name: 'Ручной' }).click()
  await expect(page.getByRole('radio', { name: 'Ручной' })).toHaveAttribute('aria-checked', 'true')
  await openSection(page, 'Размещение')
  await expect(page.getByRole('button', { name: 'Очистить расстановку' })).toBeVisible()
  await openSection(page, 'Грузы')
  await expect(page.getByRole('button', { name: 'Поставить «Контейнер 20ft»' })).toBeVisible()
  await page.getByRole('button', { name: 'Справка' }).click()
  await page.getByRole('button', { name: 'Горячие клавиши' }).click()
  await expect(page.getByRole('dialog', { name: 'Горячие клавиши' })).toBeVisible()
})

test('A.9–A.10: cargo in «Грузы» — own, the table, the catalogue; obstacles, marks and sockets in «Судно»', async ({ page }) => {
  await demo(page)
  await openSection(page, 'Грузы')
  await expect(page.getByRole('button', { name: 'Свой груз' })).toBeVisible()
  await page.getByRole('button', { name: 'Таблица', exact: true }).click()
  for (const column of ['Название', 'Кол-во', 'Размещено', 'Поворот', 'Категория', 'Содержимое']) {
    await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Свернуть таблицу грузов' }).click()
  await page.getByRole('button', { name: 'Каталог', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Категории каталога' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Нарисовать форму' })).toBeVisible()
  await openSection(page, 'Судно')
  await expect(page.getByRole('group', { name: 'Нарисовать препятствие' })).toBeVisible()
  await expect(section(page, 'Метки')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Поставить розетку' })).toBeVisible()
})

test('A.11: the numbers — the status line, the trip\'s summary, the checks', async ({ page }) => {
  await demo(page)
  await expect(page.getByRole('status', { name: 'Итог расчёта' })).toBeVisible()
  await openSection(page, 'Размещение')
  for (const term of ['Загрузка площади', 'Занято', 'Свободно', 'Вес груза', 'Наибольшая высота штабеля']) {
    await expect(page.getByTestId('trip-summary').getByText(term, { exact: true })).toBeVisible()
  }
  await openSection(page, 'Проверки')
  await expect(page.getByRole('list', { name: 'Список проверок' }).locator('[data-check]')).toHaveCount(6)
})

test('A.12: the canvas — its tools, the photo in «Судно», the right-click, the stack\'s actions', async ({ page }) => {
  await demo(page)
  for (const name of ['Уменьшить', 'Увеличить', 'Вписать', 'Линейка']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вид' }).click()
  await expect(page.getByRole('button', { name: /Условные обозначения/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await openSection(page, 'Судно')
  await expect(section(page, 'Фото палубы').getByRole('button', { name: 'Загрузить фото' })).toBeVisible()
  await expect(section(page, 'Палуба').getByRole('button', { name: 'Форма палубы' })).toBeVisible()
  // The deck's right-click: its shape and a photo.
  const empty = deck(page).locator('[data-deck-background="true"]').first()
  const box = (await empty.boundingBox())!
  await empty.click({ button: 'right', position: { x: box.width - 20, y: box.height - 20 }, force: true })
  const menu = page.getByRole('menu', { name: 'Палуба' })
  for (const item of ['Редактировать', 'Загрузить фото']) await expect(menu.getByRole('button', { name: item })).toBeVisible()
  await page.keyboard.press('Escape')
  // A stack's actions: in its inspector and the mini-panel over it.
  await selectStack(page, 'Контейнер 20ft')
  for (const name of ['Повернуть', 'Закрепить', 'Добавить ярус', 'Убрать ярус']) await expect(inspector(page).getByRole('button', { name })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Действия со штабелем' })).toBeVisible()
})

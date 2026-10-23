import { test, expect, type Page } from '@playwright/test'
import { projectMenuItem, sectionBar, unitsCount } from '../helpers'

// Appendix C, scenarios 17–22, from the entry points of stage 2. Stage 5
// rewrites 19 and 22 for the report and the start screen.

const deck = (page: Page) => page.locator('svg[data-deck-plan]')

// The active calculation as saved, once the autosave has settled.
async function saved(page: Page) {
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('deckload-projects') ?? 'null')
    return data?.projects?.find((p: { id: string }) => p.id === data.activeId)
  })
}

test('Сценарий 17: 3D-вид', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

  // The scene is there, and clicks on it never pin a stack.
  await page.getByRole('radio', { name: '3D' }).click()
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.55], [0.6, 0.45], [0.5, 0.6]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  }
  expect((await saved(page)).pinnedPlacementsByTrip?.['0'] ?? []).toHaveLength(0)

  // «Скачать PDF» from 3D downloads the plan and comes back to 3D.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PDF' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
  await expect(page.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true')
  expect(errors).toEqual([])
})

test('Сценарий 18: проекты', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

  await projectMenuItem(page, 'Новый расчёт')
  await expect(page.getByText('Список грузов пуст')).toBeVisible()
  await projectMenuItem(page, 'Переименовать…')
  const name = page.getByRole('textbox', { name: 'Название расчёта' })
  await name.fill('Рейс на Сабетту')
  await name.press('Enter')
  await expect(page.getByRole('button', { name: 'Меню расчёта «Рейс на Сабетту»' })).toBeVisible()

  await projectMenuItem(page, 'Дублировать')
  await expect(page.getByRole('button', { name: 'Меню расчёта «Рейс на Сабетту (копия)»' })).toBeVisible()

  // «Все расчёты…» switches back to the demo.
  await projectMenuItem(page, 'Все расчёты…')
  await page.getByRole('dialog').getByText('Демо-расчёт', { exact: true }).click()
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)

  // Deleting asks first.
  await projectMenuItem(page, 'Удалить расчёт…')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Удалить «Демо-расчёт»?')
  await confirm.getByRole('button', { name: 'Удалить' }).click()
  await projectMenuItem(page, 'Все расчёты…')
  const list = page.getByRole('dialog')
  await expect(list.getByText('Демо-расчёт', { exact: true })).toHaveCount(0)
  await expect(list.getByRole('listitem')).toHaveCount(2)
})

test('Сценарий 19: PDF, сохранение и открытие файла', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

  const pdf = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PDF' }).click()
  expect((await pdf).suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)

  // «Сохранить файл…» gives the calculation as JSON…
  const json = page.waitForEvent('download')
  await projectMenuItem(page, 'Сохранить файл…')
  const file = await json
  expect(file.suggestedFilename()).toMatch(/^deckload-.*\.json$/)
  const content = await (await file.createReadStream()).toArray()
  const project = JSON.parse(Buffer.concat(content).toString('utf8'))

  // …and «Открыть файл…» opens it as a new calculation, the current one kept.
  const chooser = page.waitForEvent('filechooser')
  await projectMenuItem(page, 'Открыть файл…')
  await (await chooser).setFiles({
    name: 'plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...project, name: 'Открытый из файла' })),
  })
  await expect(page.getByRole('button', { name: 'Меню расчёта «Открытый из файла»' })).toBeVisible()
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  await projectMenuItem(page, 'Все расчёты…')
  await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(2)
})

test('Сценарий 20: отменить и повторить', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  const quantity = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Паллета EUR' }).first().locator('label:has-text("Кол-во") + input')
  await quantity.fill('14')
  await quantity.press('Enter')
  await expect(unitsCount(page)).toHaveText(/24\/24 ед\./)

  // Ctrl+Z off the field takes it back; «Повторить» does it again.
  await deck(page).locator('[data-deck-background="true"]').first().click({ position: { x: 5, y: 5 }, force: true })
  await page.keyboard.press('Control+z')
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  await page.getByRole('button', { name: 'Повторить (Ctrl+Y)' }).click()
  await expect(unitsCount(page)).toHaveText(/24\/24 ед\./)
})

test('Сценарий 21: настройки вида', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  const grid = deck(page).locator('rect[fill="url(#deck-grid)"]')
  const freeSpace = deck(page).locator('path[fill="url(#free-hatch)"]')
  const names = deck(page).locator('text', { hasText: /^Контейнер/ })

  await page.getByRole('button', { name: 'Вид' }).click()
  for (const name of ['Сетка', 'Названия грузов', 'Свободное место']) await page.getByRole('switch', { name }).click()
  await page.getByRole('radio', { name: 'Тёмная' }).click()
  await page.keyboard.press('Escape')
  await expect(grid).toHaveCount(0)
  await expect(freeSpace).toHaveCount(0)
  await expect(names).toHaveCount(0)
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)

  // Still so after a reload.
  await page.waitForTimeout(700)
  await page.reload()
  await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect(grid).toHaveCount(0)
  await expect(freeSpace).toHaveCount(0)
  await expect(names).toHaveCount(0)
})

test.describe('Сценарий 22: обучение', () => {
  // A first visit: nothing seen yet. Without motion, the intro's backdrop
  // draws one still frame (spec 9.6).
  test.use({ storageState: { cookies: [], origins: [] }, contextOptions: { reducedMotion: 'reduce' } })

  test('первый визит: вступление, тур из 5 шагов с «Назад» и Esc, «?» → «Пройти тур»', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await expect(async () => {
      if (await sectionBar(page).isVisible()) return
      const enter = page.getByRole('button', { name: 'Войти на сайт' })
      if (await enter.isVisible()) await enter.click({ force: true, timeout: 5000 })
      else await page.getByRole('button', { name: 'Пропустить', exact: true }).click({ force: true, timeout: 5000 })
    }).toPass({ timeout: 40_000 })

    // The tour starts by itself on the first visit.
    const step = page.getByRole('dialog').filter({ hasText: /Шаг \d из 5/ })
    await expect(step).toContainText('Шаг 1 из 5')
    await step.getByRole('button', { name: 'Далее' }).click()
    await expect(step).toContainText('Шаг 2 из 5')
    await step.getByRole('button', { name: 'Назад' }).click()
    await expect(step).toContainText('Шаг 1 из 5')
    await page.keyboard.press('Escape')
    await expect(step).toHaveCount(0)

    await page.getByRole('button', { name: 'Справка' }).click()
    await page.getByRole('button', { name: 'Пройти тур' }).click()
    await expect(step).toContainText('Шаг 1 из 5')
  })
})

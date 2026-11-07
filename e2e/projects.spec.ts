import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { projectMenuItem, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

// Everything done to calculations as a whole lives in the calculation's menu,
// top left (spec 5.2).
test.describe('Projects', () => {
  test('creating a new project switches to it', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Новый расчёт: Судно')
    await expect(page.getByText('Создан новый расчёт: Судно')).toBeVisible()
    // A new calculation opens at its first step, as from the start screen.
    await expect(page.getByRole('heading', { name: 'Судно из библиотеки' })).toBeVisible()
    await expect(headerBadge(page)).toHaveText('0/0 ед.')
  })

  // Spec 2026-11-06, 14: a new calculation is of a kind; a ППБУ's opens in
  // «ППБУ», with no vessel in its steps.
  test('a new ППБУ from the menu opens in «ППБУ» at its card', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Новый расчёт: ППБУ')
    await expect(page.getByText('Создан новый расчёт: ППБУ')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ППБУ', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Карточка ППБУ' }).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('heading', { name: 'ППБУ из библиотеки' })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Тип объекта' })).toHaveCount(0)
  })

  test('switching between projects updates cargo list', async ({ page }) => {
    await page.goto('/')
    // The store starts empty and only fills in once the demo project loads
    // (an async effect) — wait for that to settle instead of reading the
    // transient "0/0" from the very first paint.
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    const initial = await headerBadge(page).textContent()
    await projectMenuItem(page, 'Новый расчёт: Судно')
    await expect(headerBadge(page)).toHaveText('0/0 ед.')

    await projectMenuItem(page, 'Все расчёты…')
    await page.getByRole('dialog').getByText('Демо-расчёт', { exact: true }).click()
    await expect(headerBadge(page)).toHaveText(initial ?? '')
  })

  test('renaming a project updates its name', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Переименовать…')
    const input = page.getByRole('textbox', { name: 'Название расчёта' })
    await input.fill('Переименованный расчёт')
    await input.press('Enter')
    await expect(page.getByRole('button', { name: 'Меню расчёта «Переименованный расчёт»' })).toBeVisible()
  })

  test('duplicating a project adds a second, independent copy', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await projectMenuItem(page, 'Дублировать')
    await expect(page.getByText('Дублировано')).toBeVisible()
    // The duplicate is suffixed and becomes the open calculation.
    await expect(page.getByRole('button', { name: 'Меню расчёта «Демо-расчёт (копия)»' })).toBeVisible()
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
  })

  test('deleting a project removes it after confirming the alert dialog', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    // Duplicate first so there's a second, disposable project to delete —
    // deleting the only project isn't the scenario worth covering here.
    await projectMenuItem(page, 'Дублировать')
    await expect(page.getByText('Дублировано')).toBeVisible()

    await projectMenuItem(page, 'Удалить расчёт…')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Удалить «Демо-расчёт (копия)»?')
    await dialog.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByText('Удалено')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Меню расчёта «Демо-расчёт»' })).toBeVisible()
    await projectMenuItem(page, 'Все расчёты…')
    await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(1)
  })
})

// Spec 2026-11-06, 14: with a ППБУ in the library, a new ППБУ starts at it;
// taking it fills the card, the data and the deck, and opens the day's
// report — what changes every day.
test('a saved ППБУ: the next ППБУ calculation starts at the library, and taking it opens the day\'s report', async ({ page }) => {
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  await projectMenuItem(page, 'Новый расчёт: ППБУ')
  const block = (title: string) => page.getByRole('heading', { name: title, exact: true }).getByRole('button')
  await block('ППБУ из библиотеки').click()
  await page.getByRole('button', { name: 'Сохранить ППБУ в библиотеку' }).click()
  const dialog = page.getByRole('dialog', { name: 'Сохранить ППБУ в библиотеку' })
  await dialog.getByLabel('Название ППБУ').fill('Полярная звезда')
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('ППБУ «Полярная звезда» сохранена в библиотеку')).toBeVisible()

  await projectMenuItem(page, 'Новый расчёт: ППБУ')
  // Open, its saved ППБУ in sight (folded, its line would read «новая · в
  // библиотеке 1»).
  await expect(block('ППБУ из библиотеки')).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('list', { name: 'ППБУ из библиотеки' }).getByRole('button', { name: /^Полярная звезда/ }).click()
  await expect(block('ППБУ из библиотеки')).toContainText('«Полярная звезда»')
  await expect(block('Суточный отчёт')).toHaveAttribute('aria-expanded', 'true')
  await expect(block('Карточка ППБУ')).toHaveAttribute('aria-expanded', 'false')
})

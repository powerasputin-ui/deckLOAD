import { test, expect, type Page } from '@playwright/test'
import { projectMenuItem, sectionBar, unitsCount } from './helpers'

// The suite seeds both "seen" flags (playwright.config.ts) so ordinary specs
// open straight on the calculator. These cover the start screen itself
// (spec 10.1): the first visit, and a returning one.
const startScreen = (page: Page) => page.getByRole('dialog', { name: 'DeckLoad' })

async function skipTour(page: Page) {
  const skip = page.getByRole('button', { name: 'Пропустить тур' })
  await expect(skip).toBeVisible()
  await skip.click()
  await expect(skip).toBeHidden()
}

async function calculations(page: Page): Promise<string[]> {
  await projectMenuItem(page, 'Все расчёты…')
  const names = await page.getByRole('dialog').getByRole('listitem').allInnerTexts()
  await page.keyboard.press('Escape')
  return names
}

test.describe('First run', () => {
  test('a returning visitor goes straight to the calculator, without the start screen or the tour', async ({ page }) => {
    await page.goto('/')
    await expect(sectionBar(page)).toBeVisible()
    // Give a late render a chance before concluding there was none.
    await page.waitForTimeout(1000)
    await expect(startScreen(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Пропустить тур' })).toHaveCount(0)
  })

  test.describe('a first-time visitor', () => {
    // Reduced motion: the start screen's water draws one still frame (spec
    // 9.6) instead of starving a software-rendered page of frames.
    test.use({ storageState: { cookies: [], origins: [] }, contextOptions: { reducedMotion: 'reduce' } })

    test('sees the start screen; «Открыть пример» keeps the example, the tour follows, and neither comes back', async ({ page }) => {
      await page.goto('/')
      const screen = startScreen(page)
      await expect(screen).toBeVisible()
      await expect(screen.getByText('План палубы, вес и остойчивость за 5 минут')).toBeVisible()
      await expect(screen.getByRole('img', { name: 'Готовый план палубы примера' })).toBeVisible()
      // The keyboard: the main button has the focus, Tab goes on, Enter presses.
      await expect(screen.getByRole('button', { name: 'Начать с судна' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(screen.getByRole('button', { name: 'Открыть пример' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(screen).toHaveCount(0)
      await skipTour(page)
      await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
      // The example made for the first visit, not a second copy of it.
      expect(await calculations(page)).toHaveLength(1)

      await page.reload()
      await expect(sectionBar(page)).toBeVisible()
      await page.waitForTimeout(1000)
      await expect(startScreen(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Пропустить тур' })).toHaveCount(0)
      // Whoever has been through the new tour isn't told the interface changed.
      await expect(page.getByText('Интерфейс обновлён')).toHaveCount(0)
    })

    test('«Начать с судна» turns the example into an empty «Расчёт 1» and opens the vessel library', async ({ page }) => {
      await page.goto('/')
      await startScreen(page).getByRole('button', { name: 'Начать с судна' }).click()
      await skipTour(page)
      await expect(page.getByRole('button', { name: 'Меню расчёта «Расчёт 1»' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Судно из библиотеки' })).toBeVisible()
      await expect(unitsCount(page)).toHaveText('0/0 ед.')
      expect(await calculations(page)).toHaveLength(1)
      // Empty, and so it stays after a reload.
      await page.waitForTimeout(700)
      await page.reload()
      await expect(page.getByRole('button', { name: 'Меню расчёта «Расчёт 1»' })).toBeVisible()
      await expect(unitsCount(page)).toHaveText('0/0 ед.')
      await expect(startScreen(page)).toHaveCount(0)
    })

    test('Esc closes the start screen on the example', async ({ page }) => {
      await page.goto('/')
      await expect(startScreen(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(startScreen(page)).toHaveCount(0)
      await skipTour(page)
      await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
    })
  })

  test('«?» → «Показать стартовый экран»: its buttons make new calculations and leave the open one as it is', async ({ page }) => {
    await page.goto('/')
    await expect(unitsCount(page)).toHaveText(/22\/22 ед\./)
    await page.getByRole('button', { name: 'Справка' }).click()
    await page.getByRole('button', { name: 'Показать стартовый экран' }).click()
    await startScreen(page).getByRole('button', { name: 'Пустая палуба' }).click()
    await expect(startScreen(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Меню расчёта «Расчёт 2»' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Палуба' })).toBeVisible()
    expect(await calculations(page)).toHaveLength(2)
    // Esc leaves everything as it was.
    await page.getByRole('button', { name: 'Справка' }).click()
    await page.getByRole('button', { name: 'Показать стартовый экран' }).click()
    await page.keyboard.press('Escape')
    await expect(startScreen(page)).toHaveCount(0)
    expect(await calculations(page)).toHaveLength(2)
  })
})

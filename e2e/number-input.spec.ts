import { test, expect } from '@playwright/test'
import { addOwnCargo, clearCalculation, openSection, unitsCount } from './helpers'

// The numeric fields keep what you type as a draft and apply it on Enter/blur.
// They used to be controlled type="number" inputs that pushed every keystroke
// into the store while snapping anything unfinished to the minimum — so
// Backspace on "20" produced "0.1" and typing "24" produced "0.124", and each
// of those half-typed values reflowed the cargo already on the deck.

// The deck diagram labels its own size ("8 м" along the side). `pattern` is a
// regex source, since non-integers may be shown with trailing zeros ("7.50 м").
const deckLabel = (page: import('@playwright/test').Page, pattern: string) =>
  page.locator('svg text', { hasText: new RegExp(`^${pattern}$`) })

test.describe('Numeric fields', () => {
  test('typing a new deck width over the old one gives exactly what was typed', async ({ page }) => {
    await page.goto('/')
    await openSection(page, 'Судно')
    const width = page.getByLabel('Ширина')
    await expect(deckLabel(page, '8 м')).toBeVisible()

    await width.click()
    await width.press('Control+A')
    await width.pressSequentially('24')

    // Mid-edit: the field shows the draft, the deck is untouched.
    await expect(width).toHaveValue('24')
    await expect(deckLabel(page, '8 м')).toBeVisible()

    await width.press('Enter')
    await expect(deckLabel(page, '24 м')).toBeVisible()
    await expect(width).toHaveValue('24')
  })

  test('emptying a field with Backspace does not collapse it to the minimum', async ({ page }) => {
    await page.goto('/')
    await openSection(page, 'Судно')
    const width = page.getByLabel('Ширина')
    await expect(width).toHaveValue('8')

    await width.click()
    await width.press('End')
    await width.press('Backspace')
    await width.press('Backspace')
    await expect(width).toHaveValue('')
    await expect(deckLabel(page, '8 м')).toBeVisible() // not 0.1 м

    // Left empty and abandoned: the old value comes back.
    await width.blur()
    await expect(width).toHaveValue('8')
    await expect(deckLabel(page, '8 м')).toBeVisible()
  })

  test('a comma works as the decimal separator', async ({ page }) => {
    await page.goto('/')
    await openSection(page, 'Судно')
    const width = page.getByLabel('Ширина')
    await width.click()
    await width.press('Control+A')
    await width.pressSequentially('7,5')
    await width.blur()
    await expect(deckLabel(page, String.raw`7\.5\d* м`)).toBeVisible()
    await expect(width).toHaveValue('7.5')
  })

  test('Escape throws an unfinished edit away', async ({ page }) => {
    await page.goto('/')
    await openSection(page, 'Судно')
    const width = page.getByLabel('Ширина')
    await width.click()
    await width.press('Control+A')
    await width.pressSequentially('99')
    await width.press('Escape')
    await expect(width).toHaveValue('8')
    await expect(deckLabel(page, '8 м')).toBeVisible()
  })

  test('arrow keys step the value and apply it immediately', async ({ page }) => {
    await page.goto('/')
    await openSection(page, 'Судно')
    const width = page.getByLabel('Ширина')
    await width.click()
    await width.press('ArrowUp')
    await expect(width).toHaveValue('8.1')
    await expect(deckLabel(page, String.raw`8\.1\d* м`)).toBeVisible()
  })

  test('a cargo quantity typed digit by digit is applied once, when finished', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    await addOwnCargo(page)

    // «Всего» in the list: the click selects the number, typing replaces it.
    const quantity = page.getByLabel('Всего, Груз 1', { exact: true })
    await quantity.click()
    await quantity.pressSequentially('12')
    await expect(quantity).toHaveValue('12')
    await expect(unitsCount(page)).toHaveText(/\/1 ед\./) // still the old quantity mid-edit

    await quantity.press('Enter')
    await expect(unitsCount(page)).toHaveText(/\/12 ед\./)
  })
})

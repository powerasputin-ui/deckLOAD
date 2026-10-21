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

// "Очистить" wipes the whole calculation (cargo, placements and the deck's own
// photo/outline/zones/…) with no way back, so it asks first — click through.
export async function clearCalculation(page: Page) {
  await page.getByRole('button', { name: 'Очистить' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Очистить' }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
}

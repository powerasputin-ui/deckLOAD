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

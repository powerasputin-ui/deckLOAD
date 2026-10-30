import { test, expect, type Page } from '@playwright/test'
import { projectMenuItem, sectionBar } from './helpers'

// Revision 2026-10-30 (spec 8.1): «Судно» as steps to fill in, each block
// folded to its title and a line of what it holds — everything open at once
// lost new users. The section tab alone here, not the helper that opens
// every block.
const enterVessel = (page: Page) => sectionBar(page).getByRole('button', { name: /^Судно/ }).click()
const block = (page: Page, title: string) => page.getByRole('heading', { name: title, exact: true }).getByRole('button')

test('«Судно» folds its blocks to their lines, fits on the screen folded, and keeps a block opened when it comes back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await enterVessel(page)
  const titles = ['Судно из библиотеки', 'Палуба', 'Карточка судна', 'Зоны нагрузки', 'Остойчивость', 'Препятствия', 'Фото палубы', 'Розетки', 'Точки крепления на палубе', 'Метки']
  for (const title of titles) await expect(block(page, title)).toHaveAttribute('aria-expanded', 'false')
  await expect(block(page, 'Палуба')).toContainText('8 × 20 м · нос справа')
  // Every step at a glance: the folded section needs no scrolling.
  const content = page.locator('.section-content')
  expect(await content.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)

  await expect(page.getByLabel('Ширина (борт–борт)')).toHaveCount(0)
  await block(page, 'Палуба').click()
  await expect(page.getByLabel('Ширина (борт–борт)')).toBeVisible()
  await sectionBar(page).getByRole('button', { name: /^Грузы/ }).click()
  await enterVessel(page)
  await expect(block(page, 'Палуба')).toHaveAttribute('aria-expanded', 'true')
  await expect(block(page, 'Карточка судна')).toHaveAttribute('aria-expanded', 'false')
})

test('a new calculation opens on choosing the vessel, and a library vessel then on its deck strength', async ({ page }) => {
  await page.goto('/')
  await expect(sectionBar(page)).toBeVisible()
  await projectMenuItem(page, 'Новый расчёт')
  await enterVessel(page)
  await expect(block(page, 'Судно из библиотеки')).toHaveAttribute('aria-expanded', 'true')
  await page.getByText('Алексей Кузнецов (IMO 9692648)').click()
  // Nothing to keep on this deck: the vessel goes on at once, its block
  // folds to its name, and the card opens on the deck strength to choose.
  await expect(block(page, 'Судно из библиотеки')).toHaveAttribute('aria-expanded', 'false')
  await expect(block(page, 'Судно из библиотеки')).toContainText('Алексей Кузнецов (IMO 9692648)')
  await expect(block(page, 'Карточка судна')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('лимит не выбран', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '5 т/м²' }).click()
  await expect(page.getByRole('button', { name: '5 т/м²' })).toHaveAttribute('aria-pressed', 'true')
  await expect(block(page, 'Зоны нагрузки')).toContainText('1 зона')
})

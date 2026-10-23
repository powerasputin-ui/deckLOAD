import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openSection, unitsCount } from './helpers'

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
}

test.describe('Library vessel deck strength', () => {
  // Phase 0, L11: the two disputed limits used to be offered only in a toast
  // that vanished after 20 seconds, and nothing remembered the pick.
  test('asks for the deck-strength limit until one is picked, and remembers it after a reload', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await openSection(page, 'Судно')
    await page.getByText('Алексей Кузнецов (IMO 9692648)').click()

    // Waiting, opened, in «Зоны нагрузки» — and said in the stats («Проверки»).
    await expect(page.getByText('Лимит прочности палубы не выбран')).toBeVisible()
    await openSection(page, 'Проверки')
    await expect(page.getByText('лимит не выбран')).toBeVisible()
    await openSection(page, 'Судно')
    await page.getByRole('button', { name: '5 т/м²' }).click()
    await expect(page.getByText('Прочность палубы: 5 т/м²')).toBeVisible()
    await openSection(page, 'Проверки')
    await expect(page.getByText('лимит не выбран')).toHaveCount(0)

    // Let the debounced autosave land, then reload.
    await page.waitForTimeout(800)
    await page.reload()
    await openSection(page, 'Судно')
    await page.getByRole('button', { name: /^Зоны нагрузки/ }).click()
    await expect(page.getByText('Прочность палубы: 5 т/м²')).toBeVisible()
    await expect(page.getByRole('button', { name: '5 т/м²' })).toHaveAttribute('aria-pressed', 'true')
    await openSection(page, 'Проверки')
    await expect(page.getByText('лимит не выбран')).toHaveCount(0)
  })
})

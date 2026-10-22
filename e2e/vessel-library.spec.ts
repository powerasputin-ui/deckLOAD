import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

test.describe('Library vessel deck strength', () => {
  // Phase 0, L11: the two disputed limits used to be offered only in a toast
  // that vanished after 20 seconds, and nothing remembered the pick.
  test('asks for the deck-strength limit until one is picked, and remembers it after a reload', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)

    await page.getByRole('button', { name: /Библиотека судов/ }).click()
    await page.getByText('Алексей Кузнецов (IMO 9692648)').click()

    // Said in the stats and waiting, opened, in «Зоны нагрузки».
    await expect(page.getByText('лимит не выбран')).toBeVisible()
    await expect(page.getByText('Лимит прочности палубы не выбран')).toBeVisible()
    await page.getByRole('button', { name: '5 т/м²' }).click()
    await expect(page.getByText('Прочность палубы: 5 т/м²')).toBeVisible()
    await expect(page.getByText('лимит не выбран')).toHaveCount(0)

    // Let the debounced autosave land, then reload.
    await page.waitForTimeout(800)
    await page.reload()
    await page.getByRole('button', { name: /^Зоны нагрузки/ }).click()
    await expect(page.getByText('Прочность палубы: 5 т/м²')).toBeVisible()
    await expect(page.getByRole('button', { name: '5 т/м²' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('лимит не выбран')).toHaveCount(0)
  })
})

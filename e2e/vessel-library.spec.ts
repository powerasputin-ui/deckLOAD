import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseLibraryVessel, openSection, unitsCount } from './helpers'

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

    await chooseLibraryVessel(page, 'Алексей Кузнецов (IMO 9692648)')

    // Waiting in the vessel's card — and said by the zones check.
    await expect(page.getByText('лимит не выбран', { exact: true })).toBeVisible()
    await openSection(page, 'Проверки')
    const zones = page.locator('[data-check="zones"]')
    await expect(zones).toHaveAttribute('data-check-status', 'warn')
    await expect(zones).toContainText('Не выбран лимит прочности палубы')
    await openSection(page, 'Судно')
    await page.getByRole('button', { name: '5 т/м²' }).click()
    await expect(page.getByRole('button', { name: '5 т/м²' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('лимит не выбран', { exact: true })).toHaveCount(0)
    await openSection(page, 'Проверки')
    await expect(zones).toHaveAttribute('data-check-status', 'ok')

    // Let the debounced autosave land, then reload.
    await page.waitForTimeout(800)
    await page.reload()
    await openSection(page, 'Судно')
    await expect(page.getByRole('button', { name: '5 т/м²' })).toHaveAttribute('aria-pressed', 'true')
    await openSection(page, 'Проверки')
    await expect(zones).toHaveAttribute('data-check-status', 'ok')
  })
})

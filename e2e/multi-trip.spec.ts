import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

// Playwright's .fill() does not reliably commit on this project's shadcn
// number inputs (confirmed: value silently reverts, no console error) —
// select-all + type + blur does.
async function setNumberField(input: Locator, value: string) {
  await input.click()
  await input.press('Control+A')
  await input.pressSequentially(value)
  await input.blur()
}

test.describe('Multi-trip voyages', () => {
  test('cargo that overflows one deck spills into additional trip tabs', async ({ page }) => {
    await page.goto('/')
    // Wait for hydration before the first interaction — otherwise typing
    // right after goto() can land before React attaches its handlers.
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
    const palletCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Паллета EUR' }).first()
    await setNumberField(palletCard.locator('label:has-text("Кол-во") + input'), '400')

    await expect(page.getByRole('button', { name: /Рейс 1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Рейс 2/ })).toBeVisible()
  })

  test('pinning cargo on trip 2 does not affect trip 1', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
    const palletCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Паллета EUR' }).first()
    await setNumberField(palletCard.locator('label:has-text("Кол-во") + input'), '400')
    await expect(page.getByRole('button', { name: /Рейс 2/ })).toBeVisible()

    const trip1Button = page.getByRole('button', { name: /Рейс 1/ })
    const trip1Before = await trip1Button.textContent()

    await page.getByRole('button', { name: /Рейс 2/ }).click()
    const placedRect = page.locator('svg rect[fill="#10b981"]').first() // Паллета EUR's color
    await expect(async () => {
      // A plain click only selects (no pinning) since the interaction
      // redesign — right-click "Закрепить" is now the explicit pin action.
      await placedRect.click({ button: 'right', force: true })
      await page.getByRole('button', { name: 'Закрепить' }).click({ timeout: 1000 })
      await expect(page.getByText('Выбрано 1 груз')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })

    // Trip 1's own counts are unaffected by pinning something on trip 2.
    await expect(trip1Button).toHaveText(trip1Before ?? '')
  })
})

import { test, expect, type Page } from '@playwright/test'
import { sectionBar } from './helpers'

// Spec 10.2: five steps over the frame, «Назад» and «Далее» («Готово» on the
// last), «Пропустить тур», Esc closes; «?» → «Пройти тур» runs it again.
const STEPS = ['Судно', 'Грузы', 'Палуба', 'Итог и проверки', 'Скачать PDF']

function tourStep(page: Page) {
  return page.getByRole('dialog').filter({ hasText: /Шаг \d из 5/ })
}

async function startTourFromHelp(page: Page) {
  await page.getByRole('button', { name: 'Справка' }).click()
  await page.getByRole('button', { name: 'Пройти тур' }).click()
}

test.describe('Product tour', () => {
  test('walks five steps with «Назад», closes with Esc and starts again from «?»', async ({ page }) => {
    await page.goto('/')
    await expect(sectionBar(page)).toBeVisible()
    await expect(tourStep(page)).toHaveCount(0)

    await startTourFromHelp(page)
    for (const [i, title] of STEPS.entries()) {
      await expect(page.getByRole('dialog', { name: title })).toContainText(`Шаг ${i + 1} из 5`)
      // The step's own button has the focus: Enter goes on.
      await expect(tourStep(page).getByRole('button', { name: i === STEPS.length - 1 ? 'Готово' : 'Далее' })).toBeFocused()
      if (i < STEPS.length - 1) await page.keyboard.press('Enter')
    }

    await tourStep(page).getByRole('button', { name: 'Назад' }).click()
    await expect(page.getByRole('dialog', { name: 'Итог и проверки' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tourStep(page)).toHaveCount(0)

    // From «?» it starts over at the first step.
    await startTourFromHelp(page)
    await expect(page.getByRole('dialog', { name: 'Судно' })).toContainText('Шаг 1 из 5')
    await tourStep(page).getByRole('button', { name: 'Пропустить тур' }).click()
    await expect(tourStep(page)).toHaveCount(0)
  })

  test.describe('a visitor who knew the interface before', () => {
    // Seen the intro and the old tour, not the note about the new interface.
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        if (sessionStorage.getItem('note-reset')) return
        localStorage.removeItem('deckload-ui-update-hint-seen')
        sessionStorage.setItem('note-reset', '1')
      })
    })

    test('is told once that the interface changed, and can start the tour from the note', async ({ page }) => {
      await page.goto('/')
      const note = page.getByText('Интерфейс обновлён')
      await expect(note).toBeVisible()
      await expect(page.getByText('Где что теперь — в «?» → «Пройти тур».')).toBeVisible()
      // The tour itself doesn't start: this visitor has seen a tour before.
      await expect(tourStep(page)).toHaveCount(0)

      await page.getByRole('button', { name: 'Пройти тур' }).click()
      await expect(page.getByRole('dialog', { name: 'Судно' })).toBeVisible()
      await page.keyboard.press('Escape')

      await page.reload()
      await expect(sectionBar(page)).toBeVisible()
      await page.waitForTimeout(1000)
      await expect(note).toHaveCount(0)
    })
  })
})

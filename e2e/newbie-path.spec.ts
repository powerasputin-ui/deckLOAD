import { test, expect, type Locator } from '@playwright/test'
import { sheetCount, unitsCount } from './helpers'

// Spec 2.3, «путь новичка»: a newcomer makes a plan without instructions —
// the start screen → a vessel from the library → three cargo from the
// catalogue → placed by themselves → the PDF, in 15 actions at most. Each
// click the newcomer makes is counted.
test.use({ storageState: { cookies: [], origins: [] }, contextOptions: { reducedMotion: 'reduce' } })

test('путь новичка: от стартового экрана до PDF не больше чем за 15 действий', async ({ page }) => {
  let actions = 0
  const act = async (target: Locator) => {
    actions++
    await target.click()
  }

  await page.goto('/')
  await act(page.getByRole('dialog', { name: 'DeckLoad' }).getByRole('button', { name: 'Начать с судна' }))
  // The tour offers itself on the first visit; this newcomer skips it.
  await act(page.getByRole('button', { name: 'Пропустить тур' }))

  // A vessel from the library: with no cargo yet it applies at once.
  await act(page.getByText('Алексей Кузнецов (IMO 9692648)', { exact: true }))
  await expect(page.getByTestId('vessel-name')).toHaveText('Алексей Кузнецов (IMO 9692648)')

  // Three cargo from the catalogue: each stands on the deck at once.
  await act(page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: /^Грузы/ }))
  await act(page.getByRole('button', { name: 'Каталог', exact: true }))
  const catalogue = page.getByRole('region', { name: 'Каталог грузов' })
  for (const name of ['Контейнер 20ft', 'Паллета EUR', 'Ящик L']) {
    await act(catalogue.getByRole('button', { name: new RegExp(`^${name},`) }).first())
  }
  await expect(unitsCount(page)).toHaveText('3/3 ед.')

  // The PDF.
  const download = page.waitForEvent('download')
  await act(page.getByRole('button', { name: 'Скачать PDF' }).first())
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^deckload-.*\.pdf$/)
  expect(await sheetCount(file)).toBeGreaterThanOrEqual(2)

  expect(actions).toBeLessThanOrEqual(15)
})

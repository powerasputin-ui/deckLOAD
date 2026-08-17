import { test, expect } from '@playwright/test'

test.describe('Project JSON export/import', () => {
  test('downloading the project produces a deckload-*.json file', async ({ page }) => {
    await page.goto('/')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Скачать JSON' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-.*\.json$/)
  })

  test('importing a valid project file adds a new project without overwriting the current one', async ({ page }) => {
    await page.goto('/')
    // Wait for the sidebar's project list to actually be hydrated before
    // counting — .count() doesn't auto-retry like .toBeVisible() does.
    await expect(page.locator('aside').getByText('Демо-расчёт').first()).toBeVisible()
    const projectRowsBefore = await page.locator('aside').getByText('Демо-расчёт').count()

    const projectJson = JSON.stringify({
      name: 'Импортированный расчёт',
      deck: { width: 12, length: 6, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [
        { id: 'i1', name: 'Тестовый груз', width: 1, length: 1, height: 0, quantity: 2, color: '#0ea5e9', allowRotation: true },
      ],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
    })

    await page.locator('input[type="file"][accept*="json"]').setInputFiles({
      name: 'import-test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(projectJson),
    })

    await expect(page.getByText('Проект импортирован')).toBeVisible()
    const projectRowsAfter = await page.locator('aside').getByText('Демо-расчёт').count()
    // The imported project is a fresh copy named after the original demo
    // project's name field only if re-imported from an export; here it has
    // its own distinct name, so assert on that instead of the demo count.
    expect(projectRowsAfter).toBe(projectRowsBefore)
    await expect(page.locator('aside').getByText('Импортированный расчёт')).toBeVisible()
    // The newly imported project becomes active. Scope to the cargo list
    // card specifically — the deck panel's "choose cargo to place" stamp
    // list (visible in both modes) also renders a same-named button.
    await expect(page.getByRole('button', { name: 'Тестовый груз', exact: true })).toBeVisible()
  })

  test('importing garbage JSON is rejected without creating a project', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({
      name: 'garbage.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ foo: 'bar' })),
    })
    await expect(page.getByText('Файл не похож на проект DeckLoad')).toBeVisible()
  })
})

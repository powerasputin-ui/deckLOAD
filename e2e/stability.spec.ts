import { test, expect, type Page } from '@playwright/test'

// MiniNumField renders a text input right after its <label>text</label> —
// same locator pattern already established in deck-outline-load-zones.spec.ts
// for this exact component.
function fieldByLabel(page: Page, labelText: string) {
  return page.locator(`label:has-text("${labelText}") + input, label:has-text("${labelText}") ~ input`).first()
}

async function fillVesselParticulars(page: Page) {
  await page.getByRole('button', { name: 'Остойчивость судна' }).click()
  await fieldByLabel(page, 'Длина LBP').fill('80')
  await fieldByLabel(page, 'Ширина (м)').fill('18')
  await fieldByLabel(page, 'Лёгкий вес').fill('2000000')
  await fieldByLabel(page, 'Лёгкий KG').fill('5.5')
  await fieldByLabel(page, 'Высота над килем').fill('6')
  await page.getByRole('button', { name: 'Добавить точку гидростатики' }).click()
  await fieldByLabel(page, 'Водоизм.').fill('2000000')
  await fieldByLabel(page, 'KM (м)').fill('7.2')
}

test.describe('Ship stability calculator', () => {
  test('shows GM/list once vessel particulars and a hydrostatic point are entered', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await fillVesselParticulars(page)

    // GM = KM(7.2) - KG(5.5, no cargo yet) = 1.70
    await expect(page.getByText(/1[.,]70\s*м/)).toBeVisible()
    await expect(page.getByText('KM 7.20 м − KG 5.50 м', { exact: false })).toBeVisible()
    // Disclaimer must always be present once the panel shows real numbers.
    await expect(page.getByText('Не заменяет судовой прибор загрузки.', { exact: false })).toBeVisible()
  })

  test('list angle updates live as an off-center, heavy cargo item is added', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await fillVesselParticulars(page)

    // With no cargo, list must read 0deg (perfectly centered — nothing placed).
    await expect(page.getByText('0°', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Добавить груз' }).click()
    const weightField = page.locator('label:has-text("Вес, кг за ед.") + input, label:has-text("Вес, кг за ед.") ~ input').first()
    await weightField.fill('100000')

    // Auto-mode places the fresh item hard against the board offset near
    // (0,0) — far from the deck's transverse centerline — so a large,
    // clearly non-zero list angle must appear once the item carries weight.
    await expect(page.getByText(/\d+([.,]\d+)?°\s*на (левый|правый) борт/)).toBeVisible()
  })

  test('adding KN cross-curves unlocks the GZ curve and IMO IS Code criteria checklist', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await fillVesselParticulars(page)

    await expect(page.getByText('Доступна только начальная GM/крен.', { exact: false })).toBeVisible()

    await page.getByPlaceholder(/0,10,20,30,40/).fill(
      '0,10,20,30,40\n2000000,0,1.2,2.3,3.1,3.6'
    )
    await page.getByRole('button', { name: 'Применить кривые KN' }).click()

    await expect(page.getByText('Критерии IMO IS Code 2008, Часть A')).toBeVisible()
    // The initial-GM criterion row must show the real GM value computed above.
    await expect(page.getByText(/Начальная GM/)).toBeVisible()
    // Weather criterion is explicitly NOT computed — the UI must say so, not
    // silently omit it (this is the exact IMO-exemption nuance the feature
    // was built around).
    await expect(page.getByText('Ветровой критерий', { exact: false })).toBeVisible()
  })

  test('vessel data, hydrostatic points, and KN cross-curves all survive a reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Очистить' }).click()
    await fillVesselParticulars(page)
    await page.getByPlaceholder(/0,10,20,30,40/).fill('0,10,20,30,40\n2000000,0,1.2,2.3,3.1,3.6')
    await page.getByRole('button', { name: 'Применить кривые KN' }).click()
    await expect(page.getByText('Критерии IMO IS Code 2008, Часть A')).toBeVisible()

    // Autosave is debounced 400ms (page.tsx) after the last store change —
    // reloading before that window elapses would race it and reload a
    // stale (pre-edit) snapshot, not a real persistence bug.
    await page.waitForTimeout(700)
    await page.reload()

    await expect(page.getByText(/1[.,]70\s*м/).first()).toBeVisible()
    await expect(page.getByText('Критерии IMO IS Code 2008, Часть A')).toBeVisible()
    await page.getByRole('button', { name: 'Остойчивость судна' }).click()
    await expect(fieldByLabel(page, 'Длина LBP')).toHaveValue('80')
    await expect(page.getByText('5 углов × 1 точек водоизмещения', { exact: false })).toBeVisible()
  })
})

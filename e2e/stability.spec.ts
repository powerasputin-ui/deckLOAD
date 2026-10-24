import { test, expect, type Locator, type Page } from '@playwright/test'
import { clearCalculation, openSection, setNumber } from './helpers'

// The stability workspace (spec 2026-10-24, 6.1): opened from «Судно» in the
// deck's place, the vessel's data on the left, the open trip's result on the
// right.

async function openWorkspace(page: Page): Promise<Locator> {
  await openSection(page, 'Судно')
  await page.getByRole('button', { name: 'Открыть остойчивость' }).click()
  return page.getByTestId('stability-workspace')
}

// A group of the vessel's data: its <details>, by the title in its summary.
function group(ws: Locator, title: string): Locator {
  return ws.locator('details').filter({ has: ws.page().locator('summary span', { hasText: new RegExp(`^${title}$`) }) })
}

// 2000 t empty at KG 5.5, KM 7.2 at that displacement: GM 1.70 m.
async function fillVessel(page: Page): Promise<Locator> {
  const ws = await openWorkspace(page)
  await setNumber(ws.getByLabel('Длина LBP, м', { exact: true }), '80')
  await setNumber(ws.getByLabel('Ширина, м', { exact: true }), '18')
  await setNumber(ws.getByLabel('Вес, т', { exact: true }), '2000')
  await setNumber(ws.getByLabel('KG, м', { exact: true }), '5.5')
  await setNumber(ws.getByLabel('Высота палубы над килем, м', { exact: true }), '6')
  const hydro = group(ws, 'Гидростатика')
  await hydro.getByRole('button', { name: 'Добавить строку' }).click()
  await setNumber(hydro.getByLabel('Водоизм., новая строка'), '2000')
  await setNumber(hydro.getByLabel('Осадка, новая строка'), '3')
  await setNumber(hydro.getByLabel('KM, новая строка'), '7.2')
  await hydro.getByRole('button', { name: 'Сохранить новую строку' }).click()
  return ws
}

async function pasteKn(ws: Locator) {
  const kn = group(ws, 'KN-кривые')
  await kn.getByRole('button', { name: 'Вставить текстом' }).click()
  await kn.getByLabel('KN-кривые: текст для вставки').fill('Δ, т\t0\t10\t20\t30\t40\n2000\t0\t1,2\t2,3\t3,1\t3,6')
  await kn.getByRole('button', { name: 'Вставить', exact: true }).click()
}

test.describe('Ship stability workspace', () => {
  test('shows GM once the vessel and a hydrostatic row are entered, and goes back to the deck', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    const ws = await fillVessel(page)

    // No tanks: GM_fluid = KM − KG = 1.70 m, no free-surface correction.
    await expect(ws.getByTestId('stability-gm')).toHaveText('1.70 м')
    await expect(ws.getByText('KM 7.20 − KG 5.50 − поправка 0.00', { exact: false })).toBeVisible()
    // Without the booklet's limit the verdict stops at ⚠, and says why.
    await expect(ws.getByTestId('stability-state')).toHaveAttribute('data-verdict', 'warn')
    await expect(ws.getByText('Предел по формуляру не задан', { exact: true })).toBeVisible()
    await expect(ws.getByText('Оценка по введённым данным. Не заменяет одобренную Информацию об остойчивости и прибор загрузки судна.')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(ws).toBeHidden()
    await expect(page.locator('svg[data-deck-plan]')).toBeVisible()
  })

  test('the list follows heavy cargo put off the centreline, live', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    const ws = await fillVessel(page)
    await expect(ws.getByText('0°', { exact: true })).toBeVisible()

    // The workspace stays open while the cargo is edited in the left panel.
    await openSection(page, 'Грузы')
    await page.getByRole('button', { name: 'Добавить груз' }).click()
    const weightField = page.locator('label:has-text("Вес ед., кг") + input, label:has-text("Вес ед., кг") ~ input').first()
    await setNumber(weightField, '100000')

    // Auto mode puts the new cargo against the board offset near (0, 0) —
    // far off the centreline — so the ship lists.
    await expect(ws.getByText(/\d+([.,]\d+)?°\s*на (левый|правый) борт/)).toBeVisible()
  })

  test('KN curves pasted with their line of angles give the GZ reference, marked as an estimate', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    const ws = await fillVessel(page)
    await expect(ws.getByText('Кривых KN нет — справка по кривой GZ недоступна.')).toBeVisible()

    await pasteKn(ws)
    await expect(ws.getByText('Кривая GZ, м, по углу крена, °')).toBeVisible()
    const criteria = ws.getByRole('table', { name: 'Критерии справки по KN' })
    await expect(criteria.getByText(/Начальная GM/)).toBeVisible()
    await expect(ws.getByText('На итог проверки не влияет: итог даёт предел по формуляру.')).toBeVisible()
    // What isn't checked is said, the weather criterion first.
    await expect(ws.getByText(/^критерий погоды/)).toBeVisible()
  })

  test('the vessel\'s data and its KN curves survive a reload', async ({ page }) => {
    await page.goto('/')
    await clearCalculation(page)
    const ws = await fillVessel(page)
    await pasteKn(ws)
    await expect(ws.getByText('Кривая GZ, м, по углу крена, °')).toBeVisible()

    // Autosave is debounced 400 ms (page.tsx) after the last store change.
    await page.waitForTimeout(700)
    await page.reload()

    const again = await openWorkspace(page)
    await expect(again.getByTestId('stability-gm')).toHaveText('1.70 м')
    await expect(again.getByLabel('Длина LBP, м', { exact: true })).toHaveValue('80')
    await expect(group(again, 'KN-кривые').locator('summary')).toContainText('5 углов × 1 строка')
  })
})

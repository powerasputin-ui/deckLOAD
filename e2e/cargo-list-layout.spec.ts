import { test, expect } from '@playwright/test'
import { openSection, unitsCount } from './helpers'

// Phase 0, C1: at 1280–1440 px the fields of a cargo card were too narrow
// for «6,06» or «2200». Stage 3 put the editing in the cargo table (its
// columns are checked in scenario 8); the compact list left in «Грузы» must
// still fit the panel — name, «размещено из всего», weight, «Поставить».
for (const width of [1280, 1440]) {
  test(`cargo list rows fit inside the panel at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(unitsCount(page)).toHaveText(/\/22 ед\./)

    const list = page.getByRole('list', { name: 'Список грузов' })
    await expect(page.getByTestId('cargo-list-row')).toHaveCount(3)
    const problems = await list.evaluate((listEl) => {
      const box = listEl.getBoundingClientRect()
      const out: string[] = []
      for (const row of listEl.querySelectorAll<HTMLElement>('[data-testid="cargo-list-row"]')) {
        const r = row.getBoundingClientRect()
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push(`row «${row.textContent}» sticks out of the list`)
        for (const el of row.querySelectorAll<HTMLElement>('input, button')) {
          const b = el.getBoundingClientRect()
          if (b.left < r.left - 0.5 || b.right > r.right + 0.5) out.push(`«${el.getAttribute('aria-label') ?? el.textContent}» sticks out of its row`)
        }
        for (const input of row.querySelectorAll<HTMLInputElement>('input')) {
          if (input.scrollWidth > input.clientWidth) out.push(`«${input.value}» doesn't fit in its field`)
        }
        for (const button of row.querySelectorAll<HTMLElement>('button')) {
          if (button.scrollWidth > button.clientWidth + 0.5) out.push(`«${button.textContent}» is cut off`)
        }
      }
      return out
    })
    expect(problems).toEqual([])
  })
}

// Revision 2026-11-05: whatever each row's button says, the buttons stand in
// one column and the weights end on one edge — one button narrower than the
// next had shifted both.
test('the rows line up: buttons in one column, weights on one edge, whatever each button says', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(unitsCount(page)).toHaveText(/\/22 ед\./)
  // Manual mode takes the demo's layout: all of it on the deck, every row
  // «Убрать». One row taken off and armed makes three states.
  await page.getByRole('radio', { name: 'Ручной' }).click()
  await openSection(page, 'Грузы')
  await page.getByRole('button', { name: 'Убрать «Контейнер 20ft» с палубы', exact: true }).click()
  await page.getByRole('button', { name: 'Поставить «Контейнер 20ft»', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Поставить «Контейнер 20ft»', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const edges = await page.getByRole('list', { name: 'Список грузов' }).evaluate((listEl) =>
    [...listEl.querySelectorAll<HTMLElement>('[data-testid="cargo-list-row"]')].map((row) => {
      const button = row.querySelector('button')!.getBoundingClientRect()
      const weight = row.querySelector('[data-testid="cargo-list-weight"]')!.getBoundingClientRect()
      return { label: row.querySelector('button')!.textContent, left: Math.round(button.left), right: Math.round(button.right), weight: Math.round(weight.right) }
    })
  )
  expect(new Set(edges.map((e) => e.label)).size).toBeGreaterThan(1)
  expect(new Set(edges.map((e) => e.left)).size, JSON.stringify(edges)).toBe(1)
  expect(new Set(edges.map((e) => e.right)).size, JSON.stringify(edges)).toBe(1)
  expect(new Set(edges.map((e) => e.weight)).size, JSON.stringify(edges)).toBe(1)
})

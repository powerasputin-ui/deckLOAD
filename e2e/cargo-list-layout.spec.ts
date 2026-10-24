import { test, expect } from '@playwright/test'
import { unitsCount } from './helpers'

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
        const place = row.querySelector<HTMLElement>('button[aria-pressed]')
        if (place && place.scrollWidth > place.clientWidth + 0.5) out.push(`«${place.textContent}» is cut off`)
      }
      return out
    })
    expect(problems).toEqual([])
  })
}

import { test, expect, type Locator, type Page } from '@playwright/test'

// Spec 6.8: a dragged stack locks flush against a neighbour or the deck edge
// only within a few pixels on screen, and Alt held during the drag turns that
// off. The magnet used to reach a grid step — 1 m on the demo deck, 5 m on a
// 50 m one — so a stack let go half a metre from the edge jumped to it.

// The demo deck is 20 m along, drawn across the screen, with a 0.2 m board
// offset: where the last stack may stand, on screen. Read afresh each time —
// the view slides when the inspector opens.
async function usableRightEdge(page: Page): Promise<number> {
  const deck = (await page.locator('svg[data-deck-plan] [data-deck-background="true"]').first().boundingBox())!
  return deck.x + deck.width - (0.2 * deck.width) / 20
}

// Drags the stack straight right and lets go with its right side at `x`.
async function letGoAt(page: Page, stack: Locator, x: number, alt = false) {
  const r = (await stack.boundingBox())!
  const from = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  const dx = x - (r.x + r.width)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 6 })
  await page.mouse.move(from.x + dx, from.y, { steps: 6 })
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
}

test('a stack let go near the deck edge stays where it was let go, locks on only within a few pixels, and not at all with Alt', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Ручной').first().click()
  await expect(page.getByRole('radio', { name: 'Ручной' })).toHaveAttribute('aria-checked', 'true')
  // A pallet at the end of the cargo, with open deck to its right.
  const pallet = page.locator('svg g[data-cargo-placement][data-cargo-name="Паллета EUR"] rect').last()
  await expect(pallet).toBeVisible()
  const gapToEdge = async () => {
    const r = (await pallet.boundingBox())!
    // The rect's own 1 px stroke reaches half a pixel past its edge.
    return (await usableRightEdge(page)) - (r.x + r.width - 0.5)
  }
  const letGoShort = async (px: number, alt = false) => letGoAt(page, pallet, (await usableRightEdge(page)) - px, alt)

  // About half a metre short of the edge: it stays there.
  await letGoShort(25)
  await expect.poll(gapToEdge).toBeGreaterThan(22)
  expect(await gapToEdge()).toBeLessThan(28)

  // Within a few pixels: it locks flush against the edge.
  await letGoShort(30)
  await letGoShort(4)
  await expect.poll(gapToEdge).toBeLessThan(1.5)

  // The same with Alt held: it stays where it was let go.
  await letGoShort(30)
  await expect.poll(gapToEdge).toBeGreaterThan(27)
  await letGoShort(4, true)
  await expect.poll(gapToEdge).toBeGreaterThan(2.5)
  expect(await gapToEdge()).toBeLessThan(5.5)
})

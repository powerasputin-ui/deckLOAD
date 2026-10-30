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
  // The plan itself never moves: the inspector opens on the left for a stack
  // on the right instead of sliding the plan from under it.
  const deckLeft = async () => (await page.locator('svg[data-deck-plan] [data-deck-background="true"]').first().boundingBox())!.x
  const planAt = await deckLeft()

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

  await expect(page.getByRole('complementary', { name: 'Инспектор' })).toBeVisible()
  expect(Math.abs((await deckLeft()) - planAt)).toBeLessThan(0.5)
  const panel = (await page.getByRole('complementary', { name: 'Инспектор' }).boundingBox())!
  expect(panel.x + panel.width).toBeLessThan((await pallet.boundingBox())!.x)
})

// The user's case: a pallet pushed into the corner of a container and the
// pallet beside it shook — it jumped back and forth every frame and never
// settled there. Here a pallet is taken out of the column beside the last
// container and pushed back past the corner of the container and the pallet
// above it, the pointer wobbling at the end: it lands in that corner, the
// deck's 0.1 m spacing from each.
test('a pallet pushed into the corner of a container and a pallet settles flush in it', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Ручной').first().click()
  await expect(page.getByRole('radio', { name: 'Ручной' })).toHaveAttribute('aria-checked', 'true')
  const deck = (await page.locator('svg[data-deck-plan] [data-deck-background="true"]').first().boundingBox())!
  const pxPerM = deck.width / 20
  const boxesOf = async (name: string) => {
    const groups = page.locator(`svg g[data-cargo-placement][data-cargo-name="${name}"]`)
    const out: { key: string; box: { x: number; y: number; width: number; height: number } }[] = []
    for (let i = 0; i < (await groups.count()); i++) {
      const g = groups.nth(i)
      out.push({ key: (await g.getAttribute('data-stack-key'))!, box: (await g.locator(':scope > rect').boundingBox())! })
    }
    return out
  }
  const containers = await boxesOf('Контейнер 20ft')
  const lastContainer = containers.reduce((a, b) => (b.box.x > a.box.x ? b : a))
  const containerRight = lastContainer.box.x + lastContainer.box.width
  // The column of pallets right beside it, top to bottom.
  const column = (await boxesOf('Паллета EUR'))
    .filter((p) => p.box.x > containerRight && p.box.x - containerRight < 0.5 * pxPerM)
    .sort((a, b) => a.box.y - b.box.y)
  expect(column.length).toBeGreaterThanOrEqual(3)
  const moved = column[1]
  const home = moved.box
  // The stack's own rect, not the selection halo drawn round it.
  const rectOf = () => page.locator(`svg g[data-stack-key="${moved.key}"] > rect`)
  const drag = async (dx: number, dy: number, wobble = false) => {
    const r = (await rectOf().boundingBox())!
    const from = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 16 })
    if (wobble) for (const [wx, wy] of [[2, -1], [-2, 1], [1, 2], [-1, -2]]) await page.mouse.move(from.x + dx + wx, from.y + dy + wy)
    await page.mouse.up()
  }

  // Out to the open deck on the right…
  await drag(deck.x + deck.width - 3 * pxPerM - home.x, 0)
  await expect.poll(async () => (await rectOf().boundingBox())!.x).toBeGreaterThan(home.x + 2 * pxPerM)
  // …and back, aimed 0.4 m past its old place into the container and the
  // pallet above it.
  const now = (await rectOf().boundingBox())!
  await drag(home.x - now.x - 0.4 * pxPerM, home.y - now.y - 0.4 * pxPerM, true)
  // The neighbours' 1 px strokes reach half a pixel past their edges, the
  // selected pallet's 2 px one a whole pixel.
  const spacing = 0.1 * pxPerM - 1.5
  const above = column[0].box
  await expect.poll(async () => Math.abs((await rectOf().boundingBox())!.x - containerRight - spacing)).toBeLessThan(1)
  expect(Math.abs((await rectOf().boundingBox())!.y - (above.y + above.height) - spacing)).toBeLessThan(1)
})

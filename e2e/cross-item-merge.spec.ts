import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { clearCalculation, setNumber } from './helpers'

function headerBadge(page: Page) {
  return page.locator('main').locator('text=/\\d+\\/\\d+ ед\\. · Загрузка: \\d+%/').first()
}

// A pipe stamped onto the deck stands where the user put it (locked), so
// «Автораспределение» leaves it alone — hand it back to the packer first so
// all of the item's units can be stacked together.
async function returnStampedPipeToAuto(page: Page) {
  const pipe = page.locator('svg g[data-cargo-placement="true"]:has(rect[fill="#57534e"])').first()
  const itemMenu = page.locator('div.fixed.z-50.w-40')
  await expect(async () => {
    await pipe.click({ button: 'right', force: true })
    await expect(itemMenu.getByRole('button', { name: 'Вернуть в авто' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10000 })
  await itemMenu.getByRole('button', { name: 'Вернуть в авто' }).click()
  await expect(page.locator('svg text:text-is("🔒")')).toHaveCount(0)
}

test.describe('Merging two different (e.g. duplicated) cargo items', () => {
  test('dragging a duplicated pipe stack onto its original merges layers and removes the now-empty duplicate item', async ({ page }) => {
    await page.goto('/')
    // Wait for the demo project's async hydration to settle before touching
    // anything — clicking "Очистить" too early raced with it in earlier
    // runs of this test and left a stray leftover placement behind.
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await clearCalculation(page)

    // Generous clearance so 16 layers of a 0.25m-tall pipe (4m) fit well
    // under the physical height cap — this test is about the merge
    // mechanism itself, not the height-cap rejection path.
    const clearanceInput = page.locator('label', { hasText: 'Предельная высота штабеля' }).locator('..').locator('input')
    await clearanceInput.fill('10')
    await clearanceInput.blur()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Смешанный' }).click()
    await page.getByText('Обсадная труба', { exact: true }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 60, y: 60 }, force: true })

    // Original item now placed (1 unit, locked where the click put it). Hand
    // it back to the packer, bump its quantity to 8 and let
    // "Автораспределение" consolidate all 8 into one clean pyramid before
    // duplicating — otherwise the two stacks being merged wouldn't each
    // cleanly hold 8, making the expected "16" unpredictable.
    await returnStampedPipeToAuto(page)
    const originalCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба' }).first()
    await setNumber(originalCard.locator('label:has-text("Кол-во") + input'), '8')
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    // A stacked pipe pyramid now draws as several <rect> capsule segments
    // sharing the same fill (see DeckVisualization's per-row pipe render) —
    // count placements via the g[data-cargo-placement] wrapper, not raw
    // rects, so one 8-pipe pyramid isn't miscounted as several placements.
    const pipePlacements = page.locator('svg g[data-cargo-placement="true"]:has(rect[fill="#57534e"])')
    await expect(pipePlacements).toHaveCount(1)

    // Duplicate it — the copy starts with the same quantity (8) and,
    // being in auto mode, places itself on the deck automatically.
    await originalCard.getByTitle('Дублировать').click()
    await expect(page.getByText('Груз дублирован')).toBeVisible()
    await expect(page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба' })).toHaveCount(2)

    // The preset stamp stays armed after placement — disarm it so subsequent
    // pointer-downs on the deck are interpreted as pin-drags, not new
    // placements (confirmed via a temporary debug run: without this, the
    // second pointer-down created a THIRD placement instead of dragging).
    await page.keyboard.press('Escape')

    const pipeRects = pipePlacements
    await expect(pipeRects).toHaveCount(2)
    await pipeRects.nth(0).scrollIntoViewIfNeeded()

    // Auto mode: a plain click only selects — dragging is what promotes an
    // algorithmically-placed item to a real (locked) pin, and only pins
    // are eligible merge targets/sources. Nudge each stack a bit first so
    // both become pins, before the real merge drag. (40/20px, matching the
    // magnitude already proven reliable in pin-select.spec.ts's own
    // "dragging an unpinned item" test — smaller nudges were flaky here.)
    // Bounding boxes are re-read fresh on EACH iteration (not captured once
    // before the loop) — confirmed via debugging that reusing a stale box
    // for the second nudge missed the rect entirely after the first nudge
    // moved it, silently turning that "nudge" into a no-op.
    for (let i = 0; i < 2; i++) {
      const box = await pipeRects.nth(i).boundingBox()
      if (!box) throw new Error(`pipe rect ${i} not found before nudge`)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 })
      await page.mouse.up()
    }

    // Re-read positions after the nudge (they moved) and drag A fully onto
    // B to trigger the merge.
    const rectA = pipeRects.nth(0)
    const rectB = pipeRects.nth(1)
    const freshA = await rectA.boundingBox()
    const freshB = await rectB.boundingBox()
    if (!freshA || !freshB) throw new Error('pipe rects not found after nudge')

    await page.mouse.move(freshA.x + freshA.width / 2, freshA.y + freshA.height / 2)
    await page.mouse.down()
    await page.mouse.move(freshB.x + freshB.width / 2, freshB.y + freshB.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect(page.getByText(/Объединено: 16 яр\./)).toBeVisible()
    // The duplicate's quantity was fully folded into the target — only one
    // "Обсадная труба" card should remain in "Грузы".
    await expect(page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба' })).toHaveCount(1)
    await expect(pipeRects).toHaveCount(1)
    await expect(page.getByText(/Всего: 16/)).toBeVisible()
  })

  test('dragging a duplicated BOX (non-pipe) onto its original does not merge — cross-item merge is pipe-only', async ({ page }) => {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await clearCalculation(page)

    // Manual mode: unlike auto mode, a manual placement never gets silently
    // reflowed/rotated by the packing algorithm when a SIBLING placement is
    // dragged — confirmed necessary via debugging: in auto mode, nudging the
    // original caused the still-un-pinned duplicate to auto-repack into a
    // ROTATED orientation, so the two boxes' final rects only partially
    // overlapped and never crossed the 65% merge-latch threshold at all —
    // a test-environment artifact, not the pipe-only behavior under test.
    await page.getByRole('radio', { name: 'Ручной' }).click()

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Контейнеры' }).click()
    await page.getByText('Контейнер 20ft', { exact: true }).click()

    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 60, y: 60 }, force: true })

    const originalCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Контейнер 20ft' }).first()
    await originalCard.getByTitle('Дублировать').click()
    await expect(page.getByText('Груз дублирован')).toBeVisible()
    await expect(page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Контейнер 20ft' })).toHaveCount(2)

    // The duplicate needs its own click-placement (manual mode never
    // auto-places a freshly duplicated item onto the deck).
    await page.getByRole('button', { name: /^Контейнер 20ft \(копия\) 6\.06×2/ }).click()
    await background.click({ position: { x: 260, y: 60 }, force: true })

    await page.keyboard.press('Escape')

    const boxRects = page.locator('svg rect[fill="#0ea5e9"]')
    await expect(boxRects).toHaveCount(2)
    await boxRects.nth(0).scrollIntoViewIfNeeded()

    const boxA = await boxRects.nth(0).boundingBox()
    const boxB = await boxRects.nth(1).boundingBox()
    if (!boxA || !boxB) throw new Error('box rects not found')

    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2)
    await page.mouse.down()
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect(page.getByText('Объединение перетаскиванием доступно только для труб')).toBeVisible()
    // Nothing merged — both cards and both placements are still there.
    await expect(page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Контейнер 20ft' })).toHaveCount(2)
    await expect(boxRects).toHaveCount(2)
  })

  // Round 34. An ORIGINAL pipe stack of 8 and a duplicate whose 9 units stand
  // as 8 + 1 (its own «Ярусов» cap of 8 splits them); the duplicate's 8-stack
  // is then dragged onto the original's — a PARTIAL merge, since one unit of
  // the duplicate stays elsewhere. Returns the toasts' text afterwards.
  async function mergePartOfDuplicateOntoOriginal(page: Page, clearance: string) {
    await page.goto('/')
    await expect(headerBadge(page)).toHaveText(/\/22 ед\./)
    await clearCalculation(page)
    await setNumber(page.locator('label', { hasText: 'Предельная высота штабеля' }).locator('..').locator('input'), clearance)

    await page.getByRole('button', { name: 'Пресеты' }).click()
    await page.getByRole('button', { name: 'Смешанный' }).click()
    await page.getByText('Обсадная труба', { exact: true }).click()
    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 60, y: 60 }, force: true })
    await returnStampedPipeToAuto(page)
    const originalCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба' }).first()
    await setNumber(originalCard.locator('label:has-text("Кол-во") + input'), '8')
    await page.getByRole('button', { name: 'Автораспределение' }).click()
    const pipePlacements = page.locator('svg g[data-cargo-placement="true"]:has(rect[fill="#57534e"])')
    await expect(pipePlacements).toHaveCount(1)

    await originalCard.getByTitle('Дублировать').click()
    await expect(page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба' })).toHaveCount(2)
    await page.keyboard.press('Escape')
    const copyCard = page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба (копия)' }).first()
    await setNumber(copyCard.locator('label:has-text("Ярусов") + input'), '8')
    await setNumber(copyCard.locator('label:has-text("Кол-во") + input'), '9')
    await expect(pipePlacements).toHaveCount(3)
    await expect(headerBadge(page)).toHaveText(/^17\/17 ед\./)

    // The two 8-stacks are the ones labelled "×8" (the lone unit has no
    // count label). Nudge both so they become pins — only pins merge in
    // auto mode (see the first test) — then drag the duplicate's onto the
    // original's.
    await pipePlacements.nth(0).scrollIntoViewIfNeeded()
    const eightStacks = async () => {
      const labels = await pipePlacements.allTextContents()
      return labels.map((t, i) => [t, i] as const).filter(([t]) => /×8$/.test(t)).map(([t, i]) => ({ copy: t.includes('(копия)'), i }))
    }
    for (const { i } of await eightStacks()) {
      const box = await pipePlacements.nth(i).boundingBox()
      if (!box) throw new Error(`pipe stack ${i} not found before nudge`)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 })
      await page.mouse.up()
    }
    const stacks = await eightStacks()
    const from = await pipePlacements.nth(stacks.find((st) => st.copy)!.i).boundingBox()
    const onto = await pipePlacements.nth(stacks.find((st) => !st.copy)!.i).boundingBox()
    if (!from || !onto) throw new Error('8-stacks not found after nudge')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 10 })
    await page.mouse.up()
    return pipePlacements
  }

  test('a PARTIAL merge of a duplicate keeps both items\' counts — no ghost stack, no double-counted units', async ({ page }) => {
    // 10 m clearance: the merged 16 x 0.25 m = 4 m column fits.
    const pipePlacements = await mergePartOfDuplicateOntoOriginal(page, '10')

    await expect(page.getByText(/Объединено: 16 яр\./)).toBeVisible()
    // Used to read 24/17: the 8 moved units were counted under the duplicate
    // inside the merged stack AND again as the original's quantity, which
    // AUTO then placed as a ghost stack of 8.
    await expect(headerBadge(page)).toHaveText(/^17\/17 ед\./)
    await expect(pipePlacements).toHaveCount(2) // the mixed 16-stack + the duplicate's own lone unit
    await expect(page.locator('.rounded-lg.border.bg-card').filter({ hasText: 'Обсадная труба (копия)' })).toContainText('9/9')
  })

  test('a merge whose combined stack would stand above the clearance is refused', async ({ page }) => {
    // 2 m clearance: each stack of 8 x 0.25 m fits exactly, 16 of them don't
    // — the same 16 pipes of ONE item were already refused.
    const pipePlacements = await mergePartOfDuplicateOntoOriginal(page, '2')

    await expect(page.getByText('Превышена высота штабеля: 4 м при допустимых 2 м')).toBeVisible()
    await expect(pipePlacements).toHaveCount(3)
    await expect(headerBadge(page)).toHaveText(/^17\/17 ед\./)
  })
})

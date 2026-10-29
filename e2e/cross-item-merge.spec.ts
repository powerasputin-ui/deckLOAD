import { test, expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  cargoRow,
  chooseFromCatalog,
  clearCalculation,
  closeCargoTable,
  duplicateCargo,
  setCargoCells,
  setCargoTotal,
  setNumber,
  unitsCount,
  openSection,
  inspector,
  pickVariants,
} from './helpers'

// A stack's box once it has stopped moving. Esc closes the inspector, and the
// view slides back from under it (150 ms): a box read at once is mid-slide.
async function settledBox(stack: Locator) {
  const page = stack.page()
  await expect(inspector(page)).toHaveCount(0)
  let prev = await stack.boundingBox()
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50)
    const box = await stack.boundingBox()
    if (box && prev && box.x === prev.x && box.y === prev.y && box.width === prev.width && box.height === prev.height) return box
    prev = box
  }
  throw new Error('the stack kept moving')
}

// «placed/total ед.» in the status line under the deck (spec 8.3).
function headerBadge(page: Page) {
  return unitsCount(page)
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
    await openSection(page, 'Судно')
    const clearanceInput = page.locator('label', { hasText: 'Предельная высота штабеля' }).locator('..').locator('input')
    await clearanceInput.fill('10')
    await clearanceInput.blur()

    // From the catalogue the pipe joins the list and, in auto mode, the deck
    // (spec 7.2). Its quantity goes to 8 and «Подобрать варианты»
    // consolidates all 8 into one clean pyramid before duplicating —
    // otherwise the two stacks being merged wouldn't each cleanly hold 8,
    // making the expected "16" unpredictable.
    await chooseFromCatalog(page, 'Обсадная труба')
    await setCargoTotal(page, 'Обсадная труба', '8')
    await pickVariants(page)
    // A stacked pipe pyramid now draws as several <rect> capsule segments
    // sharing the same fill (see DeckVisualization's per-row pipe render) —
    // count placements via the g[data-cargo-placement] wrapper, not raw
    // rects, so one 8-pipe pyramid isn't miscounted as several placements.
    const pipePlacements = page.locator('svg g[data-cargo-name^="Обсадная труба"]')
    await expect(pipePlacements).toHaveCount(1)

    // Duplicate it in the cargo table — the copy starts with the same
    // quantity (8) and, being in auto mode, places itself on the deck.
    await duplicateCargo(page, 'Обсадная труба')
    await expect(page.getByText('Груз «Обсадная труба» дублирован')).toBeVisible()
    await closeCargoTable(page)
    await expect(page.getByTestId('cargo-list-row').filter({ hasText: 'Обсадная труба' })).toHaveCount(2)

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
    // A dragged stack stays selected, and its inspector covers the right of
    // the deck — Esc closes it before the next stack is taken.
    for (let i = 0; i < 2; i++) {
      const box = await settledBox(pipeRects.nth(i))
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 })
      await page.mouse.up()
      await page.keyboard.press('Escape')
    }

    // Re-read positions after the nudge (they moved) and drag A fully onto
    // B to trigger the merge.
    const rectA = pipeRects.nth(0)
    const rectB = pipeRects.nth(1)
    const freshA = await settledBox(rectA)
    const freshB = await settledBox(rectB)

    await page.mouse.move(freshA.x + freshA.width / 2, freshA.y + freshA.height / 2)
    await page.mouse.down()
    await page.mouse.move(freshB.x + freshB.width / 2, freshB.y + freshB.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect(page.getByText(/Объединено: 16 яр\./)).toBeVisible()
    // The duplicate's quantity was fully folded into the target — only one
    // "Обсадная труба" row should remain in "Грузы", with all 16.
    const pipeRows = page.getByTestId('cargo-list-row').filter({ hasText: 'Обсадная труба' })
    await expect(pipeRows).toHaveCount(1)
    await expect(pipeRects).toHaveCount(1)
    await expect(pipeRows.getByRole('textbox')).toHaveValue('16')
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

    // In manual mode a choice in the catalogue is armed for a click.
    await chooseFromCatalog(page, 'Контейнер 20ft')
    const background = page.locator('svg [data-deck-background="true"]').first()
    await background.click({ position: { x: 60, y: 60 }, force: true })

    await duplicateCargo(page, 'Контейнер 20ft')
    await closeCargoTable(page)
    await expect(page.getByTestId('cargo-list-row').filter({ hasText: 'Контейнер 20ft' })).toHaveCount(2)

    // The duplicate needs its own click-placement (manual mode never
    // auto-places a freshly duplicated item onto the deck).
    await page.getByRole('button', { name: 'Поставить «Контейнер 20ft (копия)»' }).click()
    const deckBox = await background.boundingBox()
    if (!deckBox) throw new Error('deck background not found')
    await background.click({ position: { x: deckBox.width * 0.55, y: 60 }, force: true })

    await page.keyboard.press('Escape')

    // The original is cargo 1 and the copy cargo 2, so each has its own tone.
    const boxRects = page.locator('svg g[data-cargo-name^="Контейнер 20ft"]')
    await expect(boxRects).toHaveCount(2)
    await boxRects.nth(0).scrollIntoViewIfNeeded()

    const boxA = await settledBox(boxRects.nth(0))
    const boxB = await settledBox(boxRects.nth(1))

    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2)
    await page.mouse.down()
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect(page.getByText('Объединение перетаскиванием доступно только для труб')).toBeVisible()
    // Nothing merged — both rows and both placements are still there.
    await expect(page.getByTestId('cargo-list-row').filter({ hasText: 'Контейнер 20ft' })).toHaveCount(2)
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
    await openSection(page, 'Судно')
    await setNumber(page.locator('label', { hasText: 'Предельная высота штабеля' }).locator('..').locator('input'), clearance)

    await chooseFromCatalog(page, 'Обсадная труба')
    await setCargoTotal(page, 'Обсадная труба', '8')
    await pickVariants(page)
    const pipePlacements = page.locator('svg g[data-cargo-name^="Обсадная труба"]')
    await expect(pipePlacements).toHaveCount(1)

    await duplicateCargo(page, 'Обсадная труба')
    await setCargoCells(page, 'Обсадная труба (копия)', { Ярусов: '8', Количество: '9' })
    await closeCargoTable(page)
    await expect(pipePlacements).toHaveCount(3)
    await expect(headerBadge(page)).toHaveText(/^17\/17 ед\./)

    // The two 8-stacks are the ones labelled "×8" (the lone unit has no
    // count). Their full label is data-stack-text: the deck writes «×N»
    // only where it fits. Nudge both so they become pins — only pins merge in
    // auto mode (see the first test) — then drag the duplicate's onto the
    // original's.
    await pipePlacements.nth(0).scrollIntoViewIfNeeded()
    const eightStacks = async () => {
      const stacks = await pipePlacements.evaluateAll((els) =>
        els.map((e) => ({ label: e.getAttribute('data-stack-text') ?? '', name: e.getAttribute('data-cargo-name') ?? '' }))
      )
      return stacks
        .map((s, i) => ({ ...s, i }))
        .filter((s) => /×8$/.test(s.label))
        .map((s) => ({ copy: s.name.includes('(копия)'), i: s.i }))
    }
    // A dragged stack stays selected, and its inspector covers the right of
    // the deck — Esc closes it before the next stack is taken.
    for (const { i } of await eightStacks()) {
      const box = await settledBox(pipePlacements.nth(i))
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 })
      await page.mouse.up()
      await page.keyboard.press('Escape')
    }
    const stacks = await eightStacks()
    const from = await settledBox(pipePlacements.nth(stacks.find((st) => st.copy)!.i))
    const onto = await settledBox(pipePlacements.nth(stacks.find((st) => !st.copy)!.i))
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
    await openSection(page, 'Грузы')
    const copy = cargoRow(page, 'Обсадная труба (копия)')
    await expect(copy).toContainText(/Размещено 9\s*из/)
    await expect(copy.getByRole('textbox')).toHaveValue('9')
  })

  test('a merge whose combined stack would stand above the clearance is refused', async ({ page }) => {
    // 2 m clearance: each stack of 8 x 0.25 m fits exactly, 16 of them don't
    // — the same 16 pipes of ONE item were already refused.
    const pipePlacements = await mergePartOfDuplicateOntoOriginal(page, '2')

    await expect(page.getByText('Выше предельной высоты: 4 м из 2 м')).toBeVisible()
    await expect(pipePlacements).toHaveCount(3)
    await expect(headerBadge(page)).toHaveText(/^17\/17 ед\./)
  })
})

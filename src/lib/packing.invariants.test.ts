import { describe, it, expect } from 'vitest'
import {
  packDeck,
  packMultiTrip,
  packingResultFromManual,
  maxLayersFor,
  type CargoItem,
  type PackingResult,
  type ManualPlacement,
} from './packing'

function item(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return {
    name: 'Груз',
    width: 1,
    length: 1,
    height: 0,
    quantity: 1,
    color: '#0ea5e9',
    allowRotation: true,
    ...partial,
  }
}

const CLOSE = 1e-6

// Cross-checks that PackingResult's derived numbers (breakdown, totals,
// utilization) actually agree with each other and with the raw `placed`
// array they're supposed to summarize. These don't test packing DECISIONS
// (where things get placed) — only that once a decision is made, every
// number the UI reads off the result is internally consistent with every
// other number, and with the source items' own settings (maxLayers,
// clearance). A change to one summary (e.g. what breakdown.layers shows)
// must never make it disagree with the rest of the result.
function assertResultIsInternallyConsistent(
  res: PackingResult,
  items: CargoItem[],
  clearance = 0,
  // packMultiTrip re-derives each trip's own item list (with quantity =
  // leftover from the previous trip) — the original `items` array's
  // quantities don't apply to any individual trip's requestedCount, so
  // that specific cross-check is opt-out for per-trip results.
  checkRequestedCountMatchesItems = true
): void {
  const itemById = new Map(items.map((it) => [it.id, it]))

  // 1) Aggregate sums (breakdown vs. raw placed vs. top-level totals) all agree.
  const sumBreakdownPlaced = res.breakdown.reduce((s, b) => s + b.placed, 0)
  const sumPlacedStacked = res.placed.reduce((s, p) => s + p.stackedCount, 0)
  expect(sumBreakdownPlaced).toBe(res.placedCount)
  expect(sumPlacedStacked).toBe(res.placedCount)

  const sumBreakdownWeight = res.breakdown.reduce((s, b) => s + b.weight, 0)
  const sumPlacedWeight = res.placed.reduce((s, p) => s + (p.weight ?? 0) * p.stackedCount, 0)
  expect(sumBreakdownWeight).toBeCloseTo(res.totalWeight, 6)
  expect(sumPlacedWeight).toBeCloseTo(res.totalWeight, 6)

  const sumBreakdownArea = res.breakdown.reduce((s, b) => s + b.area, 0)
  const sumPlacedArea = res.placed.reduce((s, p) => s + p.width * p.length, 0)
  expect(sumBreakdownArea).toBeCloseTo(res.usedArea, 6)
  expect(sumPlacedArea).toBeCloseTo(res.usedArea, 6)

  // 2) requestedCount is exactly the sum of every item's own quantity —
  // nothing added or dropped on the way into the result.
  if (checkRequestedCountMatchesItems) {
    expect(res.requestedCount).toBe(items.reduce((s, it) => s + Math.max(0, Math.round(it.quantity)), 0))
  }

  // 3) area/utilization bookkeeping.
  expect(res.freeArea).toBeCloseTo(Math.max(0, res.totalArea - res.usedArea), 6)
  expect(res.usedArea).toBeGreaterThanOrEqual(-CLOSE)
  expect(res.usedArea).toBeLessThanOrEqual(res.totalArea + CLOSE)
  if (res.totalArea > 0) {
    expect(res.utilization).toBeCloseTo(Math.min(1, res.usedArea / res.totalArea), 6)
  } else {
    expect(res.utilization).toBe(0)
  }

  // 4) Per-item breakdown: never claims more placed than requested, and
  // footprints matches the actual count of placed rows for that item.
  for (const b of res.breakdown) {
    expect(b.placed).toBeLessThanOrEqual(b.requested)
    const rowsForItem = res.placed.filter((p) => p.itemId === b.itemId)
    expect(b.footprints).toBe(rowsForItem.length)
    expect(rowsForItem.reduce((s, p) => s + p.stackedCount, 0)).toBe(b.placed)
    // A shortfall must be visible somewhere in `unplaced` for that item;
    // a fully-satisfied item must NOT have a leftover unplaced entry.
    const hasUnplacedEntry = res.unplaced.some((u) => u.itemId === b.itemId)
    if (b.placed < b.requested) {
      expect(hasUnplacedEntry).toBe(true)
    } else {
      expect(hasUnplacedEntry).toBe(false)
    }
  }

  // 5) Every unplaced entry refers to a real requested item. The reverse
  // (every requested item with nothing placed must show up as unplaced)
  // only holds when `items` reflects what was actually requested from
  // THIS specific result — not true per-trip in a multi-trip voyage, where
  // an item fully satisfied by an earlier trip legitimately has zero
  // remaining quantity (and so zero footprint anywhere) on a later one.
  for (const u of res.unplaced) {
    expect(itemById.has(u.itemId)).toBe(true)
  }
  if (checkRequestedCountMatchesItems) {
    for (const it of items) {
      if (Math.max(0, Math.round(it.quantity)) === 0) continue
      const b = res.breakdown.find((x) => x.itemId === it.id)
      if (!b || b.placed === 0) {
        expect(res.unplaced.some((u) => u.itemId === it.id)).toBe(true)
      }
    }
  }

  // 6) The REAL, physical stack height on every placed footprint never
  // exceeds what maxLayersFor allows for that item — regardless of what
  // breakdown.layers chooses to *display* (it may show the item's own
  // maxLayers cap even when fewer are actually stacked, but the raw
  // `placed` geometry itself must never violate the physical/user cap).
  for (const p of res.placed) {
    const cargo = itemById.get(p.itemId)
    if (!cargo) continue
    const cap = maxLayersFor(cargo, clearance)
    expect(p.stackedCount).toBeLessThanOrEqual(cap)
    expect(p.layers).toBe(p.stackedCount)
  }

  // 7) maxStackHeight is achieved by some real placement (or is 0 if
  // nothing with a positive height was placed) — never a phantom number
  // unrelated to what's actually on the deck.
  if (res.maxStackHeight > 0) {
    const achieved = res.placed.some((p) => {
      const cargo = itemById.get(p.itemId)
      const h = cargo?.height ?? 0
      return h * p.stackedCount >= res.maxStackHeight - CLOSE
    })
    expect(achieved).toBe(true)
  }
}

describe('PackingResult internal consistency (packDeck)', () => {
  it('holds for a simple single-item deck', () => {
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 5, weight: 100 })]
    const res = packDeck(10, 10, items)
    assertResultIsInternallyConsistent(res, items)
  })

  it('holds with multiple item types of different sizes/weights', () => {
    const items = [
      item({ id: 'a', width: 2, length: 3, quantity: 4, weight: 250 }),
      item({ id: 'b', width: 1, length: 1, quantity: 10, weight: 40 }),
      item({ id: 'c', width: 0.8, length: 1.2, quantity: 6, weight: 60 }),
    ]
    const res = packDeck(15, 8, items, { gap: 0.1, boardOffset: 0.2 })
    assertResultIsInternallyConsistent(res, items)
  })

  it('holds when some units cannot fit (partial placement / unplaced)', () => {
    const items = [
      item({ id: 'a', width: 5, length: 5, quantity: 4, weight: 500 }),
    ]
    // Deck only fits ~2 of these 5x5 items with default gap/boardOffset.
    const res = packDeck(10, 6, items)
    assertResultIsInternallyConsistent(res, items)
    expect(res.unplaced.length).toBeGreaterThan(0)
  })

  it('holds when an item is entirely oversized (never fits at all)', () => {
    const items = [
      item({ id: 'a', width: 2, length: 2, quantity: 3 }),
      item({ id: 'huge', width: 50, length: 50, quantity: 2 }),
    ]
    const res = packDeck(10, 10, items)
    assertResultIsInternallyConsistent(res, items)
    const hugeBreakdown = res.breakdown.find((b) => b.itemId === 'huge')
    // packDeck's breakdown always has one row per requested item, even if
    // zero units of it were placed (placed:0/footprints:0) — it's the
    // `unplaced` array, not breakdown row presence, that signals a shortfall.
    expect(hugeBreakdown?.placed).toBe(0)
    expect(res.unplaced.some((u) => u.itemId === 'huge')).toBe(true)
  })

  it('holds with an explicit per-item maxLayers cap and clearance unset (0)', () => {
    const items = [item({ id: 'a', width: 1, length: 1, height: 0.5, maxLayers: 3, quantity: 9 })]
    const res = packDeck(10, 10, items, { clearance: 0 })
    assertResultIsInternallyConsistent(res, items, 0)
    // 9 units at up to 3 layers each -> 3 footprints, each stacked exactly 3.
    expect(res.placed).toHaveLength(3)
    expect(res.placed.every((p) => p.stackedCount === 3)).toBe(true)
  })

  it('holds when the maxLayers cap is more restrictive than the physical clearance ceiling', () => {
    const items = [item({ id: 'a', width: 1, length: 1, height: 0.5, maxLayers: 2, quantity: 10 })]
    // Clearance of 5m / 0.5m height = 10 physical layers, but the item's own
    // cap of 2 must still win (the more restrictive of the two).
    const res = packDeck(10, 10, items, { clearance: 5 })
    assertResultIsInternallyConsistent(res, items, 5)
    expect(res.placed.every((p) => p.stackedCount <= 2)).toBe(true)
  })

  it('holds with zero-quantity and zero-dimension items mixed in (defensive/garbage input)', () => {
    const items = [
      item({ id: 'a', width: 2, length: 2, quantity: 3, weight: 100 }),
      item({ id: 'zero-qty', width: 1, length: 1, quantity: 0 }),
      item({ id: 'zero-dim', width: 0, length: 0, quantity: 5 }),
    ]
    const res = packDeck(10, 10, items)
    assertResultIsInternallyConsistent(res, items)
  })
})

describe('PackingResult internal consistency (packingResultFromManual)', () => {
  it('holds for a straightforward manual layout', () => {
    const items = [
      item({ id: 'a', width: 2, length: 3, height: 1, quantity: 4, weight: 250, maxLayers: 2 }),
      item({ id: 'b', width: 1, length: 1, height: 0.5, quantity: 6, weight: 40, maxLayers: 3 }),
    ]
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 3, layers: 2, rotated: false, color: '#0ea5e9', weight: 250 },
      { id: 'm2', itemId: 'a', name: 'A', x: 3, y: 0, width: 2, length: 3, layers: 1, rotated: false, color: '#0ea5e9', weight: 250 },
      { id: 'm3', itemId: 'b', name: 'B', x: 0, y: 4, width: 1, length: 1, layers: 3, rotated: false, color: '#f97316', weight: 40 },
    ]
    const res = packingResultFromManual(10, 10, placements, 10, items)
    assertResultIsInternallyConsistent(res, items)
    expect(res.breakdown.find((b) => b.itemId === 'a')!.placed).toBe(3)
    expect(res.breakdown.find((b) => b.itemId === 'b')!.placed).toBe(3)
  })

  it('holds when a placed item has an explicit maxLayers cap, even if fewer layers are actually stacked', () => {
    const items = [item({ id: 'a', width: 1, length: 1, height: 1, quantity: 5, maxLayers: 4 })]
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9' },
    ]
    const res = packingResultFromManual(10, 10, placements, 5, items)
    assertResultIsInternallyConsistent(res, items)
    // breakdown.layers reflects the item's own cap (4), but the actually
    // placed footprint still only carries 1 real unit — both must be true
    // at once without corrupting placedCount/weight/area sums.
    expect(res.breakdown.find((b) => b.itemId === 'a')!.layers).toBe(4)
    expect(res.placed[0].stackedCount).toBe(1)
  })

  it('holds with a shortfall (fewer manual placements than requested quantity)', () => {
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 5, weight: 100, maxLayers: 2 })]
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 2, rotated: false, color: '#0ea5e9', weight: 100 },
    ]
    const res = packingResultFromManual(10, 10, placements, 5, items)
    assertResultIsInternallyConsistent(res, items)
    expect(res.unplaced).toHaveLength(1)
  })
})

describe('PackingResult internal consistency (packMultiTrip, per trip)', () => {
  it('every trip in a multi-trip voyage is independently self-consistent', () => {
    const items = [
      item({ id: 'a', width: 2, length: 2, quantity: 20, weight: 100, maxLayers: 2 }),
      item({ id: 'b', width: 1, length: 1, quantity: 15, weight: 30 }),
    ]
    const trips = packMultiTrip(6, 6, items, { gap: 0.1 }, 10)
    expect(trips.length).toBeGreaterThan(1) // must actually spill into >1 trip
    for (const trip of trips) {
      // Each trip's own item list (quantity = leftover from the previous
      // trip) isn't `items` itself, so the requestedCount-vs-items check
      // doesn't apply per trip — see the helper's own doc comment.
      assertResultIsInternallyConsistent(trip, items, 0, false)
    }
    // And units are fully conserved across the whole voyage: every unit is
    // either placed on SOME trip, or unplaced on the LAST trip — never both,
    // never neither.
    const totalPlaced = trips.reduce((s, t) => s + t.placedCount, 0)
    const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
    const lastTrip = trips[trips.length - 1]
    const shortfallOnLastTrip = lastTrip.unplaced.length > 0 ? totalRequested - totalPlaced : 0
    expect(totalPlaced + shortfallOnLastTrip).toBe(totalRequested)
  })
})

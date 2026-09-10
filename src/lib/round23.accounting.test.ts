// Round 23 (composition-aware quantity/weight attribution in packing.ts's
// breakdown builders). Investigate-first audit found the Round 18-flagged
// defect confirmed: `packDeck`'s and `packingResultFromManual`'s breakdown
// both grouped by a placement's NOMINAL `itemId` alone
// (`result.placed.filter(p => p.itemId === item.id)`), so a composed
// placement's entire stackedCount/weight got attributed to one catalog
// row and a non-nominal constituent's row silently stayed at zero.
//
// Canonical scenario used throughout, per the review's own spec:
//   A: weight=100, quantity=2
//   B: weight=200, quantity=3
//   placement composition: [A2, B3]
// Expected: A placed=2/weight=200, B placed=3/weight=600, totals=5/800.
import { describe, it, expect } from 'vitest'
import { packDeck, packingResultFromManual, type CargoItem, type PinnedPlacement, type ManualPlacement } from './packing'

function catalogItem(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return { name: partial.id, width: 1, length: 1, height: 1, quantity: 1, color: '#0ea5e9', allowRotation: true, ...partial }
}

describe('packDeck breakdown — composition-aware attribution (Round 23)', () => {
  it('R23-1: [A2,B3] attributes 2/200 to A and 3/600 to B, not 5/800 to A and 0/0 to B', () => {
    const A = catalogItem({ id: 'A', quantity: 2, weight: 100 })
    const B = catalogItem({ id: 'B', quantity: 3, weight: 200 })
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    const res = packDeck(20, 20, [A, B], { pinned: [pin] })
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    const b = res.breakdown.find((b) => b.itemId === 'B')!
    expect(a.placed).toBe(2)
    expect(a.weight).toBe(200)
    expect(b.placed).toBe(3)
    expect(b.weight).toBe(600)
    // Totals must stay correct — this was never a T1 (total-wrong) defect,
    // only attribution.
    expect(res.totalWeight).toBe(800)
    expect(res.placedCount).toBe(5)
  })

  it('R23-2: [A2,A3] (same itemId, non-adjacent segments) attributes all 5 to A — no artificial split', () => {
    const A = catalogItem({ id: 'A', quantity: 5, weight: 100 })
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'A', layers: 3 }],
    }
    const res = packDeck(20, 20, [A], { pinned: [pin] })
    expect(res.breakdown).toHaveLength(1)
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    expect(a.placed).toBe(5)
    expect(a.weight).toBe(500)
    expect(a.footprints).toBe(1) // one physical placement, not two
  })

  it('R23-3: [A1,B2,C3] attributes 1/100, 2/400, 3/900 respectively', () => {
    const A = catalogItem({ id: 'A', quantity: 1, weight: 100 })
    const B = catalogItem({ id: 'B', quantity: 2, weight: 200 })
    const C = catalogItem({ id: 'C', quantity: 3, weight: 300 })
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 6, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 1 }, { itemId: 'B', layers: 2 }, { itemId: 'C', layers: 3 }],
    }
    const res = packDeck(20, 20, [A, B, C], { pinned: [pin] })
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    const b = res.breakdown.find((b) => b.itemId === 'B')!
    const c = res.breakdown.find((b) => b.itemId === 'C')!
    expect(a.placed).toBe(1); expect(a.weight).toBe(100)
    expect(b.placed).toBe(2); expect(b.weight).toBe(400)
    expect(c.placed).toBe(3); expect(c.weight).toBe(900)
  })

  it('regression: uncomposed placement breakdown is unchanged', () => {
    // quantity matches the pin's own layers exactly — otherwise AUTO
    // auto-places the leftover unplaced unit elsewhere on the deck, which
    // would inflate `placed` for a reason unrelated to this fix.
    const A = catalogItem({ id: 'A', quantity: 4, weight: 100 })
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 4, rotated: false, color: '#0ea5e9',
    }
    const res = packDeck(20, 20, [A], { pinned: [pin] })
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    expect(a.placed).toBe(4)
    expect(a.weight).toBe(400)
    expect(a.footprints).toBe(1)
  })
})

describe('packingResultFromManual breakdown + unplaced — composition-aware attribution (Round 23)', () => {
  it('R23-1: [A2,B3] attributes 2/200 to A and 3/600 to B, and unplaced is 0/0 for both (not a false B=3 cascading from the broken map)', () => {
    const A = catalogItem({ id: 'A', quantity: 2, weight: 100 })
    const B = catalogItem({ id: 'B', quantity: 3, weight: 200 })
    const placement: ManualPlacement = {
      id: 'm1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    const res = packingResultFromManual(20, 20, [placement], 5, [A, B])
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    const b = res.breakdown.find((b) => b.itemId === 'B')!
    expect(a.placed).toBe(2)
    expect(a.weight).toBe(200)
    expect(b.placed).toBe(3)
    expect(b.weight).toBe(600)
    expect(res.totalWeight).toBe(800)
    expect(res.placedCount).toBe(5)
    // The cascading bug: unplaced used to read straight from the broken
    // map, so B (never getting its own row) reported its FULL declared
    // quantity as still outstanding.
    expect(res.unplaced.find((u) => u.itemId === 'A')).toBeUndefined()
    expect(res.unplaced.find((u) => u.itemId === 'B')).toBeUndefined()
  })

  it('R23-2: [A2,A3] attributes all 5 to A, one footprint', () => {
    const A = catalogItem({ id: 'A', quantity: 5, weight: 100 })
    const placement: ManualPlacement = {
      id: 'm1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'A', layers: 3 }],
    }
    const res = packingResultFromManual(20, 20, [placement], 5, [A])
    expect(res.breakdown).toHaveLength(1)
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    expect(a.placed).toBe(5)
    expect(a.weight).toBe(500)
    expect(a.footprints).toBe(1)
  })

  it('R23-3: [A1,B2,C3] attributes 1/100, 2/400, 3/900 respectively', () => {
    const A = catalogItem({ id: 'A', quantity: 1, weight: 100 })
    const B = catalogItem({ id: 'B', quantity: 2, weight: 200 })
    const C = catalogItem({ id: 'C', quantity: 3, weight: 300 })
    const placement: ManualPlacement = {
      id: 'm1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 6, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 1 }, { itemId: 'B', layers: 2 }, { itemId: 'C', layers: 3 }],
    }
    const res = packingResultFromManual(20, 20, [placement], 6, [A, B, C])
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    const b = res.breakdown.find((b) => b.itemId === 'B')!
    const c = res.breakdown.find((b) => b.itemId === 'C')!
    expect(a.placed).toBe(1); expect(a.weight).toBe(100)
    expect(b.placed).toBe(2); expect(b.weight).toBe(400)
    expect(c.placed).toBe(3); expect(c.weight).toBe(900)
  })

  it('regression: uncomposed placement breakdown/unplaced is unchanged', () => {
    const A = catalogItem({ id: 'A', quantity: 5, weight: 100 })
    // A manual placement's own `weight` field is the pre-existing source of
    // truth for its uncomposed breakdown weight (never the catalog's, even
    // when they happen to agree) — matches how addManualPlacement always
    // populates it in real usage.
    const placement: ManualPlacement = {
      id: 'm1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 4, rotated: false, color: '#0ea5e9', weight: 100,
    }
    const res = packingResultFromManual(20, 20, [placement], 5, [A])
    const a = res.breakdown.find((b) => b.itemId === 'A')!
    expect(a.placed).toBe(4)
    expect(a.weight).toBe(400)
    // 1 unit of A genuinely still unplaced.
    const unplacedA = res.unplaced.find((u) => u.itemId === 'A')
    expect(unplacedA).toBeTruthy()
    expect(unplacedA?.reason).toContain('1')
  })
})

// Round 15 (quantity scanning). Central deliverable, explicitly required by
// the user as the acceptance gate before this round could start (closing
// the deferred issue flagged in the Round 14 P1 patch, commit 3314a89):
//
//   A quantity = 2, B quantity = 10
//   composed pin: composition = [A x2, B x3], nominal itemId = A
//   -> A consumed = 2 (all of it), B consumed = 3
//   -> remaining: A = 0, B = 7
//   -> a subsequent AUTO auto-pack pass must place AT MOST 7 more B units,
//      never 10 (the pre-fix bug: remainingByItem only ever tracked the
//      pin's nominal itemId, leaving every OTHER constituent's own quantity
//      completely untouched).
//
// This exercises packDeck's real internal remainingByItem bookkeeping
// end-to-end (not just the isolated pure helper) — the composed pin is
// accepted first, then packDeck's own per-catalog-item auto-pack loop runs
// for the SAME invocation, so this is the actual "second pass" the review
// described, not a separate call.
import { describe, it, expect } from 'vitest'
import { packDeck, type CargoItem, type PinnedPlacement } from './packing'
import { placementLayersOfItem } from './placementComposition'

function catalogItem(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return {
    name: partial.id,
    width: 1,
    length: 1,
    height: 0,
    quantity: 1,
    color: '#0ea5e9',
    allowRotation: true,
    ...partial,
  }
}

describe('packDeck remainingByItem — composed pin decrements EACH constituent\'s own quantity (Round 15 acceptance gate)', () => {
  it('A quantity=2, B quantity=10, composed pin=[A2,B3] -> B remaining=7, NOT 10, for the subsequent AUTO auto-pack pass', () => {
    const A = catalogItem({ id: 'A', width: 1, length: 1, quantity: 2 })
    const B = catalogItem({ id: 'B', width: 1, length: 1, quantity: 10 })
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    // A big, empty 20x20 deck — plenty of room for the pin PLUS every
    // additional unit B's own (uncomposed) quantity could possibly produce,
    // so a wrong (too-generous) remaining count would be directly visible
    // as extra placed footprints, not silently blocked by lack of space.
    const res = packDeck(20, 20, [A, B], { pinned: [pin] })

    const pinPlacement = res.placed.find((p) => p.x === 1 && p.y === 1)
    expect(pinPlacement).toBeDefined()
    expect(pinPlacement?.composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(pinPlacement?.layers).toBe(5)

    // Cross-check against the pure helper directly: exactly 2 of A and 3 of
    // B physically live inside the pin's own composition.
    expect(placementLayersOfItem({ itemId: pinPlacement!.itemId, layers: pinPlacement!.layers, composition: pinPlacement!.composition }, 'A')).toBe(2)
    expect(placementLayersOfItem({ itemId: pinPlacement!.itemId, layers: pinPlacement!.layers, composition: pinPlacement!.composition }, 'B')).toBe(3)

    // A's entire catalog quantity (2) is fully consumed by the pin itself —
    // no additional, unpinned A should be auto-packed anywhere else.
    const extraA = res.placed.filter((p) => p.itemId === 'A' && !(p.x === 1 && p.y === 1))
    expect(extraA).toHaveLength(0)

    // B: 10 - 3 (consumed by the pin) = 7 remaining. The auto-pack loop
    // must place AT MOST 7 additional B units — the deliberate bug this
    // fix closes would have left B's remaining count untouched at 10,
    // auto-packing up to 10 EXTRA units on top of the 3 already inside the
    // pin (13 total B units placed, when only 10 ever existed).
    const extraB = res.placed.filter((p) => p.itemId === 'B' && !(p.x === 1 && p.y === 1))
    const extraBLayers = extraB.reduce((s, p) => s + p.layers, 0)
    expect(extraBLayers).toBe(7)

    // Global invariant: total B physically placed (3 inside the pin + extra
    // auto-packed) must never exceed B's own real catalog quantity (10).
    const totalBPlaced = placementLayersOfItem({ itemId: pinPlacement!.itemId, layers: pinPlacement!.layers, composition: pinPlacement!.composition }, 'B') + extraBLayers
    expect(totalBPlaced).toBe(10)
    expect(totalBPlaced).toBeLessThanOrEqual(B.quantity)
  })

  it('dormancy: an ordinary (uncomposed) pin still clamps and decrements exactly as before', () => {
    const A = catalogItem({ id: 'A', width: 1, length: 1, quantity: 5 })
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 3, rotated: false, color: '#0ea5e9',
    }
    const res = packDeck(20, 20, [A], { pinned: [pin] })
    const pinPlacement = res.placed.find((p) => p.x === 1 && p.y === 1)
    expect(pinPlacement?.layers).toBe(3)
    // 5 - 3 = 2 remaining -> at most 2 extra A auto-packed elsewhere.
    const extraA = res.placed.filter((p) => p.itemId === 'A' && !(p.x === 1 && p.y === 1))
    const extraALayers = extraA.reduce((s, p) => s + p.layers, 0)
    expect(extraALayers).toBe(2)
  })
})

// Round 17 (capacity verification). The investigate-first review scope
// asked to check maxDeckCargoT/capacity end-to-end, including packDeck's
// OWN bulk auto-pack capacity mechanism (maxTotalWeightKg, used by
// packMultiTrip/packDeckVariants) — separate from the interactive
// placement-time guard (wouldExceedDeckCapacity/wouldExceedMaxDeckCargo,
// fixed and tested in cargoValidation.test.ts). This one turned out to
// already be correct, as a side effect of Round 14's fix to
// `result.totalWeight` (packing.ts's pin-processing loop) — this test
// pins that down as a permanent regression guard rather than leaving it
// as an unverified assumption.
import { describe, it, expect } from 'vitest'
import { packDeck, type CargoItem, type PinnedPlacement } from './packing'

function catalogItem(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return { name: partial.id, width: 1, length: 1, height: 0, quantity: 1, color: '#0ea5e9', allowRotation: true, ...partial }
}

describe('packDeck maxTotalWeightKg already respects a composed pin\'s true weight (Round 14 side effect, confirmed in Round 17)', () => {
  it('composed pin (3400kg real weight) + maxTotalWeightKg 4000kg -> only 600kg worth of a THIRD item auto-packs, not more', () => {
    const A = catalogItem({ id: 'A', width: 1, length: 1, quantity: 2, weight: 500 })
    const B = catalogItem({ id: 'B', width: 1, length: 1, quantity: 3, weight: 800 })
    const C = catalogItem({ id: 'C', width: 1, length: 1, quantity: 10, weight: 100 }) // 100kg/unit
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 1, length: 1,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    const res = packDeck(20, 20, [A, B, C], { pinned: [pin], maxTotalWeightKg: 4000 })
    const cLayers = res.placed.filter((p) => p.itemId === 'C').reduce((s, p) => s + p.layers, 0)
    // Pin's real weight (3400) + 6*100 = 4000 exactly — a composition-blind
    // seed (treating the pin as 0kg) would have let up to 10 units of C
    // auto-pack (1000kg total), well under a 4000kg cap that was never
    // really being enforced against the pin's own weight.
    expect(res.totalWeight).toBe(4000)
    expect(cLayers).toBe(6)
  })
})

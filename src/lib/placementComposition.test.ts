import { describe, it, expect } from 'vitest'
import {
  segmentsOf,
  placementTotalLayers,
  placementTotalWeightKg,
  placementTotalHeightM,
  placementTotalVCG,
  placementTotalTCGOffset,
  placementTotalLCGOffset,
  placementPush,
  placementConcatComposition,
  placementPop,
  placementRemoveItem,
  type ComposablePlacement,
  type CompositionCatalogItem,
} from './placementComposition'
import type { CompositionSegment } from './packing'

const A: CompositionCatalogItem = { id: 'A', weight: 500, height: 1.0 }
const B: CompositionCatalogItem = { id: 'B', weight: 800, height: 2.0 }
const C: CompositionCatalogItem = { id: 'C', weight: 300, height: 0.5 }
const catalog = [A, B, C]

function composed(composition: CompositionSegment[]): ComposablePlacement {
  // itemId/layers mirror what the FIRST segment would denormalize to, same
  // as a real composed placement's nominal fields — not read by any
  // function under test when `composition` is present, only by
  // `segmentsOf` as a fallback when it's absent.
  return { itemId: composition[0].itemId, layers: composition.reduce((s, c) => s + c.layers, 0), composition }
}

describe('segmentsOf', () => {
  it('returns composition verbatim when present', () => {
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(segmentsOf(p)).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
  })
  it('synthesizes a one-segment composition from itemId/layers when absent (uncomposed placement)', () => {
    const p: ComposablePlacement = { itemId: 'A', layers: 4 }
    expect(segmentsOf(p)).toEqual([{ itemId: 'A', layers: 4 }])
  })
})

// Regression-shaped invariant, explicitly requested: for ANY valid
// composition state, the sum of segment layers must equal the placement's
// own denormalized `layers` — proven here for every composition literal
// used throughout this file, not just asserted once.
describe('invariant: sum(composition.layers) === placementTotalLayers(p)', () => {
  const cases: CompositionSegment[][] = [
    [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    [{ itemId: 'A', layers: 2 }, { itemId: 'A', layers: 3 }, { itemId: 'B', layers: 2 }],
    [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'C', layers: 1 }],
    [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'A', layers: 1 }],
  ]
  for (const composition of cases) {
    it(JSON.stringify(composition), () => {
      const p = composed(composition)
      const expectedSum = composition.reduce((s, seg) => s + seg.layers, 0)
      expect(placementTotalLayers(p)).toBe(expectedSum)
    })
  }
})

describe('placementTotalLayers/WeightKg/HeightM — [A2,B3], [A2,A3,B2], [A2,B3,C1], [A2,B3,A1]', () => {
  it('[A2,B3]: layers=5, weight=3400, height=2*1.0+3*2.0=8.0', () => {
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(placementTotalLayers(p)).toBe(5)
    expect(placementTotalWeightKg(p, catalog)).toBe(2 * 500 + 3 * 800) // 3400
    expect(placementTotalHeightM(p, catalog)).toBeCloseTo(2 * 1.0 + 3 * 2.0, 6) // 8.0
  })

  it('[A2,A3,B2] (non-adjacent-looking but actually two ADJACENT A segments — see next test for the real non-adjacent case): layers=7', () => {
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'A', layers: 3 }, { itemId: 'B', layers: 2 }])
    expect(placementTotalLayers(p)).toBe(7)
    expect(placementTotalWeightKg(p, catalog)).toBe(2 * 500 + 3 * 500 + 2 * 800) // 4100
  })

  it('[A2,B3,C1]: layers=6, weight and height sum across all three distinct items', () => {
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'C', layers: 1 }])
    expect(placementTotalLayers(p)).toBe(6)
    expect(placementTotalWeightKg(p, catalog)).toBe(2 * 500 + 3 * 800 + 1 * 300) // 3700
    expect(placementTotalHeightM(p, catalog)).toBeCloseTo(2 * 1.0 + 3 * 2.0 + 1 * 0.5, 6) // 8.5
  })

  it('[A2,B3,A1]: layers=6, the two non-adjacent A segments stay SEPARATE (not coalesced) and both still count toward the total', () => {
    const composition: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'A', layers: 1 }]
    const p = composed(composition)
    // The defining property: segmentsOf returns the array untouched — no
    // coalescing logic runs on read, only placementPush/placementRemoveItem
    // decide when to coalesce, and only for ADJACENT same-itemId segments.
    expect(segmentsOf(p)).toHaveLength(3)
    expect(segmentsOf(p)[0].itemId).toBe('A')
    expect(segmentsOf(p)[2].itemId).toBe('A')
    expect(placementTotalLayers(p)).toBe(6)
    expect(placementTotalWeightKg(p, catalog)).toBe(2 * 500 + 3 * 800 + 1 * 500) // 4400 — both A segments counted
  })
})

describe('placementTotalVCG — baseline stacking, weight-weighted average', () => {
  it('uncomposed placement matches computeItemVCG\'s own default formula exactly (height*layers/2)', () => {
    const p: ComposablePlacement = { itemId: 'A', layers: 4 }
    // A height=1.0, layers=4 -> height*layers/2 = 2.0
    expect(placementTotalVCG(p, catalog)).toBeCloseTo(2.0, 6)
  })

  it('[A2,B3] with A on the bottom: B\'s contribution is offset by A\'s cumulative height, not computed as if B alone sat on the deck', () => {
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    // A: height=1.0, layers=2 -> own-base VCG = 1.0*2/2 = 1.0, baseline 0 -> absolute VCG = 1.0, weight=1000
    // B: height=2.0, layers=3 -> own-base VCG = 2.0*3/2 = 3.0, baseline = 2*1.0=2.0 -> absolute VCG = 2.0+3.0=5.0, weight=2400
    const weightedExpected = (1000 * 1.0 + 2400 * 5.0) / (1000 + 2400)
    expect(placementTotalVCG(p, catalog)).toBeCloseTo(weightedExpected, 6)
    expect(weightedExpected).toBeCloseTo(3.8235294117647056, 6)
  })

  it('order matters: [B3,A2] (B on the bottom this time) gives a DIFFERENT VCG than [A2,B3]', () => {
    const pBottomB = composed([{ itemId: 'B', layers: 3 }, { itemId: 'A', layers: 2 }])
    const pBottomA = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(placementTotalVCG(pBottomB, catalog)).not.toBeCloseTo(placementTotalVCG(pBottomA, catalog), 3)
  })

  it('honors an explicit stabilityOverride.vcgAboveDeckM on one constituent, weighted against the other\'s own default', () => {
    const aWithOverride: CompositionCatalogItem = { ...A, stabilityOverride: { vcgAboveDeckM: 2.0 } }
    const items = [aWithOverride, B]
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    // A: override VCG=2.0 directly (computeItemVCG short-circuits on override), weight=1000
    // B: no override, own-base VCG = 2.0*3/2=3.0, baseline = A's height*layers = 1.0*2=2.0 -> absolute = 5.0, weight=2400
    const expected = (1000 * 2.0 + 2400 * 5.0) / 3400
    expect(placementTotalVCG(p, items)).toBeCloseTo(expected, 6)
  })
})

describe('placementTotalTCGOffset / placementTotalLCGOffset', () => {
  it('weight-weighted average of each constituent\'s own offset, defaulting missing offsets to 0', () => {
    const aWithOffset: CompositionCatalogItem = { ...A, stabilityOverride: { tcgOffsetM: 1.0, lcgOffsetM: -0.5 } }
    const items = [aWithOffset, B] // B has no override -> offset 0
    const p = composed([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    // weightA=1000, offsetA=1.0; weightB=2400, offsetB=0
    expect(placementTotalTCGOffset(p, items)).toBeCloseTo((1000 * 1.0 + 2400 * 0) / 3400, 6)
    expect(placementTotalLCGOffset(p, items)).toBeCloseTo((1000 * -0.5 + 2400 * 0) / 3400, 6)
  })
  it('uncomposed placement with no override returns 0', () => {
    const p: ComposablePlacement = { itemId: 'A', layers: 2 }
    expect(placementTotalTCGOffset(p, catalog)).toBe(0)
    expect(placementTotalLCGOffset(p, catalog)).toBe(0)
  })
})

describe('placementPush', () => {
  it('starts a new composition from undefined', () => {
    expect(placementPush(undefined, 'A', 2)).toEqual([{ itemId: 'A', layers: 2 }])
  })
  it('coalesces into the top segment when itemId matches', () => {
    const existing: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    expect(placementPush(existing, 'B', 1)).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 4 }])
  })
  it('pushes a NEW segment (does not coalesce) when the top segment has a different itemId', () => {
    const existing: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    expect(placementPush(existing, 'A', 1)).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'A', layers: 1 }])
  })
  it('does not mutate the input array', () => {
    const existing: CompositionSegment[] = [{ itemId: 'A', layers: 2 }]
    const result = placementPush(existing, 'A', 1)
    expect(existing).toEqual([{ itemId: 'A', layers: 2 }])
    expect(result).toEqual([{ itemId: 'A', layers: 3 }])
  })
  // Regression: this module is the one place composition arithmetic is
  // meant to happen — that only holds if it refuses to produce a
  // composition violating its own invariant (every segment's layers a
  // positive integer) instead of silently accepting whatever a buggy
  // caller passes in.
  describe('refuses to push an invalid layers count, returning the input unchanged', () => {
    const invalidValues = [0, -1, 1.5, NaN, Infinity, -Infinity]
    for (const layers of invalidValues) {
      it(`layers=${layers}`, () => {
        const existing: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
        expect(placementPush(existing, 'A', layers)).toEqual(existing)
        expect(placementPush(undefined, 'A', layers)).toEqual([])
      })
    }
  })
})

describe('placementConcatComposition (merge algorithm E, step 7)', () => {
  it('composed + single: appends as a new top segment', () => {
    const target: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    const dragged: CompositionSegment[] = [{ itemId: 'C', layers: 1 }]
    expect(placementConcatComposition(target, dragged)).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'C', layers: 1 }])
  })
  it('single + composed: target absorbs dragged\'s whole composition on top', () => {
    const target: CompositionSegment[] = [{ itemId: 'C', layers: 1 }]
    const dragged: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    expect(placementConcatComposition(target, dragged)).toEqual([{ itemId: 'C', layers: 1 }, { itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
  })
  it('composed + composed: full concatenation, boundary coalesced only if adjacent itemIds match', () => {
    const target: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    const dragged: CompositionSegment[] = [{ itemId: 'C', layers: 1 }, { itemId: 'A', layers: 1 }]
    // target's last segment is B, dragged's first is C -> no coalesce at the boundary.
    // The two A segments (positions 0 and 3) are NOT adjacent -> stay separate.
    expect(placementConcatComposition(target, dragged)).toEqual([
      { itemId: 'A', layers: 2 },
      { itemId: 'B', layers: 3 },
      { itemId: 'C', layers: 1 },
      { itemId: 'A', layers: 1 },
    ])
  })
  it('boundary DOES coalesce when target\'s last segment matches dragged\'s first', () => {
    const target: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    const dragged: CompositionSegment[] = [{ itemId: 'B', layers: 1 }, { itemId: 'C', layers: 1 }]
    expect(placementConcatComposition(target, dragged)).toEqual([
      { itemId: 'A', layers: 2 },
      { itemId: 'B', layers: 4 },
      { itemId: 'C', layers: 1 },
    ])
  })
})

describe('placementPop (C2: always pops the physical top, LIFO)', () => {
  it('decrements the top segment when it has more than one layer', () => {
    const composition: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    const result = placementPop(composition)
    expect(result.composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 2 }])
    expect(result.remainingSingleton).toBeNull()
    expect(result.freedItemId).toBe('B')
  })
  it('removes the top segment entirely and un-composes when exactly one segment remains', () => {
    const composition: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 1 }]
    const result = placementPop(composition)
    expect(result.composition).toBeNull()
    expect(result.remainingSingleton).toEqual({ itemId: 'A', layers: 2 })
    expect(result.freedItemId).toBe('B')
  })
  it('exact push-then-pop reversibility (your counterexample from the architecture review)', () => {
    // [A2,B3] -> +A (push, top is B so a new segment is pushed) -> [A2,B3,A1] -> pop -> back to [A2,B3]
    const start: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    const afterPush = placementPush(start, 'A', 1)
    expect(afterPush).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'A', layers: 1 }])
    const popped = placementPop(afterPush)
    expect(popped.composition).toEqual(start)
    expect(popped.freedItemId).toBe('A')
  })
  it('does not mutate the input array', () => {
    const composition: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    placementPop(composition)
    expect(composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
  })
  // Known gap (flagged in review, not fixed this round — an empty
  // composition can't legitimately exist per the data model's own
  // invariant, so this documents the current behavior rather than papering
  // over it): calling placementPop with an empty array throws, since there
  // is no top segment to read. Not a total function yet.
  it('throws on an empty composition (documents current behavior — not a total function)', () => {
    expect(() => placementPop([])).toThrow()
  })
})

describe('placementRemoveItem (removeItem contract)', () => {
  it('[A2,B3] removeItem(A) -> B3, A returns 2', () => {
    const result = placementRemoveItem('A', [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(result.composition).toBeNull()
    expect(result.remainingSingleton).toEqual({ itemId: 'B', layers: 3 })
    expect(result.removedLayers).toBe(2)
  })
  it('[A2,B3] removeItem(B) -> A2, B returns 3', () => {
    const result = placementRemoveItem('B', [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(result.composition).toBeNull()
    expect(result.remainingSingleton).toEqual({ itemId: 'A', layers: 2 })
    expect(result.removedLayers).toBe(3)
  })
  it('[A2,B3,C1] removeItem(B) -> [A2,C1] (stays composed, no false coalescing of A and C)', () => {
    const result = placementRemoveItem('B', [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'C', layers: 1 }])
    expect(result.composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'C', layers: 1 }])
    expect(result.remainingSingleton).toBeNull()
    expect(result.removedLayers).toBe(3)
  })
  it('[A2,A3,B2] removeItem(A) -> [B2], A returns 5 (BOTH non-adjacent-in-spirit A segments summed, not just the first)', () => {
    // A2 and A3 here are adjacent in this literal (both A, would already be
    // one coalesced segment in a real composition) — the point of this
    // test is that placementRemoveItem sums ALL segments matching itemId
    // regardless of how many there are, which also covers the genuinely
    // non-adjacent case ([A2,B3,A1] below).
    const result = placementRemoveItem('A', [{ itemId: 'A', layers: 2 }, { itemId: 'A', layers: 3 }, { itemId: 'B', layers: 2 }])
    expect(result.composition).toBeNull()
    expect(result.remainingSingleton).toEqual({ itemId: 'B', layers: 2 })
    expect(result.removedLayers).toBe(5)
  })
  it('[A2,B3,A1] (genuinely non-adjacent A) removeItem(A) -> [B3], A returns 3 (2+1 summed across both occurrences)', () => {
    const result = placementRemoveItem('A', [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'A', layers: 1 }])
    expect(result.composition).toBeNull()
    expect(result.remainingSingleton).toEqual({ itemId: 'B', layers: 3 })
    expect(result.removedLayers).toBe(3)
  })
  it('[A2,B3,A1] removeItem(B) -> [A3] — removing the MIDDLE segment makes the two A segments newly adjacent, and they DO coalesce', () => {
    const result = placementRemoveItem('B', [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }, { itemId: 'A', layers: 1 }])
    expect(result.composition).toBeNull()
    expect(result.remainingSingleton).toEqual({ itemId: 'A', layers: 3 })
    expect(result.removedLayers).toBe(3)
  })
  it('removing an item not present in the composition at all returns 0 removed and leaves composition untouched (still composed)', () => {
    const composition: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    const result = placementRemoveItem('C', composition)
    expect(result.composition).toEqual(composition)
    expect(result.removedLayers).toBe(0)
  })
  it('removing the only two distinct items empties the placement entirely (composition: null, remainingSingleton: null)', () => {
    const r1 = placementRemoveItem('A', [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(r1.remainingSingleton).toEqual({ itemId: 'B', layers: 3 })
    const r2 = placementRemoveItem('B', r1.remainingSingleton ? [r1.remainingSingleton] : [])
    expect(r2.composition).toBeNull()
    expect(r2.remainingSingleton).toBeNull()
    expect(r2.removedLayers).toBe(3)
  })
  it('does not mutate the input array', () => {
    const composition: CompositionSegment[] = [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }]
    placementRemoveItem('A', composition)
    expect(composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
  })
})

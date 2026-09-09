// Round 14 (construction + stability, combined — see the migration plan's
// Section L) integration tests. Round 13 already proved the pure
// placementComposition.ts helpers correct in isolation (placementComposition
// .test.ts); this file proves the two REAL consumers wired up in Round 14 —
// packDeck/packingResultFromManual (construction) and
// buildCargoWeightMoments/buildLoadingConditionFromPlacements (stability) —
// correctly consume a hand-built `composition` on a placement, while every
// existing (uncomposed) placement keeps taking the exact old code path.
//
// No test here goes through the real merge/+/-/removeItem UI (page.tsx) —
// per the migration plan, merge is deliberately the LAST round to switch on;
// every placement fed to packDeck/packingResultFromManual/
// buildLoadingConditionFromPlacements below has its `composition` set by
// hand, the same technique Round 13's own tests already used.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  packDeck,
  packingResultFromManual,
  type CargoItem,
  type ManualPlacement,
  type PinnedPlacement,
} from './packing'
import {
  buildCargoWeightMoments,
  buildLoadingConditionFromPlacements,
  type VesselStabilityData,
  type DeckShipFrame,
} from './stability'
import { placementTotalVCG, placementTotalLayers } from './placementComposition'

// Same catalog values as placementComposition.test.ts's own A/B/C fixtures
// (kept in sync deliberately — this file cross-checks the SAME worked
// numbers through the real construction+stability call chain, not just the
// isolated helpers).
function catalogItem(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return {
    name: partial.id,
    width: 1,
    length: 1,
    height: 0,
    quantity: 10,
    color: '#0ea5e9',
    allowRotation: true,
    ...partial,
  }
}
const A = catalogItem({ id: 'A', weight: 500, height: 1.0 })
const B = catalogItem({ id: 'B', weight: 800, height: 2.0 })

describe('packDeck pin loop — composition copy-through (construction)', () => {
  it('copies composition through verbatim onto the PlacedItem, never synthesizing one', () => {
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    const res = packDeck(10, 10, [A, B], { pinned: [pin] })
    const placed = res.placed.find((p) => p.x === 1 && p.y === 1)
    expect(placed?.composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
  })

  it('weight/height become the composition-aware AVERAGE per unit — weight*layers and height*layers reconstruct the true totals', () => {
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
      layers: 5, rotated: false, color: '#0ea5e9',
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    // quantity: 2 for A and 3 for B — exactly what the pin's own
    // composition consumes from EACH constituent (Round 15 made
    // remainingByItem decrement per-constituent, not just the nominal
    // itemId — see round15.quantity.test.ts) — so packDeck's own auto-pack
    // loop has nothing left over for either item and doesn't place any
    // EXTRA, unpinned units that would pollute res.totalWeight beyond the
    // one placement under test.
    const res = packDeck(10, 10, [catalogItem({ ...A, quantity: 2 }), catalogItem({ ...B, quantity: 3 })], { pinned: [pin] })
    const placed = res.placed.find((p) => p.x === 1 && p.y === 1)
    // total weight = 2*500 + 3*800 = 3400, layers = 5 -> average = 680
    expect(placed?.weight).toBeCloseTo(680, 6)
    expect((placed?.weight ?? 0) * (placed?.layers ?? 0)).toBeCloseTo(3400, 6)
    // total height = 2*1.0 + 3*2.0 = 8.0, layers = 5 -> average = 1.6
    expect(placed?.height).toBeCloseTo(1.6, 6)
    expect((placed?.height ?? 0) * (placed?.layers ?? 0)).toBeCloseTo(8.0, 6)
    // result.totalWeight (ship-level aggregate) must also reflect the true total
    expect(res.totalWeight).toBeCloseTo(3400, 6)
  })

  it('dormancy: an ordinary (uncomposed) pin is completely unaffected — no composition field appears anywhere', () => {
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
      layers: 3, rotated: false, color: '#0ea5e9', weight: 500,
    }
    const res = packDeck(10, 10, [catalogItem({ ...A, quantity: 3 })], { pinned: [pin] })
    const placed = res.placed.find((p) => p.x === 1 && p.y === 1)
    expect(placed?.composition).toBeUndefined()
    // Numerically identical to the pre-Round-14 flat-field arithmetic:
    // weight = the pin's OWN weight (500, unchanged — never overwritten by
    // an item lookup), height = item's own height (1.0).
    expect(placed?.weight).toBe(500)
    expect(placed?.height).toBe(1.0)
  })

  // P1 corrective patch (post-Round-14 review): `composition` is this
  // placement's sole source of physical truth once present — its own
  // segment total (placementTotalLayers) is authoritative, NOT the
  // pre-existing requestedLayers-vs-remainingByItem clamp, which only ever
  // tracks ONE nominal itemId's own catalog quantity. Before this fix, a
  // composed pin whose nominal itemId ran short on quantity got its
  // PlacedItem.layers silently clamped down (e.g. to 3) while `composition`
  // stayed at its full, uncomposed total (5 = A2+B3) — breaking the
  // invariant sum(composition.layers) === PlacedItem.layers exactly the
  // moment a composition-aware consumer (stability.ts) started trusting
  // composition over layers. Not reachable through the real merge UI yet
  // (merge doesn't write composition until Round 24), but construction is
  // already officially composition-aware, so the invariant must hold now.
  describe('invariant: sum(composition.layers) === PlacedItem.layers, even when the nominal itemId is short on catalog quantity', () => {
    it('quantity of the nominal itemId (A) is LESS than the composition needs — composition wins, layers is NOT silently clamped down', () => {
      const pin: PinnedPlacement = {
        id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
        layers: 5, rotated: false, color: '#0ea5e9',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
      }
      // Only 3 units of A left in the catalog — nowhere near enough to
      // satisfy the pin's own top-level `layers: 5` under the OLD
      // (pre-patch) clamp, which would have produced PlacedItem.layers = 3
      // while composition still summed to 5.
      const res = packDeck(10, 10, [catalogItem({ ...A, quantity: 3 }), catalogItem({ ...B, quantity: 0 })], { pinned: [pin] })
      const placed = res.placed.find((p) => p.x === 1 && p.y === 1)
      expect(placed).toBeDefined()
      expect(placed?.composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
      expect(placementTotalLayers({ itemId: placed!.itemId, layers: placed!.layers, composition: placed!.composition })).toBe(placed!.layers)
      expect(placed?.layers).toBe(5)
      expect(placed?.stackedCount).toBe(5)
    })

    it('quantity of the nominal itemId is ZERO — composition is still fully authoritative', () => {
      const pin: PinnedPlacement = {
        id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
        layers: 5, rotated: false, color: '#0ea5e9',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
      }
      const res = packDeck(10, 10, [catalogItem({ ...A, quantity: 0 }), catalogItem({ ...B, quantity: 0 })], { pinned: [pin] })
      const placed = res.placed.find((p) => p.x === 1 && p.y === 1)
      expect(placed?.layers).toBe(5)
      expect(placed?.composition).toHaveLength(2)
    })

    // Since Round 15 (per-constituent remainingByItem, see
    // round15.quantity.test.ts), a constituent's OWN quantity being short of
    // what its OWN segment needs is the scenario that actually exercises
    // this clamp — composition needs A×5, but A's catalog quantity is only
    // 3, so A's remaining would go to -2 without the Math.max(0, ...) clamp.
    it('remainingByItem is clamped to 0, never negative, when a composed pin\'s own constituent segment exceeds that constituent\'s own remaining quantity', () => {
      const pin: PinnedPlacement = {
        id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
        layers: 8, rotated: false, color: '#0ea5e9',
        composition: [{ itemId: 'A', layers: 5 }, { itemId: 'B', layers: 3 }],
      }
      // A second, unpinned unit of A should NOT get auto-packed on top of
      // this — remainingByItem for A must not go negative and wrap/underflow
      // into permitting more A than the catalog actually has.
      const res = packDeck(10, 10, [catalogItem({ ...A, quantity: 3 }), catalogItem({ ...B, quantity: 3 })], { pinned: [pin] })
      const extraAPlacements = res.placed.filter((p) => p.itemId === 'A' && !(p.x === 1 && p.y === 1))
      expect(extraAPlacements).toHaveLength(0)
      const extraBPlacements = res.placed.filter((p) => p.itemId === 'B' && !(p.x === 1 && p.y === 1))
      expect(extraBPlacements).toHaveLength(0) // B's own quantity (3) is exactly consumed by its own segment (3)
    })
  })
})

describe('packingResultFromManual — composition copy-through (construction)', () => {
  it('copies composition through verbatim, never synthesizing one, and derives the average weight/height', () => {
    const placements: ManualPlacement[] = [
      {
        id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 2, length: 2,
        layers: 5, rotated: false, color: '#0ea5e9',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
      },
    ]
    const res = packingResultFromManual(10, 10, placements, 5, [A, B])
    expect(res.placed[0].composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(res.placed[0].weight).toBeCloseTo(680, 6) // 3400 / 5
    expect(res.placed[0].height).toBeCloseTo(1.6, 6) // 8.0 / 5
    expect(res.totalWeight).toBeCloseTo(3400, 6)
  })

  it('dormancy: an ordinary (uncomposed) manual placement is completely unaffected', () => {
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 3, rotated: false, color: '#0ea5e9', weight: 500 },
    ]
    const res = packingResultFromManual(10, 10, placements, 3, [A])
    expect(res.placed[0].composition).toBeUndefined()
    expect(res.placed[0].weight).toBe(500)
    expect(res.placed[0].height).toBe(1.0)
    expect(res.totalWeight).toBe(1500)
  })

  // P1 corrective patch — same invariant as packDeck's above, checked here
  // too since packingResultFromManual is construction's OTHER real writer.
  // Manual placements have no remainingByItem-style quantity clamp at all
  // (layersFor previously just trusted `p.layers` outright), so the
  // specific clamp-vs-composition conflict found in packDeck can't occur
  // here the same way — but a stale/hand-edited `p.layers` that disagreed
  // with `p.composition`'s own sum used to be trusted anyway (the OLD
  // layersFor read `p.layers` unconditionally). Deriving layers FROM
  // composition (this patch) makes the invariant hold by construction
  // regardless of what a stale `p.layers` says.
  it('invariant: sum(composition.layers) === PlacedItem.layers, even when p.layers itself is stale/wrong', () => {
    const placements: ManualPlacement[] = [
      {
        // Deliberately wrong top-level layers (3) that disagrees with the
        // composition's own true total (5) — proves layers is DERIVED from
        // composition, not trusted from this stale field.
        id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 2, length: 2,
        layers: 3, rotated: false, color: '#0ea5e9',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
      },
    ]
    const res = packingResultFromManual(10, 10, placements, 5, [A, B])
    const placed = res.placed[0]
    expect(placed.composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
    expect(placementTotalLayers({ itemId: placed.itemId, layers: placed.layers, composition: placed.composition })).toBe(placed.layers)
    expect(placed.layers).toBe(5)
    expect(placed.stackedCount).toBe(5)
  })
})

describe('buildCargoWeightMoments / buildLoadingConditionFromPlacements — composition-aware stability', () => {
  const vessel: VesselStabilityData = {
    particulars: {
      lengthBpp: 80, breadth: 18,
      lightshipWeightKg: 2_000_000, lightshipKG: 5.0, lightshipLCG: 0, lightshipTCG: 0,
      longitudinalOrigin: 'midships',
    },
    hydrostatics: { points: [] },
    variableWeights: [],
  }
  const shipFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }

  it('exact numeric match to placementComposition.ts\'s own worked [A2,B3] VCG example, end-to-end through buildCargoWeightMoments', () => {
    const composed = {
      itemId: 'A', x: 9, y: 3, width: 2, length: 2, height: 1.6, layers: 5,
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    const moments = buildCargoWeightMoments([composed], 20, 8, shipFrame, true, [A, B])
    expect(moments).toHaveLength(1)
    expect(moments[0].weightKg).toBeCloseTo(3400, 6)
    // Same weighted-average VCG formula as placementComposition.test.ts:
    // A: own-base VCG=1.0, baseline=0 -> absolute=1.0, weight=1000
    // B: own-base VCG=3.0, baseline=2.0 -> absolute=5.0, weight=2400
    const expectedVCG = (1000 * 1.0 + 2400 * 5.0) / 3400
    expect(moments[0].vcgM).toBeCloseTo(expectedVCG, 6)
    expect(expectedVCG).toBeCloseTo(3.8235294117647056, 6)
    // Cross-checked against the pure helper directly.
    expect(placementTotalVCG({ itemId: 'A', layers: 5, composition: composed.composition }, [A, B])).toBeCloseTo(expectedVCG, 6)
  })

  it('dormancy: an uncomposed placement is numerically identical to the pre-Round-14 single computeItemVCG call', () => {
    const plain = { itemId: 'A', x: 9, y: 3, width: 2, length: 2, height: 1.0, layers: 4, weight: 500 }
    const moments = buildCargoWeightMoments([plain], 20, 8, shipFrame, true, [A, B])
    expect(moments[0].weightKg).toBe(2000) // 500 * 4
    expect(moments[0].vcgM).toBeCloseTo((1.0 * 4) / 2, 6) // height*layers/2 default
  })

  it('mandatory: mixed-height + mixed-weight + REVERSED order — [A2,B3] vs [B3,A2] have identical total weight but different VCG, and each segment\'s own TCG/LCG offset is correctly weighted in', () => {
    const aWithOffset: CargoItem = { ...A, stabilityOverride: { tcgOffsetM: 0.5, lcgOffsetM: 0.2 } }
    const bWithOffset: CargoItem = { ...B, stabilityOverride: { tcgOffsetM: -0.3, lcgOffsetM: 0.9 } }
    const items = [aWithOffset, bWithOffset]
    // Both placements centered at the exact deck center so the auto
    // (position-derived) TCG/LCG arm is zero — isolating the offset
    // contribution this test actually cares about.
    const base = { x: 9, y: 3, width: 2, length: 2, layers: 5 }
    const abBottomA = { ...base, itemId: 'A', height: 1.6, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }] }
    const abBottomB = { ...base, itemId: 'B', height: 1.6, composition: [{ itemId: 'B', layers: 3 }, { itemId: 'A', layers: 2 }] }

    const momentsBottomA = buildCargoWeightMoments([abBottomA], 20, 8, shipFrame, true, items)
    const momentsBottomB = buildCargoWeightMoments([abBottomB], 20, 8, shipFrame, true, items)

    // Identical total weight regardless of stacking order.
    expect(momentsBottomA[0].weightKg).toBeCloseTo(3400, 6)
    expect(momentsBottomB[0].weightKg).toBeCloseTo(3400, 6)
    expect(momentsBottomA[0].weightKg).toBeCloseTo(momentsBottomB[0].weightKg, 9)

    // VCG genuinely differs — stacking order is not commutative.
    expect(momentsBottomA[0].vcgM).not.toBeCloseTo(momentsBottomB[0].vcgM, 3)

    // TCG/LCG offsets are the SAME weight-weighted average regardless of
    // stacking order (order only ever changes VCG's baseline term, not the
    // TCG/LCG offset weighting) — computed independently here to prove
    // buildCargoWeightMoments is actually consulting each segment's own
    // stabilityOverride, not silently reusing one constituent's value for
    // the whole placement.
    const expectedTcgOffset = (1000 * 0.5 + 2400 * -0.3) / 3400
    const expectedLcgOffset = (1000 * 0.2 + 2400 * 0.9) / 3400
    expect(momentsBottomA[0].tcgM).toBeCloseTo(expectedTcgOffset, 6)
    expect(momentsBottomA[0].lcgM).toBeCloseTo(expectedLcgOffset, 6)
    expect(momentsBottomB[0].tcgM).toBeCloseTo(expectedTcgOffset, 6)
    expect(momentsBottomB[0].lcgM).toBeCloseTo(expectedLcgOffset, 6)
  })

  it('buildLoadingConditionFromPlacements threads items through and leaves composition untouched across a unit conversion', () => {
    const composed = {
      itemId: 'A', x: 9, y: 3, width: 2, length: 2, height: 1.6, layers: 5,
      composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
    }
    // unit='ft' forces the internal placementsM conversion branch to run —
    // proves composition survives the `{ ...p, x: toMeters(...), ... }`
    // spread untouched (it's never itself passed through toMeters).
    const loadingFt = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 65.6168, length: 26.2467 }, true, [{ ...composed, x: 29.5276, y: 9.8425, width: 6.5617, length: 6.5617 }], 'ft', [A, B])
    const loadingM = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, [composed], 'm', [A, B])
    // Same physical scenario expressed in feet vs metres should converge to
    // (approximately) the same loading condition.
    expect(loadingFt.totalDisplacementKg).toBeCloseTo(loadingM.totalDisplacementKg, -1)
    expect(loadingFt.KG).toBeCloseTo(loadingM.KG, 1)
  })
})

describe('Round 14 "no production writer" gate', () => {
  it('runtime: packDeck never invents composition for an uncomposed pin, even a multi-layer one', () => {
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'A', name: 'A', x: 1, y: 1, width: 2, length: 2,
      layers: 4, rotated: false, color: '#0ea5e9',
    }
    const res = packDeck(10, 10, [A], { pinned: [pin] })
    expect(res.placed.every((p) => p.composition === undefined)).toBe(true)
  })

  it('runtime: packingResultFromManual never invents composition for an uncomposed placement', () => {
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 3, rotated: false, color: '#0ea5e9' },
    ]
    const res = packingResultFromManual(10, 10, placements, 3, [A])
    expect(res.placed.every((p) => p.composition === undefined)).toBe(true)
  })

  // Static check: every `composition:` write site (object-literal key) in
  // production code (src/**, excluding *.test.ts) must be one of the
  // whitelisted, already-reviewed sites below. This is deliberately a
  // SOURCE-TEXT check, not a runtime one — its entire point is to catch a
  // FUTURE change that adds a new write site (e.g. a merge handler in
  // page.tsx starting to write `composition:`) even before any test
  // exercises that new code path, which a purely runtime assertion never
  // could. If this test fails, it means either (a) a real new writer was
  // added — merge should stay the ONLY one until Round 24 explicitly flips
  // it on, or (b) an already-reviewed site's line number in this whitelist
  // is stale after an unrelated edit — update the whitelist, don't just
  // delete the assertion.
  it('static: every composition-write site in production code is a whitelisted copy-through/helper/normalizer, never a live merge handler', () => {
    const root = join(__dirname, '..', '..')
    const filesToScan = [
      'src/lib/packing.ts',
      'src/lib/stability.ts',
      'src/lib/placementComposition.ts',
      'src/store/projects.ts',
      'src/store/calculator.ts',
      'src/app/page.tsx',
      'src/components/calculator/Sidebar.tsx',
      'src/components/calculator/StabilityPanel.tsx',
      'src/components/calculator/Deck3DView.tsx',
      'src/components/calculator/DeckVisualization.tsx',
      'src/components/calculator/ItemList.tsx',
    ]
    // Whitelisted files this test EXPECTS to contain a `composition:`
    // object-literal key — every occurrence in a NON-whitelisted file below
    // fails the test outright, and every occurrence in a whitelisted file
    // still gets counted (see the per-file assertions after) so a
    // surprising NEW site inside an already-whitelisted file doesn't slip
    // through silently either.
    const whitelistedFiles = new Set([
      'src/lib/packing.ts', // copy-through only: `composition: pin.composition` / `composition: p.composition`
      'src/lib/stability.ts', // copy-through only: `composition: p.composition` inside the composable() helper
      'src/lib/placementComposition.ts', // the arithmetic module itself — operates on a composition array the CALLER already supplied
      'src/store/projects.ts', // duplicateProject's itemId remap of an EXISTING composition array
      // Round 16: removeItem's removeItemFromPlacements only ever STRIPS
      // segments out of an EXISTING composition via placementRemoveItem
      // (or copies it through untouched when unaffected) — never invents
      // one where a placement didn't already have it. Still not a merge
      // writer: merge stays the only thing that can CREATE a composition
      // from scratch until the switch-on round.
      'src/store/calculator.ts',
      // Round 20: composition-only preservation across mode/variant
      // transformations (handleModeChange's AUTO<->MANUAL, handleAutoRedistribute's
      // frozenPinned, applyVariant's MANUAL/AUTO branches) — every site is a
      // straight `composition: p.composition` / `composition: m.composition`
      // passthrough from an EXISTING placement (PlacedItem or a raw stored
      // ManualPlacement/PinnedPlacement) into a freshly-reconstructed one of
      // the same kind. Still not a merge writer: none of these five sites can
      // ever populate composition where the source didn't already have it.
      'src/app/page.tsx',
    ])

    for (const relPath of filesToScan) {
      const abs = join(root, relPath)
      let text: string
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        continue // file not present in this checkout — nothing to scan
      }
      const matches = text.match(/\bcomposition\s*:/g) ?? []
      // Filter out matches that are clearly type annotations
      // (`composition?: CompositionSegment[]`, `composition: CompositionSegment[]`
      // as an interface field, or `composition: CompositionSegment[] | null`
      // as a return-type field) rather than an object-literal value —
      // distinguished by what immediately follows the colon.
      const valueWrites = (text.match(/\bcomposition\??\s*:\s*[^,}\n]*/g) ?? []).filter((m) => {
        // Type-position patterns: "composition?: CompositionSegment[]",
        // "composition: CompositionSegment[] | null".
        return !/composition\??\s*:\s*CompositionSegment/.test(m)
      })
      if (!whitelistedFiles.has(relPath)) {
        expect(matches.length, `${relPath} must never write a composition: field (found ${matches.length})`).toBe(0)
        continue
      }
      expect(valueWrites.length, `${relPath}: expected at least one whitelisted composition: write site`).toBeGreaterThan(0)
    }
  })
})

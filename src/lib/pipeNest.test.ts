import { describe, it, expect } from 'vitest'
import {
  computePipeNest,
  pipesPerFullRow,
  pipeNestTierOffsets,
  DEFAULT_TIERS,
  DEFAULT_CRATE_HEIGHT_M,
  REAL_CRATE_HEIGHT_M_OD1073M,
} from './pipeNest'

describe('pipesPerFullRow', () => {
  it('matches the real ДВТК п. 2.1.6/2.1.7 figure: 16.9-17.0 m usable width / 0.957 m OD = 17', () => {
    expect(pipesPerFullRow(16.9, 0.957)).toBe(17)
    expect(pipesPerFullRow(17.0, 0.957)).toBe(17)
  })

  it('returns 0 for non-positive inputs', () => {
    expect(pipesPerFullRow(0, 0.957)).toBe(0)
    expect(pipesPerFullRow(16.9, 0)).toBe(0)
  })
})

describe('pipeNestTierOffsets — a partial tier stays aligned with the full tier below it', () => {
  it('centres a full tier symmetrically around 0', () => {
    const offsets = pipeNestTierOffsets(4, 4)
    expect(offsets).toEqual([-3, -1, 1, 3])
  })

  it('a partial tier keeps the SAME positions as a full tier, not its own centre', () => {
    // Straight stacking: every tier's pipe at position j rests directly on
    // the pipe at position j in the tier below. Re-centring a shorter top
    // tier on its own count would slide it sideways off the pipes below —
    // physically impossible for a straight (non-nested) stack.
    const full = pipeNestTierOffsets(4, 4)
    const partial = pipeNestTierOffsets(4, 2)
    expect(partial).toEqual(full.slice(0, 2))
  })
})

describe('computePipeNest — real Ø813 НУБП-72 stack (17 per row, OD 0.957)', () => {
  // Real source: the operator's own spreadsheet puts 33 pipes in this
  // stack. Under the document's own default (exactly 2 tiers, п. 2.1.2),
  // 2 tiers x 17/row = 34 — one more than 33, i.e. the top tier is short
  // by one pipe. This test proves the geometry decomposes as a straight
  // 17+16 stack (same horizontal layout both tiers, one pipe short on
  // top), NOT a valley-nested taper.
  const nest = computePipeNest({
    pipeOuterDiameterM: 0.957,
    pipeLengthM: 12.38,
    pipeWeightKg: 15_000,
    usableWidthM: 16.9,
    pipeCount: 33,
  })

  it('decomposes into two EQUAL-width tiers (17, then 16 short by one), not a shrinking pyramid', () => {
    expect(nest.pipesPerRow).toBe(17)
    expect(nest.tierCounts).toEqual([17, 16])
    expect(nest.pipeCount).toBe(33)
    expect(nest.limited).toBe(false)
  })

  it('uses the DEFAULT (estimated) crib height when none is given, clearly distinct from the real 1.0 m figure', () => {
    expect(nest.crateHeightM).toBe(DEFAULT_CRATE_HEIGHT_M)
    expect(nest.crateHeightM).not.toBe(REAL_CRATE_HEIGHT_M_OD1073M)
  })

  it('reaches a straight-column height of crib + 2 x OD (no nesting pitch)', () => {
    expect(nest.heightM).toBeCloseTo(DEFAULT_CRATE_HEIGHT_M + 2 * 0.957, 6)
  })

  it('has a uniform-column centroid at crib + OD (exactly, not approximately — every tier weighs the same)', () => {
    expect(nest.vcgAboveDeckM).toBeCloseTo(DEFAULT_CRATE_HEIGHT_M + 0.957, 6)
    // Sanity: strictly less than the full stack height (centroid can never
    // reach the top of a stack with any weight below it).
    expect(nest.vcgAboveDeckM).toBeLessThan(nest.heightM)
  })
})

describe('computePipeNest — real crib height applied to its real drawing scheme (Ø813 НУБП-130, OD 1.073)', () => {
  // ДВТК/638.362241.023 REV3 лист 9: "количество труб в штабеле – 29 шт,
  // масса труб в штабеле – 647 т" (29 x ~22.3 t/pipe ≈ 647 t). This scheme
  // is drawn as a SINGLE tier in the source image (not two) — the crib
  // dimension "1000" was measured against that single-tier drawing, so
  // this test only pins the one real, measured number: crib height 1.0 m.
  const nest = computePipeNest({
    pipeOuterDiameterM: 1.073,
    pipeLengthM: 12.38,
    pipeWeightKg: 22_310, // 647_000 / 29, matching the document's own totals
    usableWidthM: 16.9,
    tiers: 1,
    crateHeightM: REAL_CRATE_HEIGHT_M_OD1073M,
  })

  it('reproduces the drawn single-tier row count and total height (crib + one pipe diameter)', () => {
    expect(nest.tierCounts.length).toBe(1)
    expect(nest.heightM).toBeCloseTo(1.0 + 1.073, 6)
  })

  it('two full tiers of this diameter would exceed the 3.0 m stack-height limit (п. 2.1.2) — a real physical constraint, not a bug', () => {
    const twoTiers = computePipeNest({
      pipeOuterDiameterM: 1.073,
      pipeLengthM: 12.38,
      pipeWeightKg: 22_310,
      usableWidthM: 16.9,
      tiers: 2,
      crateHeightM: REAL_CRATE_HEIGHT_M_OD1073M,
      maxStackHeightM: 3.0,
    })
    // 1.0 + 2x1.073 = 3.146 m > 3.0 m — the second tier cannot fit given
    // this diameter's real crib height, so the function must refuse it
    // rather than silently reporting an over-height stack.
    expect(twoTiers.limited).toBe(true)
    expect(twoTiers.tierCounts.length).toBe(1)
  })
})

describe('computePipeNest — defaults and the 3.0 m limit (ДВТК п. 2.1.2)', () => {
  it('defaults to exactly 2 tiers (the document\'s own stated rule) when neither pipeCount nor tiers is given', () => {
    const nest = computePipeNest({
      pipeOuterDiameterM: 0.957,
      pipeLengthM: 12.38,
      pipeWeightKg: 15_000,
      usableWidthM: 16.9,
    })
    expect(nest.requestedTiers).toBe(DEFAULT_TIERS)
    expect(nest.tierCounts.length).toBe(2)
    expect(nest.tierCounts).toEqual([17, 17])
    expect(nest.pipeCount).toBe(34)
  })

  it('truncates a request that would exceed maxStackHeightM, and stays under it', () => {
    const nest = computePipeNest({
      pipeOuterDiameterM: 0.957,
      pipeLengthM: 12.38,
      pipeWeightKg: 15_000,
      usableWidthM: 16.9,
      tiers: 5,
      maxStackHeightM: 1.0,
    })
    expect(nest.limited).toBe(true)
    expect(nest.tierCounts.length).toBeLessThan(5)
    expect(nest.heightM).toBeLessThanOrEqual(1.0 + 1e-9)
  })

  it('does not limit a request that already fits', () => {
    const nest = computePipeNest({
      pipeOuterDiameterM: 0.957,
      pipeLengthM: 12.38,
      pipeWeightKg: 15_000,
      usableWidthM: 16.9,
      tiers: 2,
      maxStackHeightM: 3.0,
    })
    expect(nest.limited).toBe(false)
    expect(nest.tierCounts.length).toBe(2)
  })
})

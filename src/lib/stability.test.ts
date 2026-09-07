import { describe, it, expect } from 'vitest'
import {
  computeItemVCG,
  computeLoadingCondition,
  buildLoadingConditionFromPlacements,
  buildCargoWeightMoments,
  lookupHydrostatics,
  computeStabilityResult,
  computeGZCurve,
  checkIMOCriteria,
  computeFreeSurfaceCorrection,
  G_METACENTRIC_MIN_SAFE,
  type VesselStabilityData,
  type DeckShipFrame,
  type HydrostaticTable,
  type WeightMoment,
  type VariableWeightItem,
} from './stability'
import { polygonCentroid } from './packing'

describe('computeItemVCG', () => {
  it('defaults to half the stacked height above the deck', () => {
    expect(computeItemVCG({ height: 2, layers: 3 })).toBe(3) // 2*3/2
  })

  it('coerces missing/invalid layers to 1', () => {
    expect(computeItemVCG({ height: 2, layers: 0 })).toBe(1)
    expect(computeItemVCG({ height: 2, layers: NaN })).toBe(1)
  })

  it('an explicit override always wins over the geometric default', () => {
    expect(computeItemVCG({ height: 2, layers: 3, stabilityOverride: { vcgAboveDeckM: 0.5 } })).toBe(0.5)
  })
})

describe('computeLoadingCondition', () => {
  it('computes weighted KG/TCG/LCG by hand-verified numbers', () => {
    const lightship: WeightMoment = { weightKg: 500_000, vcgM: 6.0, tcgM: 0, lcgM: 0 }
    const cargo: WeightMoment[] = [{ weightKg: 50_000, vcgM: 8.0, tcgM: 5.0, lcgM: 2.0 }]
    const res = computeLoadingCondition(lightship, cargo)
    expect(res.totalDisplacementKg).toBe(550_000)
    // (500000*6 + 50000*8) / 550000 = 6.181818...
    expect(res.KG).toBeCloseTo(6.181818, 5)
    // (500000*0 + 50000*5) / 550000
    expect(res.overallTCG).toBeCloseTo(0.454545, 5)
    // (500000*0 + 50000*2) / 550000
    expect(res.overallLCG).toBeCloseTo(0.181818, 5)
  })

  it('falls back to the lightship figures alone when total displacement is zero', () => {
    const lightship: WeightMoment = { weightKg: 0, vcgM: 6.0, tcgM: 0, lcgM: 1.5 }
    const res = computeLoadingCondition(lightship, [])
    expect(res.totalDisplacementKg).toBe(0)
    expect(res.KG).toBe(6.0)
    expect(res.overallLCG).toBe(1.5)
  })
})

describe('buildLoadingConditionFromPlacements', () => {
  const vessel: VesselStabilityData = {
    particulars: {
      lengthBpp: 80,
      breadth: 18,
      lightshipWeightKg: 2_000_000,
      lightshipKG: 5.0,
      lightshipLCG: 0,
      lightshipTCG: 0,
      longitudinalOrigin: 'midships',
    },
    hydrostatics: { points: [] },
    variableWeights: [],
  }
  const shipFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 4.0 }

  it('a box centered exactly on a 20x8 deck contributes zero TCG (dead center)', () => {
    const placements = [{ x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }]
    const loading = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placements)
    // Center at (10, 4) == deck center (20/2, 8/2) exactly.
    const cargoContribution = loading.overallTCG * loading.totalDisplacementKg
    expect(cargoContribution).toBeCloseTo(0, 6)
  })

  it('deckForwardIsPositiveY=true: a placement further along +y (toward the bow, per DeckConfig\'s own doc comment) gets a MORE POSITIVE lcgM than one nearer y=0', () => {
    // Pins the ABSOLUTE sign, not just "forward and aft give opposite
    // signs" (the pre-existing test below is symmetric under swapping
    // which literal each ternary branch returns, so it cannot catch that
    // specific mutation on its own).
    const nearBow = { x: 9, y: 7, width: 2, length: 1, height: 1, layers: 1, weight: 10_000 } // y close to deckLength=8
    const nearStern = { x: 9, y: 0, width: 2, length: 1, height: 1, layers: 1, weight: 10_000 } // y close to 0
    const bow = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, [nearBow])
    const stern = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, [nearStern])
    expect(bow.overallLCG).toBeGreaterThan(stern.overallLCG)
  })

  it('respects deckForwardIsPositiveY sign convention for LCG', () => {
    const placements = [{ x: 0, y: 0, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }]
    // Footprint center (1,1), deck center (10,4) -> alongDeckFromMid = 1-4 = -3
    const forward = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placements)
    const aft = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, false, placements)
    expect(forward.overallLCG).not.toBe(0)
    // Flipping the convention must flip the sign of the resulting offset.
    expect(forward.overallLCG).toBeCloseTo(-aft.overallLCG, 6)
  })

  it('ignores placements with no weight (never divides by a phantom mass)', () => {
    const placements = [{ x: 0, y: 0, width: 2, length: 2, height: 1, layers: 1 }]
    const loading = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placements)
    expect(loading.totalDisplacementKg).toBe(vessel.particulars.lightshipWeightKg)
  })

  it('a nonzero lightshipTCG contributes to overallTCG even on an empty deck (regression: was hardcoded to 0)', () => {
    const listedVessel: VesselStabilityData = {
      ...vessel,
      particulars: { ...vessel.particulars, lightshipTCG: 0.4 },
    }
    const loading = buildLoadingConditionFromPlacements(listedVessel, shipFrame, { width: 20, length: 8 }, true, [])
    // No cargo at all -> overallTCG must equal the lightship's own TCG exactly.
    expect(loading.overallTCG).toBeCloseTo(0.4, 6)
  })

  it('variable weights (tanks/ballast) contribute to the loading condition alongside deck cargo', () => {
    const variableWeights: VariableWeightItem[] = [
      { id: 'w1', name: 'Балласт', weightKg: 100_000, vcgM: 1.0, tcgM: 2.0, lcgM: 0, freeSurfaceMomentTm: 0 },
    ]
    const vesselWithTank: VesselStabilityData = { ...vessel, variableWeights }
    const placements = [{ x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }] // dead-center, 0 own TCG contribution
    const loading = buildLoadingConditionFromPlacements(vesselWithTank, shipFrame, { width: 20, length: 8 }, true, placements)
    // Total = lightship 2_000_000 + tank 100_000 + cargo 10_000
    expect(loading.totalDisplacementKg).toBe(2_110_000)
    // overallTCG = (2_000_000*0 + 100_000*2.0 + 10_000*0) / 2_110_000
    expect(loading.overallTCG).toBeCloseTo(200_000 / 2_110_000, 6)
  })
})

describe('computeFreeSurfaceCorrection', () => {
  it('FSC = sum(FSM in t*m) / displacement in tonnes, hand-verified', () => {
    const weights: VariableWeightItem[] = [
      { id: 'w1', name: 'Танк 1', weightKg: 10_000, vcgM: 1, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: 50 },
      { id: 'w2', name: 'Танк 2', weightKg: 10_000, vcgM: 1, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: 30 },
    ]
    // Δ = 4000 t -> FSC = (50+30) / 4000 = 0.02 m
    expect(computeFreeSurfaceCorrection(weights, 4_000_000)).toBeCloseTo(0.02, 6)
  })

  it('is zero when no variable weight carries a free surface moment (regression: no tanks entered behaves like before)', () => {
    const weights: VariableWeightItem[] = [{ id: 'w1', name: 'Танк', weightKg: 10_000, vcgM: 1, tcgM: 0, lcgM: 0 }]
    expect(computeFreeSurfaceCorrection(weights, 4_000_000)).toBe(0)
    expect(computeFreeSurfaceCorrection([], 4_000_000)).toBe(0)
  })

  it('is zero at zero displacement (no division by zero)', () => {
    expect(computeFreeSurfaceCorrection([{ id: 'w1', name: 'Т', weightKg: 0, vcgM: 0, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: 50 }], 0)).toBe(0)
  })
})

describe('buildCargoWeightMoments — polygon centroid + TCG/LCG override', () => {
  const deckFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }

  it('an L-shaped outline uses the true polygon centroid, not the bounding-box center', () => {
    // An L occupying the left column and bottom row of a 4x4 box — its
    // bbox center is (2,2), but mass is concentrated toward the bottom-left,
    // so the true centroid must land measurably below-and-left of (2,2).
    const lOutline = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]
    const placement = { x: 10, y: 10, width: 4, length: 4, height: 1, layers: 1, weight: 1000, outline: lOutline }
    const [moment] = buildCargoWeightMoments([placement], 20, 8, deckFrame, true)
    const bboxCenterTcg = 10 + 2 - 20 / 2 // what it WOULD be using the bbox center
    expect(moment.tcgM).not.toBeCloseTo(bboxCenterTcg, 3)
  })

  it('a box (no outline) still uses the bounding-box center (no regression for ordinary cargo)', () => {
    const placement = { x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 1000 }
    const [moment] = buildCargoWeightMoments([placement], 20, 8, deckFrame, true)
    expect(moment.tcgM).toBeCloseTo(0, 6) // dead center, same as the existing bbox-based test above
  })

  it('rotating an outlined item rotates which vertices its centroid is computed from', () => {
    const lOutline = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]
    const unrotated = { x: 10, y: 2, width: 4, length: 4, height: 1, layers: 1, weight: 1000, outline: lOutline, rotated: false }
    const rotated = { x: 10, y: 2, width: 4, length: 4, height: 1, layers: 1, weight: 1000, outline: lOutline, rotated: true }
    const [mUnrotated] = buildCargoWeightMoments([unrotated], 20, 8, deckFrame, true)
    const [mRotated] = buildCargoWeightMoments([rotated], 20, 8, deckFrame, true)
    // A 90-degree rotation of an asymmetric L must move its centroid — TCG/LCG can't be identical before/after.
    expect(mRotated.tcgM === mUnrotated.tcgM && mRotated.lcgM === mUnrotated.lcgM).toBe(false)
  })

  it('stabilityOverride.tcgOffsetM/lcgOffsetM shift the auto-computed arm by exactly the given amount', () => {
    const base = { x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 1000 }
    const withOverride = { ...base, stabilityOverride: { tcgOffsetM: 1.5, lcgOffsetM: -0.7 } }
    const [mBase] = buildCargoWeightMoments([base], 20, 8, deckFrame, true)
    const [mOverride] = buildCargoWeightMoments([withOverride], 20, 8, deckFrame, true)
    expect(mOverride.tcgM).toBeCloseTo(mBase.tcgM + 1.5, 6)
    expect(mOverride.lcgM).toBeCloseTo(mBase.lcgM - 0.7, 6)
  })
})

describe('polygonCentroid', () => {
  it('a rectangle centroid matches its known geometric center', () => {
    const rect = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]
    expect(polygonCentroid(rect)).toEqual({ x: 2, y: 1 })
  })

  it('a right triangle centroid matches the known formula (average of vertices)', () => {
    const tri = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 3 }]
    const c = polygonCentroid(tri)
    expect(c.x).toBeCloseTo(2, 6) // (0+6+0)/3
    expect(c.y).toBeCloseTo(1, 6) // (0+0+3)/3
  })

  it('an L-shape centroid is NOT the bounding-box center', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]
    const c = polygonCentroid(lShape)
    expect(c).not.toEqual({ x: 2, y: 2 }) // bbox center of the 4x4 box
  })
})

describe('lookupHydrostatics', () => {
  const table: HydrostaticTable = {
    points: [
      { displacementKg: 1_000_000, draftM: 3.0, KM: 9.0, LCB: 1.0, LCF: 0.5, MTC: 50 },
      { displacementKg: 2_000_000, draftM: 4.0, KM: 8.5, LCB: 0.8, LCF: 0.3, MTC: 60 },
    ],
  }

  it('linearly interpolates KM between two table rows', () => {
    const res = lookupHydrostatics(table, 1_500_000)
    expect(res).not.toBeNull()
    expect(res!.KM).toBeCloseTo(8.75, 6) // midpoint
    expect(res!.MTC).toBeCloseTo(55, 6)
    expect(res!.extrapolated).toBe(false)
  })

  it('flags extrapolation below the lowest table row', () => {
    const res = lookupHydrostatics(table, 500_000)
    expect(res!.KM).toBe(9.0) // clamped to first row's value
    expect(res!.extrapolated).toBe(true)
  })

  it('flags extrapolation above the highest table row', () => {
    const res = lookupHydrostatics(table, 3_000_000)
    expect(res!.KM).toBe(8.5)
    expect(res!.extrapolated).toBe(true)
  })

  it('a single-point table is only non-extrapolated exactly at that displacement', () => {
    const single: HydrostaticTable = { points: [{ displacementKg: 1_500_000, draftM: 3.5, KM: 8.8 }] }
    expect(lookupHydrostatics(single, 1_500_000)!.extrapolated).toBe(false)
    expect(lookupHydrostatics(single, 1_600_000)!.extrapolated).toBe(true)
  })

  it('returns null for an empty table', () => {
    expect(lookupHydrostatics({ points: [] }, 1_000_000)).toBeNull()
  })
})

describe('computeStabilityResult', () => {
  const vessel: VesselStabilityData = {
    particulars: {
      lengthBpp: 80,
      breadth: 18,
      lightshipWeightKg: 2_000_000,
      lightshipKG: 5.0,
      lightshipLCG: 0,
      lightshipTCG: 0,
      longitudinalOrigin: 'midships',
    },
    hydrostatics: {
      points: [
        { displacementKg: 2_000_000, draftM: 4.0, KM: 7.0, LCB: 0, LCF: 0, MTC: 100 },
      ],
    },
    variableWeights: [],
  }

  it('computes GM as KM minus KG', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    const res = computeStabilityResult(vessel, loading)!
    expect(res.GM_solid).toBeCloseTo(1.0, 6) // 7.0 - 6.0
  })

  it('computes list angle via the small-angle atan(TCG/GM) formula', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0.05, overallLCG: 0 }
    const res = computeStabilityResult(vessel, loading)!
    // atan(0.05/1.0) in degrees
    expect(res.listDeg).toBeCloseTo((Math.atan(0.05) * 180) / Math.PI, 6)
    expect(res.listSide).toBe('starboard')
    expect(res.listReliable).toBe(true)
  })

  it('flags list as unreliable past the small-angle limit', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.5, overallTCG: 0.3, overallLCG: 0 } // GM=0.5, TCG/GM=0.6 -> ~31deg
    const res = computeStabilityResult(vessel, loading)!
    expect(res.listReliable).toBe(false)
  })

  it('reports trimM as null when the hydrostatic point has no LCB/MTC', () => {
    const noTrimVessel: VesselStabilityData = {
      ...vessel,
      hydrostatics: { points: [{ displacementKg: 2_000_000, draftM: 4.0, KM: 7.0 }] },
    }
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 1.0 }
    const res = computeStabilityResult(noTrimVessel, loading)!
    expect(res.trimM).toBeNull()
    expect(res.trimDirection).toBeNull()
  })

  it('computes trim when LCB/MTC are present', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 1.0 } // LCG - LCB = 1.0
    const res = computeStabilityResult(vessel, loading)!
    // trimmingMoment = (1.0) * (2_000_000/1000) t = 2000 t*m; trimCm = 2000/100 = 20cm = 0.2m
    expect(res.trimM).toBeCloseTo(0.2, 6)
    expect(res.trimDirection).toBe('by-head')
  })

  it('returns null when the hydrostatic table is empty', () => {
    const emptyVessel: VesselStabilityData = { ...vessel, hydrostatics: { points: [] } }
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    expect(computeStabilityResult(emptyVessel, loading)).toBeNull()
  })
})

describe('computeGZCurve + checkIMOCriteria', () => {
  const vessel: VesselStabilityData = {
    particulars: {
      lengthBpp: 80,
      breadth: 18,
      lightshipWeightKg: 2_000_000,
      lightshipKG: 5.0,
      lightshipLCG: 0,
      lightshipTCG: 0,
      longitudinalOrigin: 'midships',
    },
    hydrostatics: { points: [{ displacementKg: 2_000_000, draftM: 4.0, KM: 7.0, LCB: 0, LCF: 0, MTC: 100 }] },
    variableWeights: [],
    knCurves: {
      headingAngles: [0, 10, 20, 30, 40],
      points: [
        { displacementKg: 2_000_000, KNByAngle: [0, 1.2, 2.3, 3.1, 3.6] },
      ],
    },
  }

  it('computes GZ = KN - KG*sin(heel) at each tabulated angle, hand-verified', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    const gz = computeGZCurve(vessel, loading)!
    const rad = (d: number) => (d * Math.PI) / 180
    expect(gz.curve[0].GZ).toBeCloseTo(0 - 6.0 * Math.sin(rad(0)), 6)
    expect(gz.curve[1].GZ).toBeCloseTo(1.2 - 6.0 * Math.sin(rad(10)), 6)
    expect(gz.curve[3].GZ).toBeCloseTo(3.1 - 6.0 * Math.sin(rad(30)), 6)
  })

  it('applies the free-surface correction to the WHOLE GZ curve via an effective KG, not just the initial-GM scalar', () => {
    const vesselWithTank: VesselStabilityData = {
      ...vessel,
      variableWeights: [{ id: 'w1', name: 'Танк', weightKg: 10_000, vcgM: 1, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: 400 }],
    }
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    // FSC = 400 / (2_000_000/1000) = 0.2 -> effective KG = 6.0 + 0.2 = 6.2
    const gzWithTank = computeGZCurve(vesselWithTank, loading)!
    const gzNoTank = computeGZCurve(vessel, loading)!
    const rad30 = (30 * Math.PI) / 180
    expect(gzWithTank.curve[3].GZ).toBeCloseTo(3.1 - 6.2 * Math.sin(rad30), 6)
    // Regression: before the fix, the tank made no difference to the curve at all.
    expect(gzWithTank.curve[3].GZ).not.toBeCloseTo(gzNoTank.curve[3].GZ, 6)
    expect(gzWithTank.maxGZ).toBeLessThan(gzNoTank.maxGZ)
  })

  it('reports angle of vanishing stability as 0° (not null) when GZ is never positive at any tabulated angle', () => {
    // KG large enough that GZ is <= 0 at every angle including 0° itself
    // (GZ(0)=KN(0)-KG*sin(0)=0 always, by construction) -- the vessel is
    // already unstable at upright, not "stable throughout," which is what
    // null used to (wrongly) imply here before the fix.
    const loading = { totalDisplacementKg: 2_000_000, KG: 20.0, overallTCG: 0, overallLCG: 0 }
    const gz = computeGZCurve(vessel, loading)!
    expect(gz.maxGZ).toBeLessThanOrEqual(0)
    expect(gz.angleOfVanishingStability).toBe(0)
  })

  it('still reports null (genuinely stable throughout) when GZ is positive across the whole tabulated range', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 0.5, overallTCG: 0, overallLCG: 0 } // tiny KG -> GZ stays positive past 0deg
    const gz = computeGZCurve(vessel, loading)!
    // GZ(0deg) is always exactly 0 by construction (KN(0)=0, sin(0)=0) -
    // "positive throughout" means every angle PAST zero stays positive.
    expect(gz.curve.filter((p) => p.heelDeg > 0).every((p) => p.GZ > 0)).toBe(true)
    expect(gz.angleOfVanishingStability).toBeNull()
  })

  it('integrates area under the curve (composite Simpson) matching a hand calculation', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 } // KG=0 -> GZ==KN, simplest case
    const gz = computeGZCurve(vessel, loading)!
    // KN values: 0, 1.2, 2.3, 3.1 at 0,10,20,30 deg — 3 intervals (odd), so
    // the composite rule pairs [0,10,20] into one Simpson-1/3 segment and
    // falls back to a trapezoid for the single leftover [20,30] interval.
    const rad10 = (10 * Math.PI) / 180
    const simpsonPart = (rad10 / 3) * (0 + 4 * 1.2 + 2.3) // equal-spacing Simpson 1/3 over [0,20]
    const trapezoidPart = ((2.3 + 3.1) / 2) * rad10 // leftover [20,30]
    expect(gz.areaUnder30Deg).toBeCloseTo(simpsonPart + trapezoidPart, 6)
  })

  it('Simpson integration diverges from a plain trapezoidal sum on this concave curve (proves the method actually changed)', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }
    const gz = computeGZCurve(vessel, loading)!
    const rad10 = (10 * Math.PI) / 180
    const oldTrapezoidalArea = ((0 + 1.2) / 2) * rad10 + ((1.2 + 2.3) / 2) * rad10 + ((2.3 + 3.1) / 2) * rad10
    expect(gz.areaUnder30Deg).not.toBeCloseTo(oldTrapezoidalArea, 6)
  })

  it('Simpson integration matches plain trapezoid on a perfectly linear GZ curve (regression: exact case stays exact)', () => {
    // A linear KN(angle) relation (with KG=0, so GZ=KN) is integrated
    // exactly by both the trapezoid rule and Simpson's rule — this is the
    // one case where switching methods must NOT change the result.
    const linearVessel: VesselStabilityData = {
      ...vessel,
      knCurves: {
        headingAngles: [0, 10, 20, 30, 40],
        points: [{ displacementKg: 2_000_000, KNByAngle: [0, 1, 2, 3, 4] }], // KN = angle/10, perfectly linear
      },
    }
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }
    const gz = computeGZCurve(linearVessel, loading)!
    const rad10 = (10 * Math.PI) / 180
    const trapezoidArea = ((0 + 1) / 2 + (1 + 2) / 2 + (2 + 3) / 2 + (3 + 4) / 2) * rad10
    expect(gz.areaUnder40Deg).toBeCloseTo(trapezoidArea, 6)
  })

  it('returns null when no cross-curves are set', () => {
    const noKn: VesselStabilityData = { ...vessel, knCurves: undefined }
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    expect(computeGZCurve(noKn, loading)).toBeNull()
  })

  // Regression: computeGZCurve trusted the KN table's angle array without
  // checking it — the whole curve (and angleOfVanishingStability especially,
  // which relies on GZ(0°) being exactly 0 "by construction") is built on
  // an invariant the table never actually enforced. A malformed table used
  // to silently produce a confidently-wrong curve instead of refusing it.
  it('returns null when headingAngles are not strictly ascending (unsorted or duplicate)', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    const unsorted: VesselStabilityData = {
      ...vessel,
      knCurves: { headingAngles: [0, 20, 10, 30, 40], points: vessel.knCurves!.points },
    }
    expect(computeGZCurve(unsorted, loading)).toBeNull()

    const duplicate: VesselStabilityData = {
      ...vessel,
      knCurves: { headingAngles: [0, 10, 10, 30, 40], points: vessel.knCurves!.points },
    }
    expect(computeGZCurve(duplicate, loading)).toBeNull()
  })

  it('returns null when the first heading angle is not 0°', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    const noZero: VesselStabilityData = {
      ...vessel,
      knCurves: { headingAngles: [10, 20, 30, 40], points: vessel.knCurves!.points },
    }
    expect(computeGZCurve(noZero, loading)).toBeNull()
  })

  it('checkIMOCriteria: initial-GM criterion fails for a low GM and passes for a healthy one', () => {
    const lowGmLoading = { totalDisplacementKg: 2_000_000, KG: 6.9, overallTCG: 0, overallLCG: 0 } // GM = 0.10 < 0.15
    const stability = computeStabilityResult(vessel, lowGmLoading)!
    const gz = computeGZCurve(vessel, lowGmLoading)!
    const criteria = checkIMOCriteria(gz, stability)
    const gmCheck = criteria.find((c) => c.id === 'initial-gm')!
    expect(gmCheck.pass).toBe(false)
    expect(gmCheck.requiredValue).toBe(G_METACENTRIC_MIN_SAFE)

    const healthyLoading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 } // GM = 1.0
    const stability2 = computeStabilityResult(vessel, healthyLoading)!
    const gz2 = computeGZCurve(vessel, healthyLoading)!
    const gmCheck2 = checkIMOCriteria(gz2, stability2).find((c) => c.id === 'initial-gm')!
    expect(gmCheck2.pass).toBe(true)
  })

  it('checkIMOCriteria: angle-of-max-gz criterion fails when the curve peaks too early', () => {
    // Peaks at 10 deg (KN drops after), fails the >=25deg requirement.
    const earlyPeakVessel: VesselStabilityData = {
      ...vessel,
      knCurves: {
        headingAngles: [0, 10, 20, 30, 40],
        points: [{ displacementKg: 2_000_000, KNByAngle: [0, 3.0, 2.5, 2.0, 1.5] }],
      },
    }
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }
    const stability = computeStabilityResult(earlyPeakVessel, loading)!
    const gz = computeGZCurve(earlyPeakVessel, loading)!
    const criteria = checkIMOCriteria(gz, stability)
    const angleCheck = criteria.find((c) => c.id === 'angle-of-max-gz')!
    expect(angleCheck.pass).toBe(false)
    expect(angleCheck.actualValue).toBe(10)
  })

  it('checkIMOCriteria: angle-of-max-gz criterion passes when the curve peaks late enough', () => {
    // Peaks at 30 deg -> satisfies the >=25deg requirement.
    const latePeakVessel: VesselStabilityData = {
      ...vessel,
      knCurves: {
        headingAngles: [0, 10, 20, 30, 40],
        points: [{ displacementKg: 2_000_000, KNByAngle: [0, 1.0, 2.0, 3.0, 2.5] }],
      },
    }
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }
    const stability = computeStabilityResult(latePeakVessel, loading)!
    const gz = computeGZCurve(latePeakVessel, loading)!
    const angleCheck = checkIMOCriteria(gz, stability).find((c) => c.id === 'angle-of-max-gz')!
    expect(angleCheck.pass).toBe(true)
    expect(angleCheck.actualValue).toBe(30)
  })

  // A deliberately low-magnitude KN curve — every area criterion fails
  // against it, giving a clean fail case for each of the three area checks.
  const lowKNVessel: VesselStabilityData = {
    ...vessel,
    knCurves: {
      headingAngles: [0, 10, 20, 30, 40],
      points: [{ displacementKg: 2_000_000, KNByAngle: [0, 0.02, 0.04, 0.06, 0.08] }],
    },
  }
  const lowKNLoading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }
  // The shared "healthy" fixture at the top of this describe block
  // (KN=[0,1.2,2.3,3.1,3.6]) is the pass case for all three area criteria —
  // already exercised numerically in the "integrates area" test above.
  const healthyLoading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }

  it('checkIMOCriteria: area-0-30 criterion fails for a low curve and passes for a healthy one', () => {
    const failStability = computeStabilityResult(lowKNVessel, lowKNLoading)!
    const failGz = computeGZCurve(lowKNVessel, lowKNLoading)!
    expect(checkIMOCriteria(failGz, failStability).find((c) => c.id === 'area-0-30')!.pass).toBe(false)

    const passStability = computeStabilityResult(vessel, healthyLoading)!
    const passGz = computeGZCurve(vessel, healthyLoading)!
    expect(checkIMOCriteria(passGz, passStability).find((c) => c.id === 'area-0-30')!.pass).toBe(true)
  })

  it('checkIMOCriteria: area-30-40 criterion fails for a low curve and passes for a healthy one', () => {
    const failStability = computeStabilityResult(lowKNVessel, lowKNLoading)!
    const failGz = computeGZCurve(lowKNVessel, lowKNLoading)!
    expect(checkIMOCriteria(failGz, failStability).find((c) => c.id === 'area-30-40')!.pass).toBe(false)

    const passStability = computeStabilityResult(vessel, healthyLoading)!
    const passGz = computeGZCurve(vessel, healthyLoading)!
    expect(checkIMOCriteria(passGz, passStability).find((c) => c.id === 'area-30-40')!.pass).toBe(true)
  })

  it('checkIMOCriteria: area-0-40 criterion fails for a low curve and passes for a healthy one', () => {
    const failStability = computeStabilityResult(lowKNVessel, lowKNLoading)!
    const failGz = computeGZCurve(lowKNVessel, lowKNLoading)!
    expect(checkIMOCriteria(failGz, failStability).find((c) => c.id === 'area-0-40')!.pass).toBe(false)

    const passStability = computeStabilityResult(vessel, healthyLoading)!
    const passGz = computeGZCurve(vessel, healthyLoading)!
    expect(checkIMOCriteria(passGz, passStability).find((c) => c.id === 'area-0-40')!.pass).toBe(true)
  })

  it('checkIMOCriteria: gz-max-at-30 criterion fails when KG eats into GZ at 30deg, passes with a lower KG', () => {
    // GZ(30) = KN(30) - KG*sin(30) = 3.1 - 6*0.5 = 0.1 < 0.2 -> fails.
    const failLoading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    const failStability = computeStabilityResult(vessel, failLoading)!
    const failGz = computeGZCurve(vessel, failLoading)!
    expect(checkIMOCriteria(failGz, failStability).find((c) => c.id === 'gz-max-at-30')!.pass).toBe(false)

    // GZ(30) = 3.1 - 2*0.5 = 2.1 >= 0.2 -> passes.
    const passLoading = { totalDisplacementKg: 2_000_000, KG: 2.0, overallTCG: 0, overallLCG: 0 }
    const passStability = computeStabilityResult(vessel, passLoading)!
    const passGz = computeGZCurve(vessel, passLoading)!
    expect(checkIMOCriteria(passGz, passStability).find((c) => c.id === 'gz-max-at-30')!.pass).toBe(true)
  })

  it('returns all 6 criteria', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    const stability = computeStabilityResult(vessel, loading)!
    const gz = computeGZCurve(vessel, loading)!
    expect(checkIMOCriteria(gz, stability)).toHaveLength(6)
  })

  it('a downfloodingAngleDeg smaller than 30 substitutes into the area-0-30 boundary, hand-verified, and can flip PASS to FAIL', () => {
    // KN scaled so area(0-30) just clears 0.055 but area(0-25) does not —
    // demonstrates the exact false-PASS scenario the audit flagged (IS Code
    // 2.2.1 requires substituting a real, smaller downflooding angle).
    const dfVessel: VesselStabilityData = {
      ...vessel,
      knCurves: {
        headingAngles: [0, 10, 20, 30],
        points: [{ displacementKg: 2_000_000, KNByAngle: [0, 0.08, 0.16, 0.24] }],
      },
    }
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 }
    const stability = computeStabilityResult(dfVessel, loading)!
    const gz = computeGZCurve(dfVessel, loading)!

    const withoutDownflooding = checkIMOCriteria(gz, stability)
    expect(withoutDownflooding.find((c) => c.id === 'area-0-30')!.pass).toBe(true)

    const withDownflooding = checkIMOCriteria(gz, stability, 25)
    const area030 = withDownflooding.find((c) => c.id === 'area-0-30')!
    expect(area030.pass).toBe(false)
    // Hand-verified: Simpson over [0,10,20] (equal spacing) + trapezoid over [20,25] (interpolated GZ at 25 = 0.20).
    expect(area030.actualValue).toBeCloseTo(0.043633231, 6)
  })

  it('checkIMOCriteria uses GM_fluid (free-surface-corrected), not GM_solid, for the initial-GM criterion', () => {
    const vesselWithTank: VesselStabilityData = {
      ...vessel,
      variableWeights: [{ id: 'w1', name: 'Танк', weightKg: 10_000, vcgM: 1, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: 800 }],
    }
    // GM_solid = KM(7.0 from the shared fixture) - KG; pick KG so GM_solid is comfortably >= 0.15
    // but the FSC from the tank drags GM_fluid below it.
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.5, overallTCG: 0, overallLCG: 0 } // GM_solid = 0.5
    const stability = computeStabilityResult(vesselWithTank, loading)!
    const gz = computeGZCurve(vesselWithTank, loading)!
    expect(stability.GM_solid).toBeGreaterThanOrEqual(G_METACENTRIC_MIN_SAFE)
    expect(stability.GM_fluid).toBeLessThan(G_METACENTRIC_MIN_SAFE) // FSC = 800/2000 = 0.4 -> GM_fluid = 0.1
    const initialGm = checkIMOCriteria(gz, stability).find((c) => c.id === 'initial-gm')!
    expect(initialGm.pass).toBe(false)
    expect(initialGm.actualValue).toBeCloseTo(stability.GM_fluid, 6)
  })
})

// ---- Golden + mutation-guard tests from the "logical errors" audit ----
// Expected values below are computed BY HAND in each comment, independent
// of the functions under test (never `expected = productionSolver(input)`)
// — that's the whole point of a golden test. Run alongside a mutation pass
// (flip a sign, drop a multiplier, change a divisor) to confirm at least
// one of these fails for every such intentional break; if one doesn't,
// that's a real gap, not a passing suite.
describe('golden: mass, KG, GM, TCG direction (audit §35)', () => {
  it('mass: 1000 t + 200 t = 1200 t', () => {
    const lightship: WeightMoment = { weightKg: 1_000_000, vcgM: 5, tcgM: 0, lcgM: 0 }
    const cargo: WeightMoment[] = [{ weightKg: 200_000, vcgM: 10, tcgM: 0, lcgM: 0 }]
    const res = computeLoadingCondition(lightship, cargo)
    expect(res.totalDisplacementKg).toBe(1_200_000)
  })

  it('KG = (1000×5 + 200×10) / 1200 = 5.8333...', () => {
    const lightship: WeightMoment = { weightKg: 1_000_000, vcgM: 5, tcgM: 0, lcgM: 0 }
    const cargo: WeightMoment[] = [{ weightKg: 200_000, vcgM: 10, tcgM: 0, lcgM: 0 }]
    const res = computeLoadingCondition(lightship, cargo)
    expect(res.KG).toBeCloseTo(35 / 6, 9) // (1000*5 + 200*10)/1200 = 7000/1200 = 35/6 = 5.8333...
  })

  it('KG direction: raising a cargo item\'s own VCG raises overall KG, never lowers it', () => {
    const lightship: WeightMoment = { weightKg: 1_000_000, vcgM: 5, tcgM: 0, lcgM: 0 }
    const low = computeLoadingCondition(lightship, [{ weightKg: 200_000, vcgM: 6, tcgM: 0, lcgM: 0 }])
    const high = computeLoadingCondition(lightship, [{ weightKg: 200_000, vcgM: 12, tcgM: 0, lcgM: 0 }])
    expect(high.KG).toBeGreaterThan(low.KG)
  })

  it('GM direction: raising KG at a fixed KM lowers GM (GM = KM − KG)', () => {
    const vessel: VesselStabilityData = {
      particulars: {
        lengthBpp: 80, breadth: 18, lightshipWeightKg: 2_000_000, lightshipKG: 5, lightshipLCG: 0, lightshipTCG: 0,
        longitudinalOrigin: 'midships',
      },
      hydrostatics: { points: [{ displacementKg: 2_000_000, draftM: 4, KM: 8, LCB: 0, LCF: 0, MTC: 100 }] },
      variableWeights: [],
    }
    const lowKG = computeStabilityResult(vessel, { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: 0, overallLCG: 0 })!
    const highKG = computeStabilityResult(vessel, { totalDisplacementKg: 2_000_000, KG: 7, overallTCG: 0, overallLCG: 0 })!
    expect(highKG.GM_solid).toBeLessThan(lowKG.GM_solid)
    expect(lowKG.GM_solid).toBeCloseTo(2, 9) // 8 - 6
    expect(highKG.GM_solid).toBeCloseTo(1, 9) // 8 - 7
  })

  it('TCG = +2 and TCG = −2 give opposite list sides (starboard vs port)', () => {
    const vessel: VesselStabilityData = {
      particulars: {
        lengthBpp: 80, breadth: 18, lightshipWeightKg: 2_000_000, lightshipKG: 5, lightshipLCG: 0, lightshipTCG: 0,
        longitudinalOrigin: 'midships',
      },
      hydrostatics: { points: [{ displacementKg: 2_000_000, draftM: 4, KM: 7, LCB: 0, LCF: 0, MTC: 100 }] },
      variableWeights: [],
    }
    const starboard = computeStabilityResult(vessel, { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: 2, overallLCG: 0 })!
    const port = computeStabilityResult(vessel, { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: -2, overallLCG: 0 })!
    expect(starboard.listSide).toBe('starboard')
    expect(port.listSide).toBe('port')
    expect(starboard.listDeg).toBeCloseTo(port.listDeg, 9) // same magnitude, opposite side
  })
})

describe('golden: TCG sign convention is pinned, not just symmetric (audit §mutation)', () => {
  // The existing "dead center -> TCG=0" test is sign-blind: flipping
  // `originOffsetFromCenterlineM + (center.x - deckWidth/2)` to a MINUS
  // still passes it, since 0 negated is still 0. This test uses a
  // genuinely off-center placement so a sign flip changes the SIGN of the
  // result, not just its magnitude.
  const deckFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }

  it('a placement past the deck\'s starboard half (larger x) gets a positive tcgM', () => {
    // Deck width 20 -> centre at x=10. Footprint at x=14..16, center x=15,
    // well to the +x side of centre.
    const placement = { x: 14, y: 0, width: 2, length: 1, height: 1, layers: 1, weight: 1000 }
    const [m] = buildCargoWeightMoments([placement], 20, 8, deckFrame, true)
    expect(m.tcgM).toBeCloseTo(5, 6) // 15 - 10
    expect(m.tcgM).toBeGreaterThan(0)
  })

  it('a placement past the deck\'s port half (smaller x) gets a negative tcgM', () => {
    const placement = { x: 4, y: 0, width: 2, length: 1, height: 1, layers: 1, weight: 1000 }
    const [m] = buildCargoWeightMoments([placement], 20, 8, deckFrame, true)
    expect(m.tcgM).toBeCloseTo(-5, 6) // 5 - 10
    expect(m.tcgM).toBeLessThan(0)
  })
})

describe('golden: multi-tier stack weight scales EVERY consumer identically (audit §2)', () => {
  const deckFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }

  it('buildCargoWeightMoments multiplies weight by layers, not just the footprint area', () => {
    const oneTier = { x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }
    const threeTier = { ...oneTier, layers: 3 }
    const [m1] = buildCargoWeightMoments([oneTier], 20, 8, deckFrame, true)
    const [m3] = buildCargoWeightMoments([threeTier], 20, 8, deckFrame, true)
    expect(m1.weightKg).toBe(10_000)
    expect(m3.weightKg).toBe(30_000) // exactly 3x, not 1x
  })
})

describe('golden: unit-safety regression — deck-unit geometry must convert to metres before it reaches the solver (audit §1)', () => {
  const vessel: VesselStabilityData = {
    particulars: {
      lengthBpp: 80, breadth: 18, lightshipWeightKg: 2_000_000, lightshipKG: 5, lightshipLCG: 0, lightshipTCG: 0,
      longitudinalOrigin: 'midships',
    },
    hydrostatics: { points: [] },
    variableWeights: [],
  }
  const shipFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 4 }

  it('the SAME real deck/cargo geometry gives identical KG/TCG/LCG whether described in metres or feet', () => {
    // A 20m x 8m deck with a 2m x 2m, 1000kg box off-center at (0,0) — real
    // metres. Deliberately NOT the deck's own centre (unlike the existing
    // "box centered" fixture at x=9,y=3), so TCG/LCG come out genuinely
    // nonzero and the conversion actually has something to get wrong.
    const placementsM = [{ x: 0, y: 0, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }]
    const metres = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placementsM, 'm')

    // The identical real geometry, re-expressed in feet (1 m = 1/0.3048 ft).
    // This is what store/calculator.ts's setUnit actually produces when a
    // user switches the deck's display unit — real geometry preserved,
    // only the numbers' unit changes.
    const FT_PER_M = 1 / 0.3048
    const placementsFt = [{ x: 0, y: 0, width: 2 * FT_PER_M, length: 2 * FT_PER_M, height: 1 * FT_PER_M, layers: 1, weight: 10_000 }]
    const feet = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20 * FT_PER_M, length: 8 * FT_PER_M }, true, placementsFt, 'ft')

    expect(feet.KG).toBeCloseTo(metres.KG, 6)
    expect(feet.overallTCG).toBeCloseTo(metres.overallTCG, 6)
    expect(feet.overallLCG).toBeCloseTo(metres.overallLCG, 6)
    // Sanity check that this test isn't passing by coincidence (e.g. both
    // sides happening to be ~0): the cargo is genuinely off-center, so the
    // shared value itself must be meaningfully nonzero.
    expect(Math.abs(metres.overallTCG)).toBeGreaterThan(1e-6)
  })

  it('stabilityOverride.vcgAboveDeckM/tcgOffsetM/lcgOffsetM (stored in the deck\'s display unit) also convert correctly', () => {
    const placementsM = [{ x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 10_000, stabilityOverride: { vcgAboveDeckM: 1.5, tcgOffsetM: 0.5, lcgOffsetM: -0.25 } }]
    const metres = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placementsM, 'm')

    const FT_PER_M = 1 / 0.3048
    const placementsFt = [{
      x: 9 * FT_PER_M, y: 3 * FT_PER_M, width: 2 * FT_PER_M, length: 2 * FT_PER_M, height: 1 * FT_PER_M, layers: 1, weight: 10_000,
      stabilityOverride: { vcgAboveDeckM: 1.5 * FT_PER_M, tcgOffsetM: 0.5 * FT_PER_M, lcgOffsetM: -0.25 * FT_PER_M },
    }]
    const feet = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20 * FT_PER_M, length: 8 * FT_PER_M }, true, placementsFt, 'ft')

    expect(feet.KG).toBeCloseTo(metres.KG, 6)
    expect(feet.overallTCG).toBeCloseTo(metres.overallTCG, 6)
    expect(feet.overallLCG).toBeCloseTo(metres.overallLCG, 6)
  })

  it('defaults to metres (no-op) when `unit` is omitted — every existing metres-only caller keeps working unchanged', () => {
    const placements = [{ x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }]
    const withDefault = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placements)
    const explicitM = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placements, 'm')
    expect(withDefault).toEqual(explicitM)
  })
})

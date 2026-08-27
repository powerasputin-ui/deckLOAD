import { describe, it, expect } from 'vitest'
import {
  computeItemVCG,
  computeLoadingCondition,
  buildLoadingConditionFromPlacements,
  lookupHydrostatics,
  computeStabilityResult,
  computeGZCurve,
  checkIMOCriteria,
  G_METACENTRIC_MIN_SAFE,
  type VesselStabilityData,
  type DeckShipFrame,
  type HydrostaticTable,
  type WeightMoment,
} from './stability'

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
      longitudinalOrigin: 'midships',
    },
    hydrostatics: { points: [] },
  }
  const shipFrame: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 4.0 }

  it('a box centered exactly on a 20x8 deck contributes zero TCG (dead center)', () => {
    const placements = [{ x: 9, y: 3, width: 2, length: 2, height: 1, layers: 1, weight: 10_000 }]
    const loading = buildLoadingConditionFromPlacements(vessel, shipFrame, { width: 20, length: 8 }, true, placements)
    // Center at (10, 4) == deck center (20/2, 8/2) exactly.
    const cargoContribution = loading.overallTCG * loading.totalDisplacementKg
    expect(cargoContribution).toBeCloseTo(0, 6)
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
      longitudinalOrigin: 'midships',
    },
    hydrostatics: {
      points: [
        { displacementKg: 2_000_000, draftM: 4.0, KM: 7.0, LCB: 0, LCF: 0, MTC: 100 },
      ],
    },
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
      longitudinalOrigin: 'midships',
    },
    hydrostatics: { points: [{ displacementKg: 2_000_000, draftM: 4.0, KM: 7.0, LCB: 0, LCF: 0, MTC: 100 }] },
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

  it('integrates area under the curve (trapezoidal) matching a hand calculation', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 0, overallTCG: 0, overallLCG: 0 } // KG=0 -> GZ==KN, simplest case
    const gz = computeGZCurve(vessel, loading)!
    // KN values: 0, 1.2, 2.3, 3.1 at 0,10,20,30 deg. Trapezoidal area in rad:
    const rad10 = (10 * Math.PI) / 180
    const handArea = ((0 + 1.2) / 2) * rad10 + ((1.2 + 2.3) / 2) * rad10 + ((2.3 + 3.1) / 2) * rad10
    expect(gz.areaUnder30Deg).toBeCloseTo(handArea, 6)
  })

  it('returns null when no cross-curves are set', () => {
    const noKn: VesselStabilityData = { ...vessel, knCurves: undefined }
    const loading = { totalDisplacementKg: 2_000_000, KG: 6.0, overallTCG: 0, overallLCG: 0 }
    expect(computeGZCurve(noKn, loading)).toBeNull()
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
})

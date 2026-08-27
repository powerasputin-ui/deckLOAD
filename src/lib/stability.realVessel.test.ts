// Reference regression test against a REAL, class-approved loading
// calculation — not synthetic numbers.
//
// Source: ДВТК/638.362241.034 "Проект перевозки труб... А. Кузнецов" REV3,
// Таблица 3, load case "LC51-Max deck cargo Arrival" (approved via
// TRN171-UKIR for the South Kirinskoye field). Every P/LCG/TCG/VCG/FRSM
// below is transcribed verbatim from that table.
//
// The point of this file is to prove the engine reproduces a real
// surveyor's arithmetic on real data, and to pin down exactly where our
// result and the document's printed bottom line diverge — see the
// "double-counted free-surface correction" test at the end, which is a
// finding about the DOCUMENT, not a bug in the engine.

import { describe, it, expect } from 'vitest'
import {
  computeLoadingCondition,
  computeStabilityResult,
  computeFreeSurfaceCorrection,
  checkIMOCriteria,
  G_METACENTRIC_MIN_SAFE,
  type VesselStabilityData,
  type WeightMoment,
  type GZCurveResult,
  type StabilityResult,
} from './stability'
import { VESSEL_TEMPLATES } from './vesselTemplates'

const kuznetsov = VESSEL_TEMPLATES.find((t) => t.id === 'aleksey-kuznetsov')!

// Таблица 3, the two deck-cargo lines the template deliberately leaves for
// the user to place as real cargo (they are the actual pipe stack, not
// vessel-side consumables).
const DECK_LOAD_PIPES: WeightMoment = { weightKg: 2_250_000, lcgM: 19.02, tcgM: 0, vcgM: 9.1 }
const WATER_IN_PIPES: WeightMoment = { weightKg: 87_000, lcgM: 19.02, tcgM: 0, vcgM: 9.1 }

const LIGHTSHIP: WeightMoment = {
  weightKg: 4_048_700,
  lcgM: 41.213,
  tcgM: -0.02, // Таблица 3 LIGHT SHIP row TCG (the template stores 0 — see test below)
  vcgM: 7.758,
}

describe('real approved loading calculation — А. Кузнецов, LC51 Max deck cargo Arrival', () => {
  const vessel: VesselStabilityData = kuznetsov.vessel
  // Same mapping variableWeightsToMoments does internally (it is private).
  const variableMoments: WeightMoment[] = vessel.variableWeights
    .filter((w) => w.weightKg > 0)
    .map((w) => ({ weightKg: w.weightKg, vcgM: w.vcgM, tcgM: w.tcgM, lcgM: w.lcgM }))
  const cargo = [DECK_LOAD_PIPES, WATER_IN_PIPES, ...variableMoments]
  const loading = computeLoadingCondition(LIGHTSHIP, cargo)

  it('reproduces the document\'s DEADWEIGHT total (3408.0 t) from the line items', () => {
    const deadweightKg = cargo.reduce((s, i) => s + i.weightKg, 0)
    expect(deadweightKg / 1000).toBeCloseTo(3408.0, 1)
  })

  it('reproduces the document\'s DISPLACEMENT (7456.68 t)', () => {
    expect(loading.totalDisplacementKg / 1000).toBeCloseTo(7456.7, 1)
  })

  it('reproduces the document\'s LCG from КП (33.708 m)', () => {
    expect(loading.overallLCG).toBeCloseTo(33.708, 2)
  })

  it('reproduces the document\'s TCG from ДП (0.041 m)', () => {
    expect(loading.overallTCG).toBeCloseTo(0.041, 2)
  })

  it('reproduces the document\'s free-surface correction CG0 = FRSM/Δ = 0.080 m', () => {
    const fsc = computeFreeSurfaceCorrection(vessel.variableWeights, loading.totalDisplacementKg)
    // Document: FRSM 598.10 t·m / 7456.7 t = 0.080 m
    expect(fsc).toBeCloseTo(0.08, 3)
  })

  it('reproduces the document\'s trim formula Δd = Δ(LCG−LCB)/MCT ≈ −0.09 m', () => {
    const result = computeStabilityResult(vessel, loading)!
    // Document: (7456.7 × (33.708 − 33.829)) / 98.320 = −0.09 m (by the head)
    expect(result.trimM).not.toBeNull()
    expect(Math.abs(result.trimM!)).toBeCloseTo(0.09, 1)
  })

  it('reproduces the document\'s own intermediate GM0 = KMT − VCG = 2.061 m as our GM_fluid', () => {
    const result = computeStabilityResult(vessel, loading)!
    expect(result.KM).toBeCloseTo(9.604, 3)
    expect(result.GM_fluid).toBeCloseTo(2.061, 2)
  })

  // ---- The finding ----
  //
  // The document's Таблица 3 MVCG column sums EXACTLY to its own printed
  // DEADWEIGHT (24239.4) and LIGHT SHIP (31409.8) subtotals, and those sum
  // exactly to its printed DISPLACEMENT MVCG (55649.2). But
  //     55649.2 / 7456.68 = 7.463 m  (solid VCG)
  // whereas the GM table below it states VCG = 7.543 m. The difference is
  // 0.080 m — exactly the document's own CG0 (FRSM/Δ = 598.10/7456.68).
  //
  // So the "VCG" fed into the document's GM0 = KMT − VCG is the
  // FSC-corrected (fluid) VCG, making its GM0 = 2.061 already a fluid GM —
  // and the next line, GM = GM0 − CG0 = 1.981, subtracts the free-surface
  // correction a SECOND time.
  //
  // The engine, driven by the same raw line items, gets GM_fluid = 2.061,
  // matching the document's own GM0 exactly. The document's published
  // 1.981 is therefore 0.080 m CONSERVATIVE (lower GM = safer), so the
  // approved conclusion "GM > GMmin = 1.220" holds either way. This test
  // pins that reasoning so it can't silently rot.
  it('shows the document double-counts FSC: its solid VCG sums to 7.463, not the stated 7.543', () => {
    const solidVCG = loading.KG
    const fsc = computeFreeSurfaceCorrection(vessel.variableWeights, loading.totalDisplacementKg)

    expect(solidVCG).toBeCloseTo(7.463, 2)
    // The document's stated VCG is our solid VCG plus one FSC.
    expect(solidVCG + fsc).toBeCloseTo(7.543, 2)

    const result = computeStabilityResult(vessel, loading)!
    // Our GM_fluid == the document's GM0 (one FSC applied).
    expect(result.GM_fluid).toBeCloseTo(2.061, 2)
    // The document's published GM applies it twice.
    expect(result.GM_fluid - fsc).toBeCloseTo(1.981, 2)
  })

  it('still clears the vessel-specific GMmin = 1.220 m from the approved booklet', () => {
    const result = computeStabilityResult(vessel, loading)!
    // Note this is 8x the app's generic G_METACENTRIC_MIN_SAFE = 0.15 —
    // the real per-vessel minimum, interpolated from the ship's own
    // Min GM table in Final Stability Calculation No. 4749-152-006.
    expect(result.GM_fluid).toBeGreaterThan(1.22)
  })
})

describe('per-vessel minimum GM overrides the generic reference', () => {
  // A GM of 0.9 m sits in the dangerous band: comfortably above the app's
  // generic G_METACENTRIC_MIN_SAFE (0.15 m) but well below А. Кузнецов's
  // real approved minimum (1.220 m). Before minGM existed the app showed a
  // green PASS here; it must now fail.
  const gz: GZCurveResult = {
    curve: [
      { heelDeg: 0, GZ: 0 },
      { heelDeg: 30, GZ: 0.5 },
      { heelDeg: 40, GZ: 0.45 },
    ],
    maxGZ: 0.5,
    angleOfMaxGZ: 30,
    angleOfVanishingStability: null,
    areaUnder30Deg: 0.1,
    areaUnder40Deg: 0.18,
    area30to40: 0.08,
  }
  const stability = { GM_fluid: 0.9 } as StabilityResult

  it('PASSES against the generic 0.15 m reference when no vessel minimum is given', () => {
    const gm = checkIMOCriteria(gz, stability).find((c) => c.id === 'initial-gm')!
    expect(gm.requiredValue).toBe(G_METACENTRIC_MIN_SAFE)
    expect(gm.pass).toBe(true)
  })

  it('FAILS the same GM once the vessel\'s own approved minimum (1.220 m) is supplied', () => {
    const gm = checkIMOCriteria(gz, stability, undefined, 1.22).find((c) => c.id === 'initial-gm')!
    expect(gm.requiredValue).toBe(1.22)
    expect(gm.pass).toBe(false)
    expect(gm.description).toContain('ФОРМУЛЯР')
  })
})

describe('template fidelity to the source document', () => {
  it('carries the lightship TCG the document actually states (−0.020 m), not an assumed zero', () => {
    // Таблица 3 LIGHT SHIP row: TCG от ДП = −0.020 m, MTCG = −81.0 t·m.
    // A silently-zeroed lightship TCG understates the vessel's built-in
    // list bias, so the template must carry the real figure.
    expect(kuznetsov.vessel.particulars.lightshipTCG).toBeCloseTo(-0.02, 3)
  })
})

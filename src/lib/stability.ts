// Ship stability calculator (GM, list, trim, and — once cross-curve data is
// available — a full righting-arm (GZ) curve checked against IMO IS Code
// 2008 Part A general criteria).
//
// IMPORTANT — this is a planning/indicative tool, NOT a class-approved
// loading instrument. Real onboard loading computers (NAPA, GHS, Autohydro/
// Load-Master) are calibrated to and type-approved against one specific
// vessel's own hydrostatic data by its classification society (DNV, LR,
// ABS, РС) — see the UI disclaimer wherever these numbers are shown.
// This module deliberately does NOT implement the IMO IS Code weather
// criterion (§2.3): offshore supply vessels are explicitly exempted from
// it and instead require an "equivalent alternative criteria" that is
// vessel/flag-state specific — there is no single formula to substitute.
//
// Pure functions/types only, no React/store imports — mirrors packing.ts's
// checkZoneLoads/checkLashingBalance (compute live from current state,
// nothing cached here).

import type { StabilityOverride } from './packing'

// ---- Vessel particulars (from the vessel's Stability Booklet) ----

export interface VesselParticulars {
  name?: string
  lengthBpp: number // m, length between perpendiculars
  breadth: number // m — used only as a plausibility bound for list angle
  lightshipWeightKg: number
  lightshipKG: number // m above baseline
  lightshipLCG: number // m, sign/origin per longitudinalOrigin
  // Stability booklets are NOT consistent about where LCG/LCF/LCB are
  // measured from — some use midships, some the aft perpendicular. Getting
  // this wrong silently flips the sign of every trim/list computation, so
  // it is asked explicitly rather than assumed.
  longitudinalOrigin: 'midships' | 'aft-perpendicular'
}

// ---- Hydrostatic curve, keyed by displacement ----

export interface HydrostaticPoint {
  displacementKg: number
  draftM: number
  KM: number // m above baseline — transverse metacentric height above baseline
  LCB?: number // m, longitudinal center of buoyancy — needed for trim
  LCF?: number // m, longitudinal center of flotation
  MTC?: number // t·m/cm — moment to change trim 1 cm, needed for trim
}

export interface HydrostaticTable {
  points: HydrostaticPoint[] // need not be pre-sorted — lookupHydrostatics sorts defensively
}

// ---- KN cross-curves: KN(displacement, heel angle) — unlocks a real GZ curve ----

export interface KNCrossCurves {
  headingAngles: number[] // e.g. [0,10,20,30,40,50,60] degrees
  points: { displacementKg: number; KNByAngle: number[] }[] // KNByAngle aligned index-for-index with headingAngles
}

export interface VesselStabilityData {
  particulars: VesselParticulars
  hydrostatics: HydrostaticTable
  knCurves?: KNCrossCurves // absent = Phase 1 only (GM/list/trim, no GZ curve)
}

// How the deck's own local (x,y) origin sits relative to the ship's own
// centerline/midships/baseline. Without this, a cargo placed at deck-local
// (x,y) has no meaningful transverse/longitudinal moment arm.
export interface DeckShipFrame {
  originOffsetFromCenterlineM: number // deck-local x=0 is this far from centerline (+ = starboard)
  originOffsetFromMidshipsM: number // deck-local y=0 is this far fwd(+)/aft(-) of midships/AP (per longitudinalOrigin)
  heightAboveBaselineM: number // deck surface (deck-local z=0) is this high above the keel/baseline
}

// Seed values when the user first opens the "Остойчивость судна" section —
// deliberately generic/zeroed rather than a plausible-looking guess, so an
// unfilled field reads as "you haven't entered this yet," not as data.
export const DEFAULT_VESSEL_PARTICULARS: VesselParticulars = {
  lengthBpp: 0,
  breadth: 0,
  lightshipWeightKg: 0,
  lightshipKG: 0,
  lightshipLCG: 0,
  longitudinalOrigin: 'midships',
}

export const DEFAULT_SHIP_FRAME: DeckShipFrame = {
  originOffsetFromCenterlineM: 0,
  originOffsetFromMidshipsM: 0,
  heightAboveBaselineM: 0,
}

// ---- Cargo VCG ----

// Default: half the stacked height above the deck surface — a conservative
// flat-centroid assumption. An explicit override always wins.
export function computeItemVCG(p: {
  height: number
  layers: number
  stabilityOverride?: StabilityOverride
}): number {
  if (p.stabilityOverride?.vcgAboveDeckM !== undefined) return p.stabilityOverride.vcgAboveDeckM
  const layers = Number.isFinite(p.layers) && p.layers > 0 ? p.layers : 1
  const height = Number.isFinite(p.height) && p.height > 0 ? p.height : 0
  return (height * layers) / 2
}

// ---- Displacement / KG / TCG / LCG aggregation ----

export interface WeightMoment {
  weightKg: number
  vcgM: number // above baseline
  tcgM: number // + = starboard of centerline
  lcgM: number // per VesselParticulars.longitudinalOrigin convention
}

export interface LoadingCondition {
  totalDisplacementKg: number
  KG: number
  overallTCG: number
  overallLCG: number
}

export function computeLoadingCondition(
  lightship: WeightMoment,
  cargoItems: WeightMoment[]
): LoadingCondition {
  const items = [lightship, ...cargoItems]
  const totalDisplacementKg = items.reduce((s, i) => s + Math.max(0, i.weightKg), 0)
  if (totalDisplacementKg <= 0) {
    return { totalDisplacementKg: 0, KG: lightship.vcgM, overallTCG: 0, overallLCG: lightship.lcgM }
  }
  const KG = items.reduce((s, i) => s + i.weightKg * i.vcgM, 0) / totalDisplacementKg
  const overallTCG = items.reduce((s, i) => s + i.weightKg * i.tcgM, 0) / totalDisplacementKg
  const overallLCG = items.reduce((s, i) => s + i.weightKg * i.lcgM, 0) / totalDisplacementKg
  return { totalDisplacementKg, KG, overallTCG, overallLCG }
}

// Builds one WeightMoment per rendered/placed cargo footprint from the
// packer's own placement geometry, mapping deck-local coordinates into the
// ship's own reference frame.
//
// Deck-local (x,y) is the top-left corner of a footprint's bounding box (the
// same convention packing.ts uses everywhere else); the footprint's CENTER
// is what actually has a moment arm. Deck-local x runs across the deck's
// "width" axis, y across its "length" axis — deckWidth/2 and deckLength/2
// are therefore each footprint's own centerline/midships reference before
// shipFrame's own additional offset is added.
export function buildCargoWeightMoments(
  placements: { x: number; y: number; width: number; length: number; height: number; layers: number; weight?: number; stabilityOverride?: StabilityOverride }[],
  deckWidth: number,
  deckLength: number,
  shipFrame: DeckShipFrame,
  deckForwardIsPositiveY: boolean
): WeightMoment[] {
  return placements
    .filter((p) => (p.weight ?? 0) > 0)
    .map((p) => {
      const centerX = p.x + p.width / 2
      const centerY = p.y + p.length / 2
      const tcgM = shipFrame.originOffsetFromCenterlineM + (centerX - deckWidth / 2)
      // Deck-local y grows "down" the deck rectangle (toward larger y); the
      // ship's own +fwd direction is a separate, explicit choice, since
      // there is no universal convention tying the two together.
      const alongDeckFromMid = centerY - deckLength / 2
      const lcgM = shipFrame.originOffsetFromMidshipsM + (deckForwardIsPositiveY ? alongDeckFromMid : -alongDeckFromMid)
      const vcgM = shipFrame.heightAboveBaselineM + computeItemVCG(p)
      return { weightKg: p.weight ?? 0, vcgM, tcgM, lcgM }
    })
}

export function buildLoadingConditionFromPlacements(
  vessel: VesselStabilityData,
  shipFrame: DeckShipFrame,
  deck: { width: number; length: number },
  deckForwardIsPositiveY: boolean,
  placements: { x: number; y: number; width: number; length: number; height: number; layers: number; weight?: number; stabilityOverride?: StabilityOverride }[]
): LoadingCondition {
  const lightship: WeightMoment = {
    weightKg: vessel.particulars.lightshipWeightKg,
    vcgM: vessel.particulars.lightshipKG,
    tcgM: 0,
    lcgM: vessel.particulars.lightshipLCG,
  }
  const cargo = buildCargoWeightMoments(placements, deck.width, deck.length, shipFrame, deckForwardIsPositiveY)
  return computeLoadingCondition(lightship, cargo)
}

// ---- Hydrostatic interpolation ----

export interface HydrostaticLookup {
  KM: number
  LCB?: number
  LCF?: number
  MTC?: number
  extrapolated: boolean
}

export function lookupHydrostatics(table: HydrostaticTable, displacementKg: number): HydrostaticLookup | null {
  if (!table.points || table.points.length === 0) return null
  const sorted = [...table.points].sort((a, b) => a.displacementKg - b.displacementKg)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (sorted.length === 1) {
    return { KM: first.KM, LCB: first.LCB, LCF: first.LCF, MTC: first.MTC, extrapolated: displacementKg !== first.displacementKg }
  }
  if (displacementKg <= first.displacementKg) {
    return { KM: first.KM, LCB: first.LCB, LCF: first.LCF, MTC: first.MTC, extrapolated: displacementKg < first.displacementKg }
  }
  if (displacementKg >= last.displacementKg) {
    return { KM: last.KM, LCB: last.LCB, LCF: last.LCF, MTC: last.MTC, extrapolated: displacementKg > last.displacementKg }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (displacementKg >= a.displacementKg && displacementKg <= b.displacementKg) {
      const span = b.displacementKg - a.displacementKg
      const t = span > 0 ? (displacementKg - a.displacementKg) / span : 0
      const lerp = (av?: number, bv?: number) => (av !== undefined && bv !== undefined ? av + (bv - av) * t : undefined)
      return {
        KM: a.KM + (b.KM - a.KM) * t,
        LCB: lerp(a.LCB, b.LCB),
        LCF: lerp(a.LCF, b.LCF),
        MTC: lerp(a.MTC, b.MTC),
        extrapolated: false,
      }
    }
  }
  return { KM: last.KM, LCB: last.LCB, LCF: last.LCF, MTC: last.MTC, extrapolated: true }
}

function lookupDraft(table: HydrostaticTable, displacementKg: number): number | null {
  if (!table.points || table.points.length === 0) return null
  const sorted = [...table.points].sort((a, b) => a.displacementKg - b.displacementKg)
  if (sorted.length === 1) return sorted[0].draftM
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (displacementKg <= first.displacementKg) return first.draftM
  if (displacementKg >= last.displacementKg) return last.draftM
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (displacementKg >= a.displacementKg && displacementKg <= b.displacementKg) {
      const span = b.displacementKg - a.displacementKg
      const t = span > 0 ? (displacementKg - a.displacementKg) / span : 0
      return a.draftM + (b.draftM - a.draftM) * t
    }
  }
  return last.draftM
}

// ---- GM / list / trim (Phase 1 — works with just KM points) ----

// Typical IMO IS Code minimum initial GM for general cargo ships — a
// GENERIC reference point only. It does NOT replace the specific minimum
// approved for THIS vessel in its own stability booklet, which is very
// often higher for offshore vessels carrying tall deck cargo.
export const G_METACENTRIC_MIN_SAFE = 0.15 // m

// Above this heel angle the small-angle list formula (tan θ ≈ TCG/GM) is no
// longer trustworthy — a real GZ curve (cross-curves) is required instead.
export const LIST_SMALL_ANGLE_LIMIT_DEG = 10

export interface StabilityResult {
  displacementKg: number
  draftM: number | null
  KM: number
  KG: number
  GM_solid: number
  listDeg: number
  listSide: 'port' | 'starboard' | 'none'
  listReliable: boolean // false once listDeg exceeds LIST_SMALL_ANGLE_LIMIT_DEG — small-angle formula no longer trustworthy
  trimM: number | null
  trimDirection: 'by-head' | 'by-stern' | 'even' | null
  extrapolated: boolean
  hasCrossCurves: boolean
}

export function computeStabilityResult(
  vessel: VesselStabilityData,
  loading: LoadingCondition
): StabilityResult | null {
  const hydro = lookupHydrostatics(vessel.hydrostatics, loading.totalDisplacementKg)
  if (!hydro) return null
  const GM_solid = hydro.KM - loading.KG
  // Small-angle static list: tan(list) = TCG / GM (heeling moment / righting
  // moment, both proportional to displacement, which cancels).
  const listRad = GM_solid > 0.001 ? Math.atan(Math.abs(loading.overallTCG) / GM_solid) : Math.PI / 2
  const listDeg = (listRad * 180) / Math.PI
  const listSide: StabilityResult['listSide'] =
    Math.abs(loading.overallTCG) < 1e-6 ? 'none' : loading.overallTCG > 0 ? 'starboard' : 'port'

  let trimM: number | null = null
  let trimDirection: StabilityResult['trimDirection'] = null
  if (hydro.LCB !== undefined && hydro.MTC !== undefined && hydro.MTC > 0) {
    const trimmingMomentTm = (loading.overallLCG - hydro.LCB) * (loading.totalDisplacementKg / 1000) // t·m
    const trimCm = trimmingMomentTm / hydro.MTC
    trimM = trimCm / 100
    trimDirection = Math.abs(trimM) < 1e-4 ? 'even' : trimM > 0 ? 'by-head' : 'by-stern'
  }

  return {
    displacementKg: loading.totalDisplacementKg,
    draftM: lookupDraft(vessel.hydrostatics, loading.totalDisplacementKg),
    KM: hydro.KM,
    KG: loading.KG,
    GM_solid,
    listDeg,
    listSide,
    listReliable: listDeg <= LIST_SMALL_ANGLE_LIMIT_DEG,
    trimM,
    trimDirection,
    extrapolated: hydro.extrapolated,
    hasCrossCurves: !!vessel.knCurves,
  }
}

// ---- GZ curve + IMO IS Code 2008 Part A criteria (Phase 2) ----

export interface GZPoint {
  heelDeg: number
  GZ: number
}

export interface GZCurveResult {
  curve: GZPoint[]
  maxGZ: number
  angleOfMaxGZ: number
  angleOfVanishingStability: number | null
  areaUnder30Deg: number // m·rad
  areaUnder40Deg: number // m·rad
  area30to40: number // m·rad
}

function interpolateKN(knCurves: KNCrossCurves, displacementKg: number, angleIdx: number): number {
  const sorted = [...knCurves.points].sort((a, b) => a.displacementKg - b.displacementKg)
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0].KNByAngle[angleIdx] ?? 0
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (displacementKg <= first.displacementKg) return first.KNByAngle[angleIdx] ?? 0
  if (displacementKg >= last.displacementKg) return last.KNByAngle[angleIdx] ?? 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (displacementKg >= a.displacementKg && displacementKg <= b.displacementKg) {
      const span = b.displacementKg - a.displacementKg
      const t = span > 0 ? (displacementKg - a.displacementKg) / span : 0
      const av = a.KNByAngle[angleIdx] ?? 0
      const bv = b.KNByAngle[angleIdx] ?? 0
      return av + (bv - av) * t
    }
  }
  return last.KNByAngle[angleIdx] ?? 0
}

// Trapezoidal integration of GZ(θ) over [fromDeg, toDeg], in m·rad (the unit
// IMO's area criteria are expressed in).
function integrateArea(curve: GZPoint[], fromDeg: number, toDeg: number): number {
  let area = 0
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]
    const b = curve[i + 1]
    const segFrom = Math.max(fromDeg, a.heelDeg)
    const segTo = Math.min(toDeg, b.heelDeg)
    if (segTo <= segFrom) continue
    const span = b.heelDeg - a.heelDeg
    const t0 = span > 0 ? (segFrom - a.heelDeg) / span : 0
    const t1 = span > 0 ? (segTo - a.heelDeg) / span : 1
    const gz0 = a.GZ + (b.GZ - a.GZ) * t0
    const gz1 = a.GZ + (b.GZ - a.GZ) * t1
    const widthRad = ((segTo - segFrom) * Math.PI) / 180
    area += ((gz0 + gz1) / 2) * widthRad
  }
  return area
}

export function computeGZCurve(vessel: VesselStabilityData, loading: LoadingCondition): GZCurveResult | null {
  const kn = vessel.knCurves
  if (!kn || kn.headingAngles.length === 0) return null
  const curve: GZPoint[] = kn.headingAngles.map((heelDeg, idx) => {
    const KN = interpolateKN(kn, loading.totalDisplacementKg, idx)
    const GZ = KN - loading.KG * Math.sin((heelDeg * Math.PI) / 180)
    return { heelDeg, GZ }
  })

  let maxGZ = -Infinity
  let angleOfMaxGZ = 0
  for (const p of curve) {
    if (p.GZ > maxGZ) {
      maxGZ = p.GZ
      angleOfMaxGZ = p.heelDeg
    }
  }

  // Angle of vanishing stability: first angle (past the max) where GZ
  // crosses back to <= 0, linearly interpolated between the bracketing
  // sample points. null if the curve never returns to/below zero within
  // the tabulated angle range.
  let angleOfVanishingStability: number | null = null
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]
    const b = curve[i + 1]
    if (a.GZ > 0 && b.GZ <= 0) {
      const span = b.GZ - a.GZ
      const t = span !== 0 ? (0 - a.GZ) / span : 0
      angleOfVanishingStability = a.heelDeg + (b.heelDeg - a.heelDeg) * t
      break
    }
  }

  return {
    curve,
    maxGZ,
    angleOfMaxGZ,
    angleOfVanishingStability,
    areaUnder30Deg: integrateArea(curve, 0, 30),
    areaUnder40Deg: integrateArea(curve, 0, 40),
    area30to40: integrateArea(curve, 30, 40),
  }
}

export interface StabilityCriterion {
  id: string
  description: string
  requiredValue: number
  actualValue: number
  unit: string
  pass: boolean
}

// IMO IS Code 2008, Part A, Chapter 2 general criteria — the weather
// criterion (§2.3) is deliberately NOT included here, see the module-level
// comment.
export function checkIMOCriteria(gz: GZCurveResult, stability: StabilityResult): StabilityCriterion[] {
  const results: StabilityCriterion[] = []
  results.push({
    id: 'area-0-30',
    description: 'Площадь под кривой GZ до 30° (IS Code 2008, п. 2.2.1)',
    requiredValue: 0.055,
    actualValue: gz.areaUnder30Deg,
    unit: 'м·рад',
    pass: gz.areaUnder30Deg >= 0.055,
  })
  results.push({
    id: 'area-30-40',
    description: 'Площадь под кривой GZ 30°–40° (IS Code 2008, п. 2.2.1)',
    requiredValue: 0.03,
    actualValue: gz.area30to40,
    unit: 'м·рад',
    pass: gz.area30to40 >= 0.03,
  })
  results.push({
    id: 'area-0-40',
    description: 'Площадь под кривой GZ до 40° (IS Code 2008, п. 2.2.1)',
    requiredValue: 0.09,
    actualValue: gz.areaUnder40Deg,
    unit: 'м·рад',
    pass: gz.areaUnder40Deg >= 0.09,
  })
  const gzAt30 = gz.curve.find((p) => p.heelDeg === 30)?.GZ ?? interpolateGZAt(gz.curve, 30)
  results.push({
    id: 'gz-max-at-30',
    description: 'GZ ≥ 0.20 м при угле крена ≥ 30° (IS Code 2008, п. 2.2.2)',
    requiredValue: 0.2,
    actualValue: gzAt30,
    unit: 'м',
    pass: gzAt30 >= 0.2,
  })
  results.push({
    id: 'angle-of-max-gz',
    description: 'Угол максимума GZ ≥ 25° (IS Code 2008, п. 2.2.3)',
    requiredValue: 25,
    actualValue: gz.angleOfMaxGZ,
    unit: '°',
    pass: gz.angleOfMaxGZ >= 25,
  })
  results.push({
    id: 'initial-gm',
    description: `Начальная GM ≥ ${G_METACENTRIC_MIN_SAFE} м (IS Code 2008, п. 2.2.4) — ОБЩИЙ ориентир, сверьте с формуляром остойчивости ВАШЕГО судна`,
    requiredValue: G_METACENTRIC_MIN_SAFE,
    actualValue: stability.GM_solid,
    unit: 'м',
    pass: stability.GM_solid >= G_METACENTRIC_MIN_SAFE,
  })
  return results
}

function interpolateGZAt(curve: GZPoint[], heelDeg: number): number {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]
    const b = curve[i + 1]
    if (heelDeg >= a.heelDeg && heelDeg <= b.heelDeg) {
      const span = b.heelDeg - a.heelDeg
      const t = span > 0 ? (heelDeg - a.heelDeg) / span : 0
      return a.GZ + (b.GZ - a.GZ) * t
    }
  }
  return 0
}

// Free-surface correction (FSC) would subtract from GM_solid here once a
// tank/liquid model exists (DeckConfig has none today):
//   GM_fluid = GM_solid - FSC
// Left as a documented gap, not silently ignored — see UI disclaimer.

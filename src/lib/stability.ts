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
import { polygonCentroid, rotateOutline90 } from './packing'
import { type Unit, toMeters } from './units'

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
  lightshipTCG: number // m, + = starboard of centerline — a real lightship rarely sits at exactly TCG=0
  // Angle (deg) at which downflooding actually occurs on THIS vessel (open
  // vents, unsecured hatches, etc). IS Code 2008 2.2.1 requires substituting
  // this for the standard 30°/40° area boundaries when it is smaller.
  // undefined = not known — standard 30°/40° boundaries are used as-is.
  downfloodingAngleDeg?: number
  // THIS vessel's own approved minimum GM for the load case at hand, read
  // off the Min GM table in its class-approved stability booklet. Offshore
  // vessels carrying tall deck cargo routinely require far more than the
  // generic G_METACENTRIC_MIN_SAFE below — the real А. Кузнецов figure is
  // 1.220 m, over eight times it — so a green "PASS" against the generic
  // number can badly mislead. Whenever this is set it REPLACES the generic
  // constant everywhere the criteria and UI are checked.
  // undefined = not known; the generic reference is used and labelled as such.
  minGM?: number
  // Windage ("парусность") — the lateral area the wind acts on, and the
  // height of its centre above the waterline. Together with a navigation
  // area's wind pressure they give the wind heeling arm used by the
  // РД 31.11.21.23-96 cargo non-shift criterion. Both come from the
  // vessel's own approved calculation; neither is derivable from anything
  // else the app knows, so undefined means "not available", never zero.
  windageAreaM2?: number
  windageLeverM?: number
  // Block coefficient Cb — needed for the roll-amplitude multiplier X2 in
  // РД 31.11.21.16-2003 Приложение 5, табл. 5.3.
  blockCoefficient?: number
}

// A generic "everything that is not lightship and not deck cargo" weight —
// tanks, ballast, fuel, fresh water, stores, crew. One shared shape (not
// three separate "Tank"/"Ballast"/"Consumable" types) because the physics
// (weight + CG + optional free surface) is identical; `name` is free text
// so the user can label it however their own stability booklet does.
export interface VariableWeightItem {
  id: string
  name: string
  weightKg: number
  vcgM: number
  tcgM: number // + = starboard
  lcgM: number
  // t·m, from the vessel's own trim-and-stability booklet / sounding
  // tables. undefined = this weight has no free surface (pressed
  // full/empty tank, solid stores, etc) — NOT the same as 0, which would
  // still say "checked, genuinely zero."
  freeSurfaceMomentTm?: number
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
  variableWeights: VariableWeightItem[] // tanks/ballast/fuel/water/stores — see VariableWeightItem
}

// How the deck's own local (x,y) frame sits relative to the ship's own
// centerline/midships-or-AP/baseline. Without this, a cargo placed at
// deck-local (x,y) has no meaningful transverse/longitudinal moment arm.
//
// CORRECTNESS NOTE: both offsets below locate the deck rectangle's own
// GEOMETRIC CENTRE on the ship's axes, not deck-local (x=0, y=0) as an
// earlier version of this comment claimed — buildCargoWeightMoments
// computes each item's arm as `originOffsetFromCenterlineM +
// (center.x - deckWidth/2)` and `originOffsetFromMidshipsM +
// (center.y - deckLength/2)`, i.e. the offset is added to a position
// already re-centred on the deck's own middle. A value entered as "the
// deck's aft edge is 3 m from the AP" is off by half the deck's own length
// from what the formula actually uses. See vesselTemplates.ts's own note
// on how the bundled Aleksey Kuznetsov figure was derived correctly by
// reasoning in these (real) semantics rather than the comment's old
// (wrong) ones.
export interface DeckShipFrame {
  originOffsetFromCenterlineM: number // the deck rectangle's own CENTRE is this far from centerline (+ = starboard)
  originOffsetFromMidshipsM: number // the deck rectangle's own CENTRE is this far fwd(+)/aft(-) of midships/AP (per longitudinalOrigin)
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
  lightshipTCG: 0,
  longitudinalOrigin: 'midships',
}

export const DEFAULT_SHIP_FRAME: DeckShipFrame = {
  originOffsetFromCenterlineM: 0,
  originOffsetFromMidshipsM: 0,
  heightAboveBaselineM: 0,
}

// ---- Cargo VCG ----

// Default: half the stacked height above the deck surface — a conservative
// flat-centroid assumption, correct for a plain column of identical units.
// A real nested pipe штабель (src/lib/pipeNest.ts) is NOT a uniform
// column — its true weighted centroid sits well below half the stack
// height, since more pipes sit in the lower, wider rows — so a nest's own
// computed VCG (`nestVcgAboveDeckM`) takes precedence over this default
// whenever it's present. An explicit user override always wins over both.
export function computeItemVCG(p: {
  height: number
  layers: number
  stabilityOverride?: StabilityOverride
  nestVcgAboveDeckM?: number
}): number {
  if (p.stabilityOverride?.vcgAboveDeckM !== undefined) return p.stabilityOverride.vcgAboveDeckM
  const layers = Number.isFinite(p.layers) && p.layers > 0 ? p.layers : 1
  const height = Number.isFinite(p.height) && p.height > 0 ? p.height : 0
  if (p.nestVcgAboveDeckM !== undefined) {
    // Defense in depth: a nest-shaped item is meant to always have
    // `layers === 1` (PresetsBar.tsx pins `maxLayers: 1` on every штабель
    // it creates), but if one somehow ends up stacked N-high anyway (a
    // hand-edited/imported project, a future caller that forgets the cap),
    // `nestVcgAboveDeckM` alone describes only ONE штабель's own internal
    // VCG — silently ignoring `layers` would apply the full N-tier weight
    // at a single штабель's height, understating KG. Each additional
    // identical штабель sits a full `height` higher than the one below it,
    // so the weighted average VCG across N equal-weight tiers is the base
    // штабель's VCG plus half the added height: for tier k (0-indexed),
    // VCG_k = k*height + nestVcgAboveDeckM; averaging k=0..layers-1 gives
    // nestVcgAboveDeckM + height*(layers-1)/2.
    return p.nestVcgAboveDeckM + (height * (layers - 1)) / 2
  }
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
  // Every current caller already pre-filters non-positive weight before
  // building a WeightMoment (buildCargoWeightMoments/variableWeightsToMoments
  // filter `weight > 0`; lightshipWeightKg is normalized non-negative on
  // load) — so this Math.max never actually fires today. It stays here as
  // this function's own contract, not a dead line: a negative weightKg used
  // to be excluded from displacement (via this same clamp) but still counted
  // in full in the KG/TCG/LCG moment sums below, which would silently let a
  // negative weight move the reported KG despite contributing nothing to the
  // displacement it's supposed to be weighted against. Clamping once, up
  // front, and reusing the clamped weight everywhere keeps that impossible
  // regardless of what a future caller passes in.
  const weightOf = (i: WeightMoment) => Math.max(0, i.weightKg)
  const totalDisplacementKg = items.reduce((s, i) => s + weightOf(i), 0)
  if (totalDisplacementKg <= 0) {
    return { totalDisplacementKg: 0, KG: lightship.vcgM, overallTCG: 0, overallLCG: lightship.lcgM }
  }
  const KG = items.reduce((s, i) => s + weightOf(i) * i.vcgM, 0) / totalDisplacementKg
  const overallTCG = items.reduce((s, i) => s + weightOf(i) * i.tcgM, 0) / totalDisplacementKg
  const overallLCG = items.reduce((s, i) => s + weightOf(i) * i.lcgM, 0) / totalDisplacementKg
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
// A placement's (TCG,LCG) moment arm defaults to its footprint's bounding-
// box center — correct for any shape with a uniform-density, symmetric
// footprint (box/cylinder/etc). For a hand-drawn `outline` (which can be
// concave — an L/Z shape), the bbox center measurably diverges from the
// true geometric centroid, so the polygon's own shoelace centroid is used
// instead whenever `outline` is present, rotated to match the placement's
// current orientation first.
function footprintCenter(p: {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: { x: number; y: number }[]
}): { x: number; y: number } {
  if (p.outline && p.outline.length >= 3) {
    // p.width/p.length are the CURRENT (post-rotation) footprint;
    // rotateOutline90 needs the box the raw outline points were originally
    // drawn against — recover it by swapping back when rotated, mirroring
    // the same correction already used in packing.ts (~line 2008) and
    // DeckVisualization.tsx/Deck3DView.tsx wherever this outline is rotated.
    const unrotatedWidth = p.rotated ? p.length : p.width
    const unrotatedLength = p.rotated ? p.width : p.length
    const local = p.rotated ? rotateOutline90(p.outline, unrotatedWidth, unrotatedLength) : p.outline
    const c = polygonCentroid(local)
    return { x: p.x + c.x, y: p.y + c.y }
  }
  return { x: p.x + p.width / 2, y: p.y + p.length / 2 }
}

export function buildCargoWeightMoments(
  placements: {
    x: number
    y: number
    width: number
    length: number
    height: number
    layers: number
    weight?: number
    rotated?: boolean
    outline?: { x: number; y: number }[]
    stabilityOverride?: StabilityOverride
    // Structurally matches (but doesn't import) packing.ts's PipeNestSpec —
    // only the one number this module actually needs.
    nest?: { vcgAboveDeckM: number }
  }[],
  deckWidth: number,
  deckLength: number,
  shipFrame: DeckShipFrame,
  deckForwardIsPositiveY: boolean
): WeightMoment[] {
  return placements
    .filter((p) => (p.weight ?? 0) > 0)
    .map((p) => {
      const center = footprintCenter(p)
      const tcgAuto = shipFrame.originOffsetFromCenterlineM + (center.x - deckWidth / 2)
      // Deck-local y grows "down" the deck rectangle (toward larger y); the
      // ship's own +fwd direction is a separate, explicit choice, since
      // there is no universal convention tying the two together.
      const alongDeckFromMid = center.y - deckLength / 2
      const lcgAuto = shipFrame.originOffsetFromMidshipsM + (deckForwardIsPositiveY ? alongDeckFromMid : -alongDeckFromMid)
      const vcgM = shipFrame.heightAboveBaselineM + computeItemVCG({ ...p, nestVcgAboveDeckM: p.nest?.vcgAboveDeckM })
      // tcgOffsetM/lcgOffsetM are a correction ADDED to the auto-computed
      // (position-derived) arm, not an absolute value — unlike
      // vcgAboveDeckM, TCG/LCG move every time the item is dragged, so an
      // absolute override would silently detach from the item on the next
      // move. An offset stays correct relative to wherever the item is now.
      const tcgM = tcgAuto + (p.stabilityOverride?.tcgOffsetM ?? 0)
      const lcgM = lcgAuto + (p.stabilityOverride?.lcgOffsetM ?? 0)
      // `weight` on a placement is the PER-UNIT weight and `layers` is how
      // many units share this one footprint (packing.ts writes
      // `weight: item.weight` alongside `layers: unitsInStack`). Every other
      // consumer in the app multiplies the two — page.tsx, StatsPanel,
      // DeckVisualization, packing.ts's own breakdown builder. This one did
      // not, so a multi-tier stack contributed a single unit's weight to
      // displacement, KG, list and trim: the load came out UNDERstated,
      // which makes the vessel look more stable than it is.
      return { weightKg: (p.weight ?? 0) * Math.max(1, p.layers ?? 1), vcgM, tcgM, lcgM }
    })
}

function variableWeightsToMoments(items: VariableWeightItem[]): WeightMoment[] {
  return items
    .filter((w) => w.weightKg > 0)
    .map((w) => ({ weightKg: w.weightKg, vcgM: w.vcgM, tcgM: w.tcgM, lcgM: w.lcgM }))
}

export function buildLoadingConditionFromPlacements(
  vessel: VesselStabilityData,
  shipFrame: DeckShipFrame,
  deck: { width: number; length: number },
  deckForwardIsPositiveY: boolean,
  placements: {
    x: number
    y: number
    width: number
    length: number
    height: number
    layers: number
    weight?: number
    rotated?: boolean
    outline?: { x: number; y: number }[]
    stabilityOverride?: StabilityOverride
    nest?: { vcgAboveDeckM: number }
  }[],
  // The deck's own unit of display (`deck.unit` in the store) — deck
  // dimensions and every placement's x/y/width/length/height/outline are
  // stored in THIS unit (see store/calculator.ts's setUnit, which converts
  // them on every unit switch), while shipFrame and every vessel figure
  // (lightshipLCG, hydrostatics, etc.) are always real metres. Without
  // converting here, switching the deck to feet or centimetres would add
  // metres to feet/cm arms and silently corrupt GM/list/trim — see
  // toMeters below. Defaults to 'm' (a no-op) so every existing caller/test
  // that already passes real metres keeps working unchanged.
  unit: Unit = 'm'
): LoadingCondition {
  const lightship: WeightMoment = {
    weightKg: vessel.particulars.lightshipWeightKg,
    vcgM: vessel.particulars.lightshipKG,
    tcgM: vessel.particulars.lightshipTCG,
    lcgM: vessel.particulars.lightshipLCG,
  }
  const deckM = { width: toMeters(deck.width, unit), length: toMeters(deck.length, unit) }
  const placementsM =
    unit === 'm'
      ? placements
      : placements.map((p) => ({
          ...p,
          x: toMeters(p.x, unit),
          y: toMeters(p.y, unit),
          width: toMeters(p.width, unit),
          length: toMeters(p.length, unit),
          height: toMeters(p.height, unit),
          outline: p.outline?.map((pt) => ({ x: toMeters(pt.x, unit), y: toMeters(pt.y, unit) })),
          // stabilityOverride.vcgAboveDeckM/tcgOffsetM/lcgOffsetM are typed
          // in metres but actually stored in the deck's display unit (see
          // ItemList.tsx's StabilityOverrideField, which labels the input
          // with `unit` and writes the raw typed number with no
          // conversion) — same leak, same fix.
          stabilityOverride: p.stabilityOverride && {
            vcgAboveDeckM:
              p.stabilityOverride.vcgAboveDeckM !== undefined ? toMeters(p.stabilityOverride.vcgAboveDeckM, unit) : undefined,
            tcgOffsetM:
              p.stabilityOverride.tcgOffsetM !== undefined ? toMeters(p.stabilityOverride.tcgOffsetM, unit) : undefined,
            lcgOffsetM:
              p.stabilityOverride.lcgOffsetM !== undefined ? toMeters(p.stabilityOverride.lcgOffsetM, unit) : undefined,
          },
          // nest.vcgAboveDeckM is computed by pipeNest.ts in real metres
          // throughout (independent of deck display unit) — left as-is.
        }))
  const cargo = buildCargoWeightMoments(placementsM, deckM.width, deckM.length, shipFrame, deckForwardIsPositiveY)
  const variable = variableWeightsToMoments(vessel.variableWeights)
  return computeLoadingCondition(lightship, [...variable, ...cargo])
}

// FSC (m) = ΣFSM(t·m) / Displacement(t) — standard free-surface correction.
// Only weights that actually carry a freeSurfaceMomentTm contribute; a tank
// with none (pressed full/empty, or solid stores) contributes 0, same as
// today's behavior when no variable weights are entered at all.
export function computeFreeSurfaceCorrection(variableWeights: VariableWeightItem[], totalDisplacementKg: number): number {
  if (totalDisplacementKg <= 0) return 0
  const totalFsmTm = variableWeights.reduce((s, w) => s + (w.freeSurfaceMomentTm ?? 0), 0)
  if (totalFsmTm === 0) return 0
  return totalFsmTm / (totalDisplacementKg / 1000)
}

// ---- Hydrostatic interpolation ----

export interface HydrostaticLookup {
  KM: number
  LCB?: number
  LCF?: number
  MTC?: number
  // true when displacementKg fell outside the table's range. Despite the
  // name, this is NOT a real slope-based extrapolation — lookupHydrostatics
  // below just clamps to the nearest endpoint's value (extrapolating a
  // vessel's own hydrostatics past its tested range is not something to do
  // silently, so clamping is the right behavior; the flag exists so callers
  // can say so honestly rather than claiming a computed extrapolation).
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
  GM_solid: number // KM - KG, WITHOUT the free-surface correction
  freeSurfaceCorrectionM: number // FSC subtracted from GM_solid to get GM_fluid
  GM_fluid: number // GM_solid - FSC — the value IS Code criteria are actually about
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
  const freeSurfaceCorrectionM = computeFreeSurfaceCorrection(vessel.variableWeights, loading.totalDisplacementKg)
  const GM_fluid = GM_solid - freeSurfaceCorrectionM
  // Small-angle static list: tan(list) = TCG / GM (heeling moment / righting
  // moment, both proportional to displacement, which cancels). Uses
  // GM_fluid — the free-surface-corrected value is what the ship actually
  // resists heeling with, not the uncorrected GM_solid.
  const listRad = GM_fluid > 0.001 ? Math.atan(Math.abs(loading.overallTCG) / GM_fluid) : Math.PI / 2
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
    freeSurfaceCorrectionM,
    GM_fluid,
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

// Composite Simpson's-rule integration of GZ(θ) over [fromDeg, toDeg], in
// m·rad (the unit IMO's area criteria are expressed in) — matches how
// class/IMO area calculations are conventionally done, replacing a plain
// trapezoidal sum (which, on the coarse angle grids typical of a
// hand-entered KN table, can measurably over- or under-estimate area
// relative to Simpson's rule, in either direction depending on curve
// shape). Supports a non-uniform angle grid (Simpson's rule for unequal
// intervals), since a user's own angle spacing is rarely uniform once
// clipped to an arbitrary [fromDeg, toDeg] window.
//
// Only integrates over the portion of [fromDeg, toDeg] that actually lies
// within the curve's own tabulated angle domain — exactly like the
// trapezoidal version this replaces, it never extrapolates GZ beyond the
// user's own data (a request for area past the last tabulated angle simply
// contributes nothing, rather than guessing GZ=0 there).
function integrateArea(curve: GZPoint[], fromDeg: number, toDeg: number): number {
  if (curve.length < 2) return 0
  const domainLo = curve[0].heelDeg
  const domainHi = curve[curve.length - 1].heelDeg
  const lo = Math.max(fromDeg, domainLo)
  const hi = Math.min(toDeg, domainHi)
  if (hi <= lo) return 0

  const nodes: { xRad: number; GZ: number }[] = []
  const push = (deg: number, gz: number) => {
    const xRad = (deg * Math.PI) / 180
    if (nodes.length === 0 || Math.abs(nodes[nodes.length - 1].xRad - xRad) > 1e-12) nodes.push({ xRad, GZ: gz })
  }
  // lo/hi are guaranteed within [domainLo, domainHi], so interpolateGZAt
  // always finds a bracketing segment here (its 0-fallback never triggers).
  push(lo, interpolateGZAt(curve, lo))
  for (const p of curve) {
    if (p.heelDeg > lo && p.heelDeg < hi) push(p.heelDeg, p.GZ)
  }
  push(hi, interpolateGZAt(curve, hi))

  return simpsonComposite(nodes)
}

// Standard composite Simpson's rule generalized to a non-uniform grid: pairs
// up consecutive intervals with the non-uniform 3-point Simpson formula; a
// single leftover interval (odd interval count) falls back to the
// trapezoid rule for just that segment — the conventional composite-Simpson
// fallback, and a rare case in practice (most user-entered angle grids plus
// the two clipped boundary points give an even interval count).
function simpsonComposite(nodes: { xRad: number; GZ: number }[]): number {
  let area = 0
  let i = 0
  while (i < nodes.length - 1) {
    if (i + 2 < nodes.length) {
      const p0 = nodes[i]
      const p1 = nodes[i + 1]
      const p2 = nodes[i + 2]
      const h0 = p1.xRad - p0.xRad
      const h1 = p2.xRad - p1.xRad
      if (h0 > 0 && h1 > 0) {
        area += ((h0 + h1) / 6) * ((2 - h1 / h0) * p0.GZ + ((h0 + h1) ** 2 / (h0 * h1)) * p1.GZ + (2 - h0 / h1) * p2.GZ)
        i += 2
        continue
      }
    }
    const a = nodes[i]
    const b = nodes[i + 1]
    area += ((a.GZ + b.GZ) / 2) * (b.xRad - a.xRad)
    i += 1
  }
  return area
}

export function computeGZCurve(vessel: VesselStabilityData, loading: LoadingCondition): GZCurveResult | null {
  const kn = vessel.knCurves
  if (!kn || kn.headingAngles.length === 0) return null
  // The rest of this function (and callers reading angleOfVanishingStability
  // — see its own comment below) rely on two invariants the KN table itself
  // never enforced: angles strictly ascending with no duplicates, and the
  // first angle being exactly 0° (so GZ(0°) really is 0 "by construction",
  // KN(0°) - KG·sin(0°) = KN(0°) - 0). A table entered out of order, with a
  // duplicate, or missing 0° silently breaks that assumption instead of
  // producing an obviously-wrong number — same treatment as "no KN data at
  // all" (null) rather than a confidently-wrong curve.
  for (let i = 1; i < kn.headingAngles.length; i++) {
    if (!(kn.headingAngles[i] > kn.headingAngles[i - 1])) return null
  }
  if (Math.abs(kn.headingAngles[0]) > 1e-6) return null
  // Free surface must reduce the WHOLE righting-arm curve, not just the
  // single initial-GM scalar — the standard treatment is a "virtual rise
  // of G" (effective KG = KG + FSC) applied everywhere GZ is computed.
  // Using raw KG here would leave every GZ-derived criterion (areas,
  // GZ-at-30°, angle of max GZ) reading as if no free surface existed,
  // even when the initial-GM criterion elsewhere correctly failed on it.
  const fsc = computeFreeSurfaceCorrection(vessel.variableWeights, loading.totalDisplacementKg)
  const effectiveKG = loading.KG + fsc
  const curve: GZPoint[] = kn.headingAngles.map((heelDeg, idx) => {
    const KN = interpolateKN(kn, loading.totalDisplacementKg, idx)
    const GZ = KN - effectiveKG * Math.sin((heelDeg * Math.PI) / 180)
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
  // the tabulated angle range — genuinely "still positive throughout what
  // was tabulated," a reassuring result.
  //
  // GZ(0°) is always exactly 0 by construction (KN(0°)=0, sin(0°)=0), so a
  // vessel with NO positive righting arm anywhere (maxGZ <= 0 — already
  // unstable at upright) would otherwise fall through this loop's `a.GZ >
  // 0` check and ALSO come out as null — collapsing two opposite physical
  // situations ("never vanishes because it's always fine" vs. "already
  // vanished because it was never positive") into the same missing value.
  // Report that case explicitly as 0deg instead.
  let angleOfVanishingStability: number | null = maxGZ <= 0 ? 0 : null
  for (let i = 0; maxGZ > 0 && i < curve.length - 1; i++) {
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
//
// downfloodingAngleDeg (optional): IS Code 2008 п. 2.2.1 requires
// substituting the vessel's actual downflooding angle for the standard
// 30°/40° area boundaries whenever it is SMALLER — a lower real
// downflooding angle means area credited beyond it is crediting righting
// arm the ship can no longer actually rely on (water is already entering
// the hull). undefined preserves today's behavior (fixed 30°/40°). This
// substitution applies ONLY to the three area criteria (2.2.1) — the
// GZ≥0.20m-at-30° (2.2.2) and angle-of-max-GZ≥25° (2.2.3) criteria are NOT
// downflooding-adjusted by the Code, so they're left untouched.
export function checkIMOCriteria(
  gz: GZCurveResult,
  stability: StabilityResult,
  downfloodingAngleDeg?: number,
  // THIS vessel's own approved minimum GM (VesselParticulars.minGM). When
  // given it replaces the generic G_METACENTRIC_MIN_SAFE in the initial-GM
  // criterion — see that field's own comment for why that matters.
  minGM?: number
): StabilityCriterion[] {
  const results: StabilityCriterion[] = []
  const boundary30 = downfloodingAngleDeg !== undefined ? Math.min(30, downfloodingAngleDeg) : 30
  const boundary40 = downfloodingAngleDeg !== undefined ? Math.min(40, downfloodingAngleDeg) : 40
  // Reuse the curve's own precomputed 0/30/40 areas when the standard
  // boundaries apply unchanged (avoids recomputation on the common path);
  // recompute from the raw curve only when downflooding actually clips a
  // boundary below its standard value.
  const areaUnder30 = boundary30 === 30 ? gz.areaUnder30Deg : integrateArea(gz.curve, 0, boundary30)
  const areaUnder40 = boundary40 === 40 ? gz.areaUnder40Deg : integrateArea(gz.curve, 0, boundary40)
  const area30to40 = boundary30 === 30 && boundary40 === 40 ? gz.area30to40 : integrateArea(gz.curve, boundary30, boundary40)

  results.push({
    id: 'area-0-30',
    description: `Площадь под кривой GZ до ${boundary30}° (IS Code 2008, п. 2.2.1)`,
    requiredValue: 0.055,
    actualValue: areaUnder30,
    unit: 'м·рад',
    pass: areaUnder30 >= 0.055,
  })
  results.push({
    id: 'area-30-40',
    description: `Площадь под кривой GZ ${boundary30}°–${boundary40}° (IS Code 2008, п. 2.2.1)`,
    requiredValue: 0.03,
    actualValue: area30to40,
    unit: 'м·рад',
    pass: area30to40 >= 0.03,
  })
  results.push({
    id: 'area-0-40',
    description: `Площадь под кривой GZ до ${boundary40}° (IS Code 2008, п. 2.2.1)`,
    requiredValue: 0.09,
    actualValue: areaUnder40,
    unit: 'м·рад',
    pass: areaUnder40 >= 0.09,
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
  const gmLimit = minGM ?? G_METACENTRIC_MIN_SAFE
  results.push({
    id: 'initial-gm',
    description:
      minGM !== undefined
        ? `Начальная GM (с поправкой на своб. поверхность) ≥ ${minGM} м — допустимый минимум ИЗ ФОРМУЛЯРА ЭТОГО СУДНА (строже общего ориентира IS Code ${G_METACENTRIC_MIN_SAFE} м)`
        : `Начальная GM (с поправкой на своб. поверхность) ≥ ${G_METACENTRIC_MIN_SAFE} м (IS Code 2008, п. 2.2.4) — ОБЩИЙ ориентир, сверьте с формуляром остойчивости ВАШЕГО судна`,
    requiredValue: gmLimit,
    actualValue: stability.GM_fluid,
    unit: 'м',
    pass: stability.GM_fluid >= gmLimit,
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

// Free-surface correction (FSC) is applied in computeStabilityResult via
// computeFreeSurfaceCorrection, above — GM_fluid = GM_solid - FSC.

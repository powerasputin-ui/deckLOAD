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

import type { CompositionSegment, StabilityOverride } from './packing'
import { polygonCentroid, rotateOutline90 } from './packing'
import { type Unit, toMeters } from './units'
// Re-exported (not just imported) — see this file's own "Cargo VCG" comment
// below for why computeItemVCG lives in stabilityMath.ts now.
import { computeItemVCG } from './stabilityMath'
export { computeItemVCG }
// Round 14: composition-aware VCG/TCG/LCG — see placementComposition.ts's own
// doc comment for why this import direction (stability.ts -> here) doesn't
// form a cycle now that computeItemVCG lives in stabilityMath.ts.
import type { CompositionCatalogItem } from './placementComposition'
import { placementTotalVCG, placementTotalTCGOffset, placementTotalLCGOffset, placementTotalWeightKg } from './placementComposition'

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
  // The single minimum GM figure calculations carried before `limit`
  // (VesselStabilityData) existed. A booklet gives its minimum GM as a
  // curve by draught, not one number — so a figure that couldn't be moved
  // into `limit` on load (see normalizeVessel in store/projects.ts) is
  // kept only to be shown as a hint.
  minGM?: number
  // Summer load line draught, from the load line certificate.
  maxDraftM?: number
  // Length L as the load line convention defines it. The trapped-water
  // rule (IS Code B 2.4) sets its freeboard limits as fractions of it;
  // LBP stands in when this is unset, which understates the water.
  loadLineLengthM?: number
  // The criteria the KN-curve reference is checked against — a marked
  // estimate, never the verdict. Unset = IS Code part A 2.2.
  criteriaSet?: 'is-code-a' | 'osv-b245'
  // Lateral area of the hull and superstructure above the waterline,
  // without deck cargo, and the height of its centre above the waterline
  // ("парусность"). The icing allowance (7.5 kg/m² a side) uses them.
  windageAreaM2?: number
  windageLeverM?: number
  // Exposed decks other than the cargo deck (forecastle, bridge deck…):
  // their horizontal area and its height above the baseline, for the
  // icing allowance (30 kg/m²). 0 is a real answer — none — not "unknown".
  otherExposedDeckAreaM2?: number
  otherExposedDeckVcgM?: number
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

// The vessel's own stability limit from its approved booklet: minimum GM
// by draught, or maximum KG by displacement — whichever form the booklet
// gives. Linear between rows; outside them there is no limit to judge by,
// and the check says so rather than extrapolating.
export interface StabilityLimit {
  kind: 'min-gm-by-draft' | 'max-kg-by-displacement'
  // `arg` is a draught in metres (min-gm-by-draft) or a displacement in kg
  // (max-kg-by-displacement, the same unit as HydrostaticPoint); `value`
  // is a GM or a KG in metres.
  rows: { arg: number; value: number }[]
  source?: string
}

export interface VesselStabilityData {
  particulars: VesselParticulars
  hydrostatics: HydrostaticTable
  knCurves?: KNCrossCurves // absent = Phase 1 only (GM/list/trim, no GZ curve)
  // Tanks, ballast, fuel, water and stores at DEPARTURE — see VariableWeightItem.
  variableWeights: VariableWeightItem[]
  // The same at ARRIVAL. Unset = as at departure: an old calculation, or
  // one where arrival hasn't been entered yet.
  arrivalWeights?: VariableWeightItem[]
  limit?: StabilityLimit
}

// The two states each trip is checked in: leaving port, and arriving with
// consumables used.
export type LoadingState = 'departure' | 'arrival'

// A state's tanks. Arrival falls back to departure until it's entered.
export function weightsInState(vessel: VesselStabilityData, state: LoadingState): VariableWeightItem[] {
  return state === 'arrival' ? (vessel.arrivalWeights ?? vessel.variableWeights) : vessel.variableWeights
}

// A soft check that the lightship LCG fits the axis it's said to be on.
// `longitudinalOrigin` is how the user reads their own booklet's numbers;
// an LCG well outside what that axis can give for this hull (a tenth of LBP,
// at least 5 m, past either end) most likely means the other axis is meant,
// or the figure came from a source using it — and a confident wrong trim
// and wrong draughts fore and aft follow.
export function lightshipLcgHint(p: VesselParticulars): string | null {
  const lbp = p.lengthBpp
  const lcg = p.lightshipLCG
  if (!(lbp > 0) || lcg === 0) return null
  const margin = Math.max(5, lbp * 0.1)
  const [lo, hi] = p.longitudinalOrigin === 'aft-perpendicular' ? [-margin, lbp + margin] : [-lbp / 2 - margin, lbp / 2 + margin]
  if (lcg >= lo && lcg <= hi) return null
  const axis = p.longitudinalOrigin === 'aft-perpendicular' ? 'от кормового перпендикуляра' : 'от миделя'
  return `LCG порожнего ${fmtLength(lcg)} м не похож на «${axis}» при LBP ${fmtLength(lbp)} м — проверьте точку отсчёта`
}

function fmtLength(m: number): string {
  return String(Math.round(m * 100) / 100)
}

// Why KN curves as entered give no GZ curve (computeGZCurve returns null on
// these), in words for the table they were typed into.
export function knCurvesProblem(kn: KNCrossCurves): string | null {
  if (kn.headingAngles.length === 0) return 'Не заданы углы крена'
  // Without a row every KN reads as 0: a curve of nothing but −KG·sin θ.
  if (kn.points.length === 0) return 'Нет ни одной строки водоизмещения'
  if (Math.abs(kn.headingAngles[0]) > 1e-6) return 'Углы крена должны начинаться с 0°'
  for (let i = 1; i < kn.headingAngles.length; i++) {
    if (!(kn.headingAngles[i] > kn.headingAngles[i - 1])) return 'Углы крена должны расти без повторов'
  }
  if (kn.points.some((pt) => Math.abs(pt.KNByAngle[0] ?? 0) > 1e-6)) return 'KN при 0° должно быть 0 в каждой строке'
  return null
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

// The frame as a calculation keeps it: a figure not entered is unset, not
// 0. A 0 standing in for «not entered» put every tonne on the deck at the
// keel's height — GM came out metres too high, with no word said
// (resolveShipFrame, stabilityConditions.ts, reads it back).
export type DeckShipFrameInput = Partial<DeckShipFrame>

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

// ---- Cargo VCG ----
// Moved to src/lib/stabilityMath.ts (pre-Round-14 dependency-direction fix)
// so src/lib/placementComposition.ts can depend on this pure arithmetic
// without depending on stability.ts itself — Round 14 needs
// buildCargoWeightMoments below to import FROM placementComposition.ts,
// and placementComposition.ts importing computeItemVCG from HERE would
// have made that a cycle. Re-exported (not just imported) so every
// existing import of `computeItemVCG` from './stability' keeps working
// unchanged — see the import at the top of this file.

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

// What the stability arithmetic reads of a placement.
export interface StabilityPlacement {
  // Needed only to resolve a composed placement's segments (segmentsOf's
  // implicit-singleton fallback, which never actually runs when
  // `composition` is set — see the composablePlacement helper below).
  // Optional so every pre-Round-14 test fixture (plain {x,y,...} objects
  // with no itemId) keeps compiling unchanged.
  itemId?: string
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
  // Round 14: present ONLY on a placement produced by a cross-item merge
  // (see CompositionSegment's own doc comment in packing.ts). When set,
  // this placement's VCG/TCG/LCG/weight are derived per-segment via
  // placementComposition.ts instead of this placement's own flat
  // height/weight/stabilityOverride, which for a composed placement are
  // only a backward-compatible AVERAGE (see PlacedItem.composition).
  composition?: CompositionSegment[]
}

// `composition` is the only thing ever consulted for a composed
// placement's arithmetic (segmentsOf ignores itemId/layers whenever
// `composition` is set) — the `?? ''`/`?? 0` fallbacks below exist purely
// to satisfy ComposablePlacement's required fields and are never actually
// read in that branch.
const composable = (p: { itemId?: string; layers: number; composition?: CompositionSegment[] }) => ({
  itemId: p.itemId ?? '',
  layers: p.layers,
  composition: p.composition,
})

// Where a placement's weight acts on the ship, in metres: the arm alone,
// so whatever rides with the stack (the water trapped in pipes) can act at
// the same point.
export function cargoMomentArm(
  p: StabilityPlacement,
  deckWidth: number,
  deckLength: number,
  shipFrame: DeckShipFrame,
  deckForwardIsPositiveY: boolean,
  items: CompositionCatalogItem[] = []
): { vcgM: number; tcgM: number; lcgM: number } {
  const center = footprintCenter(p)
  const tcgAuto = shipFrame.originOffsetFromCenterlineM + (center.x - deckWidth / 2)
  // Deck-local y grows "down" the deck rectangle (toward larger y); the
  // ship's own +fwd direction is a separate, explicit choice, since
  // there is no universal convention tying the two together.
  const alongDeckFromMid = center.y - deckLength / 2
  const lcgAuto = shipFrame.originOffsetFromMidshipsM + (deckForwardIsPositiveY ? alongDeckFromMid : -alongDeckFromMid)
  // Composed: per-segment weighted VCG/TCG/LCG-offset via
  // placementComposition.ts (mathematically exact for ship-level moment
  // summation — see placementTotalVCG's own doc comment, and the
  // explicit user requirement to branch here rather than inject a fake
  // stabilityOverride). Uncomposed: unchanged single computeItemVCG call.
  const vcgM = shipFrame.heightAboveBaselineM + (p.composition
    ? placementTotalVCG(composable(p), items)
    : computeItemVCG({ ...p, nestVcgAboveDeckM: p.nest?.vcgAboveDeckM }))
  // tcgOffsetM/lcgOffsetM are a correction ADDED to the auto-computed
  // (position-derived) arm, not an absolute value — unlike
  // vcgAboveDeckM, TCG/LCG move every time the item is dragged, so an
  // absolute override would silently detach from the item on the next
  // move. An offset stays correct relative to wherever the item is now.
  const tcgM = tcgAuto + (p.composition ? placementTotalTCGOffset(composable(p), items) : (p.stabilityOverride?.tcgOffsetM ?? 0))
  const lcgM = lcgAuto + (p.composition ? placementTotalLCGOffset(composable(p), items) : (p.stabilityOverride?.lcgOffsetM ?? 0))
  return { vcgM, tcgM, lcgM }
}

export function buildCargoWeightMoments(
  placements: StabilityPlacement[],
  deckWidth: number,
  deckLength: number,
  shipFrame: DeckShipFrame,
  deckForwardIsPositiveY: boolean,
  // Catalog, needed ONLY to resolve a composed placement's per-segment
  // weight/height/stabilityOverride — an uncomposed placement (the
  // overwhelming common case today) never touches this. Defaults to `[]` so
  // every existing caller/test that predates composition keeps compiling
  // and behaving identically (no placement it passes has `.composition` set).
  items: CompositionCatalogItem[] = []
): WeightMoment[] {
  return placements
    .filter((p) => (p.composition ? placementTotalWeightKg(composable(p), items) : (p.weight ?? 0)) > 0)
    .map((p) => {
      // `weight` on a placement is the PER-UNIT weight and `layers` is how
      // many units share this one footprint (packing.ts writes
      // `weight: item.weight` alongside `layers: unitsInStack`). Every other
      // consumer in the app multiplies the two — page.tsx, planFacts.ts,
      // DeckVisualization, packing.ts's own breakdown builder. This one did
      // not, so a multi-tier stack contributed a single unit's weight to
      // displacement, KG, list and trim: the load came out UNDERstated,
      // which makes the vessel look more stable than it is.
      const weightKg = p.composition ? placementTotalWeightKg(composable(p), items) : (p.weight ?? 0) * Math.max(1, p.layers ?? 1)
      return { weightKg, ...cargoMomentArm(p, deckWidth, deckLength, shipFrame, deckForwardIsPositiveY, items) }
    })
}

// How many placements buildCargoWeightMoments above silently excludes for
// lacking a usable weight — same filter condition, kept in sync
// deliberately rather than re-derived, so this can never disagree with
// what the stability calculation actually did. A vessel can otherwise show
// a perfectly normal green GM/PASS while real cargo sitting on the deck
// (weight never entered, or a preset item with a deliberately unknown
// weight — see vesselTemplates.ts) contributed nothing to it at all.
export function countMissingWeightPlacements(placements: { weight?: number }[]): number {
  return placements.filter((p) => !((p.weight ?? 0) > 0)).length
}

export function variableWeightsToMoments(items: VariableWeightItem[]): WeightMoment[] {
  return items
    .filter((w) => w.weightKg > 0)
    .map((w) => ({ weightKg: w.weightKg, vcgM: w.vcgM, tcgM: w.tcgM, lcgM: w.lcgM }))
}

// stabilityOverride.vcgAboveDeckM/tcgOffsetM/lcgOffsetM are typed in metres
// but actually stored in the deck's display unit (the cargo table's
// «Дополнительно» labels them with the unit and writes the typed number as
// is; setUnit converts them like any other length) — on placements and
// catalog items alike.
function stabilityOverrideToMeters(o: StabilityOverride | undefined, unit: Unit): StabilityOverride | undefined {
  return (
    o && {
      vcgAboveDeckM: o.vcgAboveDeckM !== undefined ? toMeters(o.vcgAboveDeckM, unit) : undefined,
      tcgOffsetM: o.tcgOffsetM !== undefined ? toMeters(o.tcgOffsetM, unit) : undefined,
      lcgOffsetM: o.lcgOffsetM !== undefined ? toMeters(o.lcgOffsetM, unit) : undefined,
    }
  )
}

export function lightshipMoment(vessel: VesselStabilityData): WeightMoment {
  return {
    weightKg: vessel.particulars.lightshipWeightKg,
    vcgM: vessel.particulars.lightshipKG,
    tcgM: vessel.particulars.lightshipTCG,
    lcgM: vessel.particulars.lightshipLCG,
  }
}

// Placements and the catalog in metres — see buildLoadingConditionFromPlacements's
// `unit` param below for why every stability calculation converts first.
export function placementsInMeters<P extends StabilityPlacement>(placements: P[], unit: Unit): P[] {
  if (unit === 'm') return placements
  return placements.map((p) => ({
    ...p,
    x: toMeters(p.x, unit),
    y: toMeters(p.y, unit),
    width: toMeters(p.width, unit),
    length: toMeters(p.length, unit),
    height: toMeters(p.height, unit),
    outline: p.outline?.map((pt) => ({ x: toMeters(pt.x, unit), y: toMeters(pt.y, unit) })),
    stabilityOverride: stabilityOverrideToMeters(p.stabilityOverride, unit),
    // nest.vcgAboveDeckM is computed by pipeNest.ts in real metres
    // throughout (independent of deck display unit) — left as-is.
  }))
}

export function catalogInMeters<I extends CompositionCatalogItem>(items: I[], unit: Unit): I[] {
  if (unit === 'm') return items
  return items.map((it) => ({
    ...it,
    height: toMeters(it.height, unit),
    stabilityOverride: stabilityOverrideToMeters(it.stabilityOverride, unit),
  }))
}

export function buildLoadingConditionFromPlacements(
  vessel: VesselStabilityData,
  shipFrame: DeckShipFrame,
  deck: { width: number; length: number },
  deckForwardIsPositiveY: boolean,
  placements: StabilityPlacement[],
  // The deck's own unit of display (`deck.unit` in the store) — deck
  // dimensions and every placement's x/y/width/length/height/outline are
  // stored in THIS unit (see store/calculator.ts's setUnit, which converts
  // them on every unit switch), while shipFrame and every vessel figure
  // (lightshipLCG, hydrostatics, etc.) are always real metres. Without
  // converting here, switching the deck to feet or centimetres would add
  // metres to feet/cm arms and silently corrupt GM/list/trim — see
  // toMeters below. Defaults to 'm' (a no-op) so every existing caller/test
  // that already passes real metres keeps working unchanged.
  unit: Unit = 'm',
  // Catalog — see buildCargoWeightMoments's own doc comment on this same
  // param. `composition` itself is never unit-converted below: its segments
  // reference itemIds and layer counts, not physical lengths/weights. But a
  // composed placement's VCG/TCG/LCG are built from its segments' CATALOG
  // items (placementTotalVCG & co.), whose `height` and stabilityOverride
  // arms are in the display unit too — so the catalog is converted below
  // exactly like the placements (only `weight`, in kg, is unit-free).
  items: CompositionCatalogItem[] = []
): LoadingCondition {
  const deckM = { width: toMeters(deck.width, unit), length: toMeters(deck.length, unit) }
  const cargo = buildCargoWeightMoments(placementsInMeters(placements, unit), deckM.width, deckM.length, shipFrame, deckForwardIsPositiveY, catalogInMeters(items, unit))
  const variable = variableWeightsToMoments(vessel.variableWeights)
  return computeLoadingCondition(lightshipMoment(vessel), [...variable, ...cargo])
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
  // Longitudinal centre of flotation at this displacement, on the same axis
  // as LCB (longitudinalOrigin) — what the draughts fore and aft pivot on.
  LCF?: number
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
    LCF: hydro.LCF,
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
  // true when totalDisplacementKg fell outside the KN table's own
  // displacement range — interpolateKN below clamps to the nearest
  // endpoint's KN column rather than extrapolating (same reasoning as
  // HydrostaticLookup.extrapolated), but unlike hydrostatics this used to
  // have no flag at all, so a curve built entirely from a clamped-endpoint
  // KN column looked identical to one built from real in-range data.
  knOutOfRange: boolean
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
  // The angle check above only guarantees the TABLE says heel 0° exists —
  // GZ(0°)=0 "by construction" additionally needs KN actually being 0 AT
  // that angle, in every displacement row (interpolateKN can pick any of
  // them). A table with angle 0° present but a nonzero KN(0°) (bad data
  // entry — KN should be identically 0 at zero heel for any hull) would
  // otherwise pass silently and hand the rest of this function a curve
  // whose "0° is really 0" premise is false.
  for (const pt of kn.points) {
    if (Math.abs(pt.KNByAngle[0] ?? 0) > 1e-6) return null
  }
  // Free surface must reduce the WHOLE righting-arm curve, not just the
  // single initial-GM scalar — the standard treatment is a "virtual rise
  // of G" (effective KG = KG + FSC) applied everywhere GZ is computed.
  // Using raw KG here would leave every GZ-derived criterion (areas,
  // GZ-at-30°, angle of max GZ) reading as if no free surface existed,
  // even when the initial-GM criterion elsewhere correctly failed on it.
  const fsc = computeFreeSurfaceCorrection(vessel.variableWeights, loading.totalDisplacementKg)
  const effectiveKG = loading.KG + fsc
  // A centre of gravity off the centreline shortens every righting arm by
  // TCG·cos θ toward the side it lies on — the side the ship lists to and
  // the worse one. Without it a listed ship read as upright, its arms and
  // areas overstated. GZ(0°) is then −|TCG|, not 0, and the areas below are
  // taken from 0°, the negative part included — on the safe side.
  const tcg = Math.abs(loading.overallTCG)
  const curve: GZPoint[] = kn.headingAngles.map((heelDeg, idx) => {
    const KN = interpolateKN(kn, loading.totalDisplacementKg, idx)
    const rad = (heelDeg * Math.PI) / 180
    const GZ = KN - effectiveKG * Math.sin(rad) - tcg * Math.cos(rad)
    return { heelDeg, GZ }
  })

  let maxGZ = -Infinity
  let angleOfMaxGZ = 0
  let peak = 0
  curve.forEach((p, i) => {
    if (p.GZ > maxGZ) {
      maxGZ = p.GZ
      angleOfMaxGZ = p.heelDeg
      peak = i
    }
  })
  // KN tables come every 10° or so, and the peak rarely sits on a node: the
  // vertex of the parabola through the highest node and its two neighbours
  // places it — the «≥ 25°» criterion is judged on that angle.
  const vertex = peak > 0 && peak < curve.length - 1 ? parabolaVertex(curve[peak - 1], curve[peak], curve[peak + 1]) : null
  if (vertex) {
    maxGZ = vertex.GZ
    angleOfMaxGZ = vertex.heelDeg
  }

  // Angle of vanishing stability: first angle (past the max) where GZ
  // crosses back to <= 0, linearly interpolated between the bracketing
  // sample points. null if the curve never returns to/below zero within
  // the tabulated angle range — genuinely "still positive throughout what
  // was tabulated," a reassuring result.
  //
  // GZ(0°) is never positive (−|TCG|, see above), so a vessel with NO
  // positive righting arm anywhere (maxGZ <= 0 — already unstable at
  // upright) would otherwise fall through this loop's `a.GZ > 0` check and
  // ALSO come out as null — collapsing two opposite physical situations
  // ("never vanishes because it's always fine" vs. "already vanished
  // because it was never positive") into the same missing value. Report
  // that case explicitly as 0deg instead.
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

  // Same inclusive-boundary semantics as lookupHydrostatics's own
  // `extrapolated` — exactly at the table's min/max displacement still
  // counts as in-range, only strictly beyond either end counts as out.
  const knDisplacements = kn.points.map((p) => p.displacementKg)
  const knOutOfRange =
    knDisplacements.length > 0 &&
    (loading.totalDisplacementKg < Math.min(...knDisplacements) || loading.totalDisplacementKg > Math.max(...knDisplacements))

  return {
    curve,
    maxGZ,
    angleOfMaxGZ,
    angleOfVanishingStability,
    areaUnder30Deg: integrateArea(curve, 0, 30),
    areaUnder40Deg: integrateArea(curve, 0, 40),
    area30to40: integrateArea(curve, 30, 40),
    knOutOfRange,
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

// The KN-curve reference: the criteria of IS Code 2008 part A 2.2, or the
// equivalent ones part B 2.4.5 gives supply vessels whose hull makes 2.2
// impracticable. An estimate from the entered KN curves, never the verdict
// — that is the booklet's limit (stabilityConditions.ts). The weather
// criterion (2.3) is not here, see the module-level comment.
//
// downfloodingAngleDeg (optional): by 2.2.1 the angle of downflooding
// replaces 40° as the upper bound of the areas when it is smaller — area
// past it credits righting arm the ship no longer has, water already
// entering. Below 30° it bounds the 0–30° area too: the Code assumes it
// never comes that low, and crediting area past it would be the same false
// pass. The GZ and angle criteria keep their angles.
export function checkIMOCriteria(
  gz: GZCurveResult,
  stability: StabilityResult,
  downfloodingAngleDeg?: number,
  criteriaSet: 'is-code-a' | 'osv-b245' = 'is-code-a'
): StabilityCriterion[] {
  const upper = downfloodingAngleDeg !== undefined ? Math.min(40, downfloodingAngleDeg) : 40
  const lower = Math.min(30, upper)
  const areaTo = (deg: number) => integrateArea(gz.curve, 0, deg)
  const area30toUpper = integrateArea(gz.curve, lower, upper)
  // «At an angle of heel equal to or greater than 30°»: the largest arm from
  // 30° on, not the arm at exactly 30°.
  const gzFrom30 = Math.max(interpolateGZAt(gz.curve, 30), ...gz.curve.filter((p) => p.heelDeg > 30).map((p) => p.GZ))
  const angleMax = gz.angleOfMaxGZ
  const criterion = (id: string, description: string, requiredValue: number, actualValue: number, unit: string): StabilityCriterion => ({
    id,
    description,
    requiredValue,
    actualValue,
    unit,
    pass: actualValue >= requiredValue,
  })
  const shared = [
    criterion('area-30-40', `Площадь под кривой GZ ${lower}°–${upper}°`, 0.03, area30toUpper, 'м·рад'),
    criterion('gz-max-at-30', 'GZ ≥ 0.20 м при угле крена ≥ 30°', 0.2, gzFrom30, 'м'),
  ]
  const initialGm = criterion(
    'initial-gm',
    `Начальная GM (с поправкой на своб. поверхность) ≥ ${G_METACENTRIC_MIN_SAFE} м`,
    G_METACENTRIC_MIN_SAFE,
    stability.GM_fluid,
    'м'
  )
  if (criteriaSet === 'osv-b245') {
    // 2.4.5.2.1: the area up to the angle of the maximum, its requirement
    // moving linearly from 0.070 m·rad at 15° to 0.055 m·rad at 30°.
    const areaUpTo = Math.min(30, Math.max(15, angleMax))
    const areaRequired = areaUpTo >= 30 ? 0.055 : areaUpTo <= 15 ? 0.07 : 0.055 + 0.001 * (30 - areaUpTo)
    return [
      criterion('area-to-max', `Площадь под кривой GZ до ${fmtAngle(areaUpTo)}° (IS Code, ч. B, 2.4.5)`, areaRequired, areaTo(areaUpTo), 'м·рад'),
      ...shared.map((c) => ({ ...c, description: `${c.description} (IS Code, ч. B, 2.4.5)` })),
      criterion('angle-of-max-gz', 'Угол максимума GZ ≥ 15° (IS Code, ч. B, 2.4.5)', 15, angleMax, '°'),
      { ...initialGm, description: `${initialGm.description} (IS Code, ч. B, 2.4.5)` },
    ]
  }
  return [
    criterion('area-0-30', `Площадь под кривой GZ до ${lower}° (IS Code 2008, п. 2.2.1)`, 0.055, areaTo(lower), 'м·рад'),
    { ...shared[0], description: `${shared[0].description} (IS Code 2008, п. 2.2.1)` },
    criterion('area-0-40', `Площадь под кривой GZ до ${upper}° (IS Code 2008, п. 2.2.1)`, 0.09, areaTo(upper), 'м·рад'),
    { ...shared[1], description: `${shared[1].description} (IS Code 2008, п. 2.2.2)` },
    criterion('angle-of-max-gz', 'Угол максимума GZ ≥ 25° (IS Code 2008, п. 2.2.3)', 25, angleMax, '°'),
    { ...initialGm, description: `${initialGm.description} (IS Code 2008, п. 2.2.4)` },
  ]
}

function fmtAngle(deg: number): string {
  return String(Math.round(deg * 10) / 10)
}

// Vertex of the parabola through three points of the curve, when it opens
// downward and falls between the outer two.
function parabolaVertex(a: GZPoint, b: GZPoint, c: GZPoint): GZPoint | null {
  const [x1, y1, x2, y2, x3, y3] = [a.heelDeg, a.GZ, b.heelDeg, b.GZ, c.heelDeg, c.GZ]
  const denom = (x1 - x2) * (x1 - x3) * (x2 - x3)
  if (denom === 0) return null
  const A = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / denom
  const B = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / denom
  const C = (x2 * x3 * (x2 - x3) * y1 + x3 * x1 * (x3 - x1) * y2 + x1 * x2 * (x1 - x2) * y3) / denom
  if (!(A < 0)) return null
  const x = -B / (2 * A)
  if (x < x1 || x > x3) return null
  return { heelDeg: x, GZ: A * x * x + B * x + C }
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

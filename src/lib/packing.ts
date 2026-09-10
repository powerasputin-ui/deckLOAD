// 2D bin-packing for deck loading.
// Implements the Maximal Rectangles algorithm with the
// Best Short Side Fit (BSSF) heuristic and optional 90deg rotation.
// Reference: Jukka Jylänki - "A Thousand Ways to Pack the Bin".

import type { PipeNestSpec } from './pipeNest'
import { type Unit, toMeters } from './units'
// Value-level import from placementComposition.ts, which only imports TYPES
// back from this file (`import type {...} from './packing'`) — type-only
// imports are erased at compile time, so this can never form a runtime
// circular dependency, confirmed before adding this.
import {
  placementTotalWeightKg,
  placementTotalHeightM,
  placementTotalLayers,
  placementConstituents,
  placementCategorySet,
  segmentsOf,
  resolveUniformOutline,
  resolveUniformShape,
  type ComposablePlacement,
} from './placementComposition'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// 2D/3D render hint (DeckVisualization, Deck3DView) — defaults to 'box'.
// Footprint/packing math is unaffected by any of these: every shape still
// packs, collides and clamps by its rectangular bounding box, exactly like a
// box. Only what gets *drawn* inside that bounding box differs — EXCEPT
// 'custom' (see `outline` below), whose precise silhouette also feeds
// collidesPrecisely() for direct manual placement/drag/rotate, while the
// auto-packer still only ever reserves its bounding box, same as every
// other shape.
// 'pipe-nest' is a render hint only, same rule as every other shape here:
// the item's width/length/height/weight already describe the WHOLE
// штабель (a real nest of round pipes spanning the deck's usable width —
// see src/lib/pipeNest.ts), so packing/collision needs no special case at
// all, exactly like 'box'. Only the 2D/3D renderers and computeItemVCG (via
// CargoItem.nest.vcgAboveDeckM) need to know it's there.
export type CargoShape = 'box' | 'cylinder' | 'circle' | 'oval' | 'triangle' | 'diamond' | 'custom' | 'pipe-nest'

export interface CargoItem {
  id: string
  name: string
  width: number // along X axis
  length: number // along Y axis
  height: number // vertical (for tier/stacking calculations); 0 = ignore
  quantity: number
  color: string
  allowRotation: boolean
  weight?: number
  category?: string // free-text cargo category (e.g. "Опасный груз") used by separation rules
  shape?: CargoShape
  // Hand-drawn silhouette for shape: 'custom' — vertices in the item's own
  // local, UNROTATED frame, same units as width/length, spanning exactly
  // [0,width] x [0,length]. width/length remain the authoritative bounding
  // box every packing/collision function already trusts; this is purely
  // additive precision data. Rotated on the fly via rotateOutline90() —
  // never stored pre-rotated, so there's only ever one source of truth.
  outline?: { x: number; y: number }[]
  // User-set cap on how many units of this item can stack vertically —
  // combined with the clearance-height ceiling via maxLayersFor() (whichever
  // is more restrictive wins). Unset/0 = no override, height ceiling only.
  maxLayers?: number
  // A stack-height ceiling in METRES for THIS cargo type specifically — a
  // fact about the cargo/stowage method (e.g. "3,0 м" for a pipe stack per
  // ДВТК п. 2.1.2), independent of the deck-wide `clearance` setting. See
  // maxLayersFor() for how the two combine. Unset = no item-specific cap.
  maxStackHeightM?: number
  // Free-text cargo contents, shown as a hover tooltip on placed instances
  // (gated by the global "Содержимое груза" setting) — never affects packing.
  contents?: string
  // Overrides the stability engine's default vertical-center-of-gravity
  // estimate (half the stacked height above the deck) — see
  // computeItemVCG() in src/lib/stability.ts. Never affects packing/collision.
  stabilityOverride?: StabilityOverride
  // Present when shape === 'pipe-nest': this item's width/length/height/
  // weight already describe the WHOLE штабель the nest spec was computed
  // for (see src/lib/pipeNest.ts's own doc comment) — quantity counts how
  // many such stacks there are. Packing/collision reads none of this; only
  // computeItemVCG (via the copy on PlacedItem, see nestVcgByItemId below)
  // and the 2D/3D renderers need it.
  nest?: PipeNestSpec
}

// Overrides the stability calculator's geometric default for a cargo unit's
// vertical center of gravity — see computeItemVCG() in src/lib/stability.ts.
export interface StabilityOverride {
  vcgAboveDeckM?: number
  // Corrections ADDED to the auto-computed (position-derived) TCG/LCG arm —
  // not an absolute value like vcgAboveDeckM, because TCG/LCG move every
  // time the item is dragged; an absolute override would silently detach
  // from the item on its next move, an offset stays correct relative to
  // wherever the item currently is.
  tcgOffsetM?: number // + = toward starboard
  lcgOffsetM?: number // + = toward the bow (per deckForwardIsPositiveY)
}

// A rectangular deck zone with its own permitted load density (t/m²).
export interface LoadZone {
  id: string
  x: number
  y: number
  width: number
  length: number
  maxLoadPerArea: number // t/m²
}

export interface ZoneLoadCheck {
  zoneId: string
  totalWeightKg: number
  areaM2: number
  densityTPerM2: number
  limitTPerM2: number
  exceeded: boolean
}

// Same eps guard as collidesWith below, same reason: without it, an exact
// flush-against-the-zone-edge position can flip in or out of "overlapping"
// on floating-point noise alone. Touching (not overlapping) is the
// deliberate, consistent policy across every boundary/collision check in
// this file — see collidesPrecisely's own comment.
function overlapsZone(f: { x: number; y: number; width: number; length: number }, z: LoadZone): boolean {
  const eps = 1e-9
  return f.x < z.x + z.width - eps && f.x + f.width > z.x + eps && f.y < z.y + z.length - eps && f.y + f.length > z.y + eps
}

// Sutherland-Hodgman: clips `poly` (subject, may be concave — the deck
// outline) against the 4 half-planes of an axis-aligned rectangle (clip
// window, always convex — a load zone). Concave-subject/convex-clip is
// exactly what this algorithm supports, so a cut-corner deck outline works
// with no extra handling.
function clipPolygonToRect(
  poly: { x: number; y: number }[],
  rect: { x: number; y: number; width: number; length: number }
): { x: number; y: number }[] {
  const x0 = rect.x
  const x1 = rect.x + rect.width
  const y0 = rect.y
  const y1 = rect.y + rect.length
  const edges: {
    inside: (p: { x: number; y: number }) => boolean
    intersect: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }
  }[] = [
    { inside: (p) => p.x >= x0, intersect: (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.x <= x1, intersect: (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.y >= y0, intersect: (a, b) => ({ y: y0, x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y) }) },
    { inside: (p) => p.y <= y1, intersect: (a, b) => ({ y: y1, x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y) }) },
  ]
  let output = poly
  for (const edge of edges) {
    const input = output
    output = []
    if (input.length === 0) break
    for (let i = 0; i < input.length; i++) {
      const curr = input[i]
      const prev = input[(i - 1 + input.length) % input.length]
      const currIn = edge.inside(curr)
      const prevIn = edge.inside(prev)
      if (currIn) {
        if (!prevIn) output.push(edge.intersect(prev, curr))
        output.push(curr)
      } else if (prevIn) {
        output.push(edge.intersect(prev, curr))
      }
    }
  }
  return output
}

// A zone's real usable area for load-density purposes: the part of its
// rectangle that actually lies within the deck's real outline, not the
// bare width*length. Without this, a zone straddling a cut corner would
// have its density diluted by "area" that isn't real deck at all —
// understating the true load on the real portion, which is the wrong
// direction for a structural safety check. No outline (rectangular deck,
// the default) -> unchanged bare rectangle area.
export function zoneAreaWithinOutline(
  zone: { x: number; y: number; width: number; length: number },
  outline: { x: number; y: number }[] | undefined
): number {
  const rectArea = zone.width * zone.length
  if (!outline || outline.length < 3) return rectArea
  const clipped = clipPolygonToRect(outline, zone)
  if (clipped.length < 3) return 0
  return Math.min(rectArea, polygonArea(clipped))
}

// Aggregates the full weight of every placement that overlaps a zone at all
// (no proration by overlap area — a conservative, physically-safe
// approximation: a box straddling a zone edge counts fully toward it) and
// divides by the ZONE's REAL area (clipped to the deck outline when one is
// set — see zoneAreaWithinOutline). This is what a load zone's t/m² limit
// actually means (structural capacity of that patch of deck) — not any
// single item's own footprint density, and not the zone's bare rectangle
// if part of it overhangs a cut corner. A placement overlapping two zones
// contributes its full weight to both independently. Returns only zones
// that exceed their limit.
// Every zone's current load status, whether or not it's over the limit —
// the basis for both checkZoneLoads (violations only, used for warnings)
// and any UI that wants to show a zone's live "X т/м² of Y т/м²" reading
// even when it's fine, so a user can actually see WHY a zone did or didn't
// trigger a warning instead of guessing (a 1 т/м² limit over a large zone
// easily absorbs several tonnes of cargo without ever exceeding it — that's
// correct density math, not a bug, but it reads as "broken" with no way to
// see the live number).
export function computeZoneLoads(
  placements: { x: number; y: number; width: number; length: number; totalWeightKg: number }[],
  zones: LoadZone[] | undefined,
  deckOutline?: { x: number; y: number }[],
  // Zone/placement/outline x,y,width,length live in the deck's own display
  // unit (deck.unit — see store/calculator.ts's setUnit, which converts all
  // of them together on every unit switch), but `areaM2` below is a real
  // t/m² denominator: comparing tonnes against a raw ft²/cm² number under
  // that name silently mis-scales density by ~10.76x (ft) or 1e4x (cm)
  // against `limitTPerM2`, which IS always real t/m². Convert every
  // unit-bearing input to metres up front so the rest of this function can
  // stay unit-agnostic. Defaults to 'm' (no-op) for existing metres-only
  // callers/tests.
  unit: Unit = 'm'
): ZoneLoadCheck[] {
  if (!zones || zones.length === 0) return []
  const zonesM = unit === 'm' ? zones : zones.map((z) => ({ ...z, x: toMeters(z.x, unit), y: toMeters(z.y, unit), width: toMeters(z.width, unit), length: toMeters(z.length, unit) }))
  const placementsM =
    unit === 'm'
      ? placements
      : placements.map((p) => ({ ...p, x: toMeters(p.x, unit), y: toMeters(p.y, unit), width: toMeters(p.width, unit), length: toMeters(p.length, unit) }))
  const outlineM = unit === 'm' || !deckOutline ? deckOutline : deckOutline.map((pt) => ({ x: toMeters(pt.x, unit), y: toMeters(pt.y, unit) }))
  const results: ZoneLoadCheck[] = []
  const eps = 1e-9
  for (const z of zonesM) {
    const areaM2 = zoneAreaWithinOutline(z, outlineM)
    if (areaM2 <= 0) continue
    let totalWeightKg = 0
    for (const p of placementsM) {
      if (overlapsZone(p, z)) totalWeightKg += p.totalWeightKg
    }
    const densityTPerM2 = totalWeightKg / 1000 / areaM2
    results.push({
      zoneId: z.id,
      totalWeightKg,
      areaM2,
      densityTPerM2,
      limitTPerM2: z.maxLoadPerArea,
      exceeded: densityTPerM2 > z.maxLoadPerArea + eps,
    })
  }
  return results
}

export function checkZoneLoads(
  placements: { x: number; y: number; width: number; length: number; totalWeightKg: number }[],
  zones: LoadZone[] | undefined,
  deckOutline?: { x: number; y: number }[],
  unit: Unit = 'm'
): ZoneLoadCheck[] {
  return computeZoneLoads(placements, zones, deckOutline, unit).filter((z) => z.exceeded)
}

// Local pressure under ONE placement's own footprint — deliberately
// different from computeZoneLoads above, which averages weight over a
// whole zone. A real structural check cares about the footprint: ДВТК's
// own worked example (п. 2.1.7) computes "756 т / (16,9×12,37 м) = 209 м²
// → 3,62 т/м²" for a single pipe stack's own patch of deck, not the
// average over some larger zone that happens to contain it. A zone-average
// check alone can never catch a heavy stack on a small footprint sitting
// inside a large, otherwise-empty zone. Compared against every zone the
// footprint overlaps (the tightest limit, since every applicable limit
// must hold — mirrors computeZoneLoads's own "counts fully toward every
// zone it touches" rule). A footprint outside every zone isn't evaluated
// (returns nothing for it) — same "not evaluated is not a failure"
// convention as checkLashingBalance's null return, since there is no
// deck-wide default limit in the data model to fall back to (the vessel
// template's own deckStrengthTPerM2 is never persisted onto the deck after
// the template is applied — inventing a fallback here would be exactly
// the kind of fabricated number this audit is about removing, not adding).
export interface FootprintPressureCheck {
  index: number // index into the `placements` array passed in
  areaM2: number
  pressureTPerM2: number
  limitTPerM2: number
  exceeded: boolean
}

export function computeFootprintPressures(
  placements: { x: number; y: number; width: number; length: number; totalWeightKg: number }[],
  zones: LoadZone[] | undefined,
  unit: Unit = 'm'
): FootprintPressureCheck[] {
  if (!zones || zones.length === 0) return []
  const zonesM = unit === 'm' ? zones : zones.map((z) => ({ ...z, x: toMeters(z.x, unit), y: toMeters(z.y, unit), width: toMeters(z.width, unit), length: toMeters(z.length, unit) }))
  const placementsM =
    unit === 'm'
      ? placements
      : placements.map((p) => ({ ...p, x: toMeters(p.x, unit), y: toMeters(p.y, unit), width: toMeters(p.width, unit), length: toMeters(p.length, unit) }))
  const eps = 1e-9
  const results: FootprintPressureCheck[] = []
  placementsM.forEach((p, index) => {
    const areaM2 = p.width * p.length
    if (areaM2 <= 0) return
    const overlapping = zonesM.filter((z) => overlapsZone(p, z))
    if (overlapping.length === 0) return
    const limitTPerM2 = Math.min(...overlapping.map((z) => z.maxLoadPerArea))
    const pressureTPerM2 = p.totalWeightKg / 1000 / areaM2
    results.push({ index, areaM2, pressureTPerM2, limitTPerM2, exceeded: pressureTPerM2 > limitTPerM2 + eps })
  })
  return results
}

// Every zone id a single footprint overlaps — used to look up whether an
// individual placed item sits inside a zone that checkZoneLoads flagged.
export function zoneIdsOverlapping(
  footprint: { x: number; y: number; width: number; length: number },
  zones: LoadZone[] | undefined
): string[] {
  if (!zones || zones.length === 0) return []
  return zones.filter((z) => overlapsZone(footprint, z)).map((z) => z.id)
}

// A lashing/securing device running from one corner of a placed cargo unit
// (cornerX/cornerY, world coords) to an anchor point on the deck (x/y).
// Visual-only until placementId is set — an unattached point is just a pin,
// same as before this feature existed.
export type LashingDeviceType = 'chain_g80_10' | 'wire_18' | 'webbing_5t' | 'custom'

export interface LashingPoint {
  id: string
  x: number
  y: number
  label?: string
  placementId?: string // id of the pinned/manual placement this secures
  itemId?: string // cargo item type of that placement (for lookups/device suggestions)
  cornerX?: number
  cornerY?: number
  verticalAngleDeg?: number // angle of the lashing off the deck plane, default 45
  mslKg?: number // rated Maximum Securing Load of this device
  deviceType?: LashingDeviceType
}

// A purely visual marker showing where a deck electrical outlet is (so the
// user can see where a reefer container could be plugged in). Deliberately
// carries no collision/exclusion behavior — never affects placement.
export interface PowerSocket {
  id: string
  x: number
  y: number
  label?: string
}

// A free-form text annotation — AutoCAD-style leader note. Purely
// documentation/communication, never read by any calculation (unlike
// deckForwardIsPositiveY, which is the real, separately-set direction the
// stability solver uses). `kind` only changes which quick-stamp button in
// PresetsBar pre-filled its text — it never changes behavior or rendering.
export type AnnotationKind = 'bow' | 'stern' | 'port' | 'starboard' | 'note'

export interface DeckAnnotation {
  id: string
  x: number // deck-local — where the TEXT sits; freely draggable, independent of leaderX/Y
  y: number
  text: string
  kind?: AnnotationKind
  // Optional point this annotation points AT via a thin leader line — any
  // deck-local coordinate: empty space, on top of a cargo footprint, off
  // the deck outline. NOT bound to a placement id — dragging the cargo it
  // once pointed at does not move the leader (this is simple documentation
  // markup, not a physics attachment like LashingPoint).
  leaderX?: number
  leaderY?: number
}

// A hard-blocking obstacle zone (crane, bulwark, superstructure, etc.) —
// cargo can never be placed/dragged/rotated into it, in manual OR auto mode.
// For the 4 basic PPT-style shapes the outline polygon is never stored —
// it's derived on demand from shapeType+bbox via restrictionZonePolygon(),
// so a resize can never leave a stale outline behind. 'custom' is the one
// exception: a hand-drawn point-by-point polygon has no bbox-derivable
// shape, so its vertices ARE the stored source of truth (world/deck
// coordinates, same convention as CargoItem.outline but absolute rather
// than local-frame, since zones never rotate) — x/y/width/length are still
// kept in sync as its bounding box, for the drag-to-move interaction and as
// a cheap pre-filter, but restrictionZonePolygon() always prefers `outline`
// over deriving from the bbox when one is present.
export type RestrictionZoneShape = 'rect' | 'triangle' | 'oval' | 'diamond' | 'custom'

export interface RestrictionZone {
  id: string
  name: string
  shapeType: RestrictionZoneShape
  x: number
  y: number
  width: number
  length: number
  outline?: { x: number; y: number }[] // world coords, only for shapeType 'custom'
}

// The zone's silhouette in world (deck) coordinates. For 'custom' zones with
// a stored outline, that outline IS the polygon (already world-space); every
// other shape derives fresh from its bounding box every time — same
// reasoning as CargoItem.outline being the only source of truth for
// 'custom' shape cargo (see above).
export function restrictionZonePolygon(zone: {
  shapeType: RestrictionZoneShape
  x: number
  y: number
  width: number
  length: number
  outline?: { x: number; y: number }[]
}): { x: number; y: number }[] {
  const { shapeType, x, y, width, length } = zone
  if (shapeType === 'custom' && zone.outline && zone.outline.length >= 3) return zone.outline
  switch (shapeType) {
    case 'triangle':
      return [
        { x: x + width / 2, y },
        { x: x + width, y: y + length },
        { x, y: y + length },
      ]
    case 'diamond':
      return [
        { x: x + width / 2, y },
        { x: x + width, y: y + length / 2 },
        { x: x + width / 2, y: y + length },
        { x, y: y + length / 2 },
      ]
    case 'oval': {
      const segments = 24
      const cx = x + width / 2
      const cy = y + length / 2
      const rx = width / 2
      const ry = length / 2
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        pts.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) })
      }
      return pts
    }
    case 'rect':
    default:
      return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + length },
        { x, y: y + length },
      ]
  }
}

// Typical securing devices with their rated MSL (kg) — selecting one
// auto-fills mslKg, which stays freely editable afterwards (custom gear).
export const LASHING_DEVICES: Record<LashingDeviceType, { label: string; mslKg: number }> = {
  chain_g80_10: { label: 'Цепь G80 10мм', mslKg: 4000 },
  wire_18: { label: 'Трос 18мм', mslKg: 3200 },
  webbing_5t: { label: 'Ремень 5т', mslKg: 2500 },
  custom: { label: 'Другое (вручную)', mslKg: 0 },
}

// A SEPARATE, additive check from checkLashingBalance below — that one is
// an IMO CSS Code Annex 13 static-force balance per attached point; this is
// the real РД 31.11.21.23-96 п. 2.2.3 rule a class-approved project actually
// used for pipe штабели: the number of lashings for one stack is 0.3 of its
// weight (t) divided by the wire's own breaking load (t). The two
// methodologies can disagree — see requiredLashingCount's own doc comment —
// so callers must show both, never merge them into one verdict.
export type WireRopeType = 'wire_19_5_g1zhn_1670' | 'custom'

export const WIRE_ROPE_SPECS: Record<WireRopeType, { label: string; breakingLoadKN: number }> = {
  // Real — ДВТК/638.362241.023 REV3 п. 2.2.2: "стальной канат 19,5-Г-I-Ж-Н
  // 1670 ГОСТ 2688-80 с разрывным усилием каната в целом BL= 203 кН (20,7т)".
  wire_19_5_g1zhn_1670: { label: '19,5-Г-I-Ж-Н 1670 ГОСТ 2688-80 (BL 203 кН)', breakingLoadKN: 203 },
  custom: { label: 'Свой канат (вручную)', breakingLoadKN: 0 },
}

// РД 31.11.21.23-96 п. 2.2.3: n = 0,3·P / BL, where P is the stack's own
// weight and BL the wire's breaking load, both in the same mass unit —
// rearranged here to keep BL in its usual kN and P in kg. Documented real
// example: a 756 t (7,560,000 kg) pipe stack with BL = 203 kN gives
// n = ceil(0.3 * 756 / (203/9.80665)) = 11 — the project's own approved
// document then adopted 3 in practice, because the cargo was additionally
// cribbed between the bulwark walls (see the source п.'s own note). That
// gap is real and intentional, not something to silently reconcile here —
// this function only returns the RD-computed figure; a caller comparing it
// against a smaller actual count must ask for a justification, not treat it
// as a failure.
export function requiredLashingCount(stackWeightKg: number, breakingLoadKN: number): number {
  if (!(breakingLoadKN > 0) || !(stackWeightKg > 0)) return 0
  const stackWeightT = stackWeightKg / 1000
  const breakingLoadT = breakingLoadKN / G
  return Math.max(0, Math.ceil((0.3 * stackWeightT) / breakingLoadT))
}

// Which lashing-requirement methodology a cargo's free-text category maps
// to. requiredLashingCount's formula is the real, cited РД 31.11.21.23-96
// figure only for metal products (that's what the regulation covers) —
// everything else gets the same number as an unlabeled ballpark, and
// dangerous-goods categories get a hazard warning instead of a number that
// would otherwise look like an official compliance figure it isn't. Full
// IMDG Code segregation/classification/stowage-location rules are not
// something this app calculates — this only decides which label to show,
// never blocks or silently "fixes" anything.
export type LashingMethodology = 'metal-rd' | 'general' | 'dangerous-goods'
const DANGEROUS_GOODS_CATEGORIES = new Set(['Опасный груз', 'Химикаты', 'Взрывоопасный'])
export function lashingMethodologyFor(category?: string): LashingMethodology {
  if (category === 'Металлопродукция') return 'metal-rd'
  if (category && DANGEROUS_GOODS_CATEGORIES.has(category)) return 'dangerous-goods'
  return 'general'
}

// Wraps requiredLashingCount with an honest result status instead of a bare
// number, so a caller can never confuse "0" with "not calculated" or with
// "this methodology doesn't apply here" — see this file's own notes above
// requiredLashingCount and lashingMethodologyFor for why each branch exists.
// requiredLashingCount itself stays untouched; this only decides whether it
// gets called at all and what the result means.
export type LashingResultStatus = 'calculated' | 'insufficient-data' | 'not-applicable'
// A discriminated union (not one interface with optional fields) so a
// caller that's checked `status === 'calculated'` gets `methodology`
// narrowed to 'metal-rd' | 'general' automatically — 'dangerous-goods'
// always resolves to 'not-applicable' below and never reaches that branch.
export type LashingAssessment =
  | { status: 'calculated'; methodology: 'metal-rd' | 'general'; requiredCount: number }
  | { status: 'insufficient-data'; methodology: 'metal-rd' | 'general'; missingInputs: string[] }
  | { status: 'not-applicable'; methodology: 'dangerous-goods' }
export function assessLashingRequirement(
  category: string | undefined,
  stackWeightKg: number,
  breakingLoadKN: number
): LashingAssessment {
  const methodology = lashingMethodologyFor(category)
  if (methodology === 'dangerous-goods') return { status: 'not-applicable', methodology }
  const missing: string[] = []
  if (!(stackWeightKg > 0)) missing.push('вес груза')
  if (!(breakingLoadKN > 0)) missing.push('характеристики троса (BL)')
  if (missing.length > 0) return { status: 'insufficient-data', methodology, missingInputs: missing }
  return { status: 'calculated', methodology, requiredCount: requiredLashingCount(stackWeightKg, breakingLoadKN) }
}

// Vessel motion coefficients (in g) used by the simplified static-equivalent
// lashing check below, plus the deck/cargo friction coefficient. Presets
// stand in for a full GM/roll-period calculation, which real-world lashing
// software also avoids asking casual users for.
export type VesselMotionPreset = 'open-sea' | 'coastal' | 'sheltered' | 'custom'

export interface VesselMotion {
  ax: number
  ay: number
  az: number
  friction: number
  preset: VesselMotionPreset
}

export const VESSEL_MOTION_PRESETS: Record<Exclude<VesselMotionPreset, 'custom'>, Omit<VesselMotion, 'preset'>> = {
  'open-sea': { ax: 0.3, ay: 0.5, az: 0.3, friction: 0.3 },
  coastal: { ax: 0.2, ay: 0.35, az: 0.2, friction: 0.3 },
  sheltered: { ax: 0.1, ay: 0.2, az: 0.1, friction: 0.3 },
}

export const DEFAULT_VESSEL_MOTION: VesselMotion = { ...VESSEL_MOTION_PRESETS.coastal, preset: 'coastal' }

export interface LashingDirectionCheck {
  requiredKg: number
  availableKg: number
  ok: boolean
}

export interface LashingCheck {
  transverse: LashingDirectionCheck
  longitudinal: LashingDirectionCheck
  ok: boolean
}

const G = 9.80665

// Simplified static-equivalent method (IMO CSS Code Annex 13 style): for each
// direction, the weight's own inertial force under the vessel's motion
// coefficient must be resisted by friction plus every attached lashing's
// component in that direction. Non-blocking — same contract as
// checkZoneLoads: pure function, returns a descriptive struct, never
// mutates, caller decides how (or whether) to surface it. Returns null when
// there's nothing attached to check (an unsecured item isn't a "failure",
// it's just not evaluated — callers should track that separately).
export function checkLashingBalance(
  placement: { x: number; y: number; width: number; length: number; weight?: number; layers?: number },
  lashings: LashingPoint[],
  motion: VesselMotion
): LashingCheck | null {
  const attached = lashings.filter(
    (l) => l.cornerX !== undefined && l.cornerY !== undefined && (l.mslKg ?? 0) > 0
  )
  if (attached.length === 0) return null
  // `weight` is per-unit (see PlacedItem.weight's doc comment); a 3-tier
  // stack's real inertial force is 3x one unit's, not 1x — checking against
  // the unweighted per-unit force let an under-secured multi-tier stack
  // read as "OK" when it wasn't. Same class of bug already fixed once in
  // stability.ts's buildCargoWeightMoments.
  const weightKg = (placement.weight ?? 0) * Math.max(1, placement.layers ?? 1)
  const frictionForce = motion.friction * weightKg * G

  let transverseAvail = frictionForce
  let longitudinalAvail = frictionForce
  for (const l of attached) {
    const cornerX = l.cornerX!
    const cornerY = l.cornerY!
    const dx = l.x - cornerX
    const dy = l.y - cornerY
    const dist = Math.hypot(dx, dy)
    if (dist <= 1e-9) continue
    const verticalRad = ((l.verticalAngleDeg ?? 45) * Math.PI) / 180
    const horizontalComponent = Math.cos(verticalRad) // fraction of MSL acting in the deck plane
    // Deck-plane direction of the lashing, split into transverse (X, relative
    // to the ship's centerline running along Y) and longitudinal (Y) parts.
    const ux = Math.abs(dx / dist)
    const uy = Math.abs(dy / dist)
    const mslPlane = (l.mslKg ?? 0) * horizontalComponent * G
    transverseAvail += mslPlane * ux
    longitudinalAvail += mslPlane * uy
  }
  const transverseRequired = weightKg * G * motion.ay
  const longitudinalRequired = weightKg * G * motion.ax

  const transverse: LashingDirectionCheck = {
    requiredKg: transverseRequired / G,
    availableKg: transverseAvail / G,
    ok: transverseAvail >= transverseRequired,
  }
  const longitudinal: LashingDirectionCheck = {
    requiredKg: longitudinalRequired / G,
    availableKg: longitudinalAvail / G,
    ok: longitudinalAvail >= longitudinalRequired,
  }
  return { transverse, longitudinal, ok: transverse.ok && longitudinal.ok }
}

// A rule requiring at least `minDistance` (edge-to-edge, meters) between any
// cargo of `categoryA` and any cargo of `categoryB`. Symmetric: a rule for
// (A, B) also matches candidates in the order (B, A).
export interface SeparationRule {
  id: string
  categoryA: string
  categoryB: string
  minDistance: number
}

// Edge-to-edge distance between two axis-aligned rects (0 if overlapping/touching).
function edgeDistance(
  a: { x: number; y: number; width: number; length: number },
  b: { x: number; y: number; width: number; length: number }
): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
  const dy = Math.max(a.y - (b.y + b.length), b.y - (a.y + a.length), 0)
  return Math.hypot(dx, dy)
}

// Checks whether placing `candidate` too close to any already-`placed` item
// would violate a configured separation rule between their categories.
export function violatesSeparation(
  candidate: { x: number; y: number; width: number; length: number; category?: string },
  placed: { x: number; y: number; width: number; length: number; category?: string }[],
  rules: SeparationRule[] | undefined
): boolean {
  if (!rules || rules.length === 0 || !candidate.category) return false
  const eps = 1e-9
  for (const other of placed) {
    if (!other.category) continue
    const rule = rules.find(
      (r) =>
        (r.categoryA === candidate.category && r.categoryB === other.category) ||
        (r.categoryB === candidate.category && r.categoryA === other.category)
    )
    if (!rule) continue
    if (edgeDistance(candidate, other) < rule.minDistance - eps) return true
  }
  return false
}

// Composition-aware wrapper around violatesSeparation above — that function
// itself is NOT modified (its single-category-pair contract is exactly what
// every existing uncomposed call site still needs, and is already proven
// correct for that case). Reusing a single reduced category string for a
// composed placement — whether the synthetic 'Смешанный груз' display label
// or an arbitrary constituent's own category — is WRONG for a separation
// check: no real SeparationRule is ever configured against a synthetic UI
// label (so that placement would become invisible to separation entirely),
// and picking one constituent's category silently drops every OTHER
// constituent's own hazard class from the check (worse than "unchecked" —
// it LOOKS checked). The correct contract is per-constituent-category-SET
// matching: every distinct category physically present in the candidate
// checked against every distinct category physically present in each
// `other`, so a composed placement with e.g. both an ordinary and a
// dangerous-goods constituent is caught by a rule naming the dangerous
// category even though the placement's nominal itemId might be the
// ordinary one (exactly the R29 Tier-1 scenario: nominal itemId broken/
// unresolved, composition still holds the real constituent categories).
// Degenerates to a single violatesSeparation call for an uncomposed
// candidate/other pair (one-element category sets), so existing behavior is
// unchanged when composition is never involved.
export function violatesSeparationForCategories(
  candidate: { x: number; y: number; width: number; length: number },
  candidateCategories: Iterable<string>,
  others: { x: number; y: number; width: number; length: number; categories: Iterable<string> }[],
  rules: SeparationRule[] | undefined
): boolean {
  if (!rules || rules.length === 0) return false
  const candCats = [...new Set(candidateCategories)]
  if (candCats.length === 0) return false
  const expandedOthers: { x: number; y: number; width: number; length: number; category?: string }[] = []
  for (const other of others) {
    for (const cat of new Set(other.categories)) {
      expandedOthers.push({ x: other.x, y: other.y, width: other.width, length: other.length, category: cat })
    }
  }
  for (const candCat of candCats) {
    if (violatesSeparation({ ...candidate, category: candCat }, expandedOthers, rules)) return true
  }
  return false
}

export interface PlacedItem {
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  height: number
  layers: number // how many tiers stacked on this footprint
  stackedCount: number // units actually placed here (layers)
  rotated: boolean
  color: string
  // Weight of ONE unit, not the whole stack — every consumer that wants
  // the stack's real weight multiplies by `layers`/`stackedCount` itself
  // (result.totalWeight, breakdown[].weight, zone-load density,
  // buildCargoWeightMoments). This has been the recurring source of bugs
  // in this codebase: any new consumer of `weight` that forgets the
  // multiplication silently understates the real load. Before adding one,
  // check whether it needs `weight * stackedCount` (almost always yes for
  // anything physical — inertial force, pressure, moment).
  weight?: number
  index: number
  shape?: CargoShape
  outline?: { x: number; y: number }[] // see CargoItem.outline — same local/unrotated convention
  clearanceMargin?: ClearanceMargin // see PinnedPlacement.clearanceMargin — only pinned/manual placements ever carry one
  contents?: string // see CargoItem.contents — resolved fresh from the source item, shown as a hover tooltip
  locked?: boolean // see PinnedPlacement.locked — only ever set on pin-sourced placements, never on freshly algorithm-placed ones
  stabilityOverride?: StabilityOverride // see CargoItem.stabilityOverride — resolved fresh from the source item
  // See CargoItem.nest — resolved fresh from the source item, same pattern
  // as stabilityOverride above. The 2D/3D renderers need the full spec
  // (pipesPerRow/tierCounts) to draw the real stack, not just its VCG.
  nest?: PipeNestSpec
  // Copied through verbatim from the source ManualPlacement/PinnedPlacement
  // — see CompositionSegment's own doc comment for the full contract.
  // NEVER synthesized here: packDeck/packingResultFromManual only copy an
  // EXISTING composition, they never create one where the source placement
  // didn't have it (that would make construction a second production
  // writer of composition, alongside merge — exactly what the staged
  // migration is designed to prevent; merge stays the only writer until
  // that round explicitly flips on). When present, this is the source of
  // truth for a composition-aware consumer (stability.ts, and later
  // lashing/quantity/3D-rendering rounds); `weight`/`height` above become a
  // backward-compatible AVERAGE-per-unit fallback for consumers that
  // haven't been updated yet (weight*stackedCount / height*stackedCount
  // still reconstruct the correct TOTAL, since the average is weighted —
  // but neither field alone is meaningful for anything that needs to know
  // which constituent contributed what, e.g. VCG, which is why stability.ts
  // reads `composition` directly instead of trusting this fallback).
  composition?: CompositionSegment[]
  // Round 29 corrective pass 4A red-team gate (G1). Pre-computed pyramid
  // spread margin via resolvePyramidShape's "ANY constituent is pipe" rule —
  // DELIBERATELY separate from `shape` above. `shape` (resolveUniformShape)
  // is undefined for a composition whose constituents don't all agree, since
  // Deck3DView.tsx reads it directly to decide how to draw the WHOLE
  // placement and a mixed [box,pipe] stack has no single honest visual
  // shape. But pyramid margin is a pure collision-safety reservation, not a
  // visual claim — it must still reserve room whenever ANY constituent could
  // physically be a pipe, even when `shape` itself has to stay undefined.
  // withHardBlockFootprint (and the free-space overlay in
  // computeFreeRects/zone code) prefer this field when present instead of
  // re-deriving from `shape`/`height`, which would silently lose the margin
  // the moment `shape` is undefined for a mixed composition. undefined here
  // means "no pyramid margin needed" (no pipe-shaped constituent at all).
  pyramidMargin?: { onWidth: number; onLength: number }
}

export interface UnplacedItem {
  itemId: string
  name: string
  width: number
  length: number
  reason: string
}

// Round 29 (malformed-placement contract, corrected — see the R29 audit's
// own finding that `UnplacedItem` was the wrong channel). `UnplacedItem`
// means "N units of catalog item X couldn't be placed" — a cargo-QUANTITY
// aggregate, never a placement record (it has no id of its own, and
// packMultiTrip's carry-forward treats every entry as more of that catalog
// item to try on the next trip). A malformed placement (see
// PinnedPlacement.malformed) is a different kind of fact — a specific,
// individually-identified STORE RECORD whose physical identity couldn't be
// trusted — and routing it through `unplaced` let packMultiTrip silently
// duplicate a real catalog item's carried-forward quantity whenever the
// malformed placement's raw `itemId` happened to also be a valid one (the
// common case for `malformed.invalidComposition`). `QuarantinedPlacement`
// is a deliberately separate, disjoint channel: diagnostic-only, never
// read by packMultiTrip/packDeckVariants/any capacity or quantity
// calculation, and never intended as a means to reconstruct the original
// placement (see PinnedPlacement.malformed's own `rawComposition` for
// that, purely for future human/tooling diagnosis).
export interface QuarantinedPlacement {
  id: string // the placement's OWN id — unlike UnplacedItem, this names a specific store record
  itemId: string
  name: string
  reason: string
}

export interface ItemBreakdown {
  itemId: string
  name: string
  color: string
  requested: number
  placed: number // units placed (including stacking)
  footprints: number // number of floor slots occupied
  layers: number // max tiers for this item type
  area: number // footprint area used
  weight: number // total weight of placed units
  unitWeight: number
}

export interface PackingResult {
  placed: PlacedItem[]
  unplaced: UnplacedItem[]
  // Round 29 (corrected) — see QuarantinedPlacement's own doc comment for
  // why this is a separate channel from `unplaced`, never merged into it.
  quarantined: QuarantinedPlacement[]
  breakdown: ItemBreakdown[]
  requestedCount: number // total number of item units requested
  placedCount: number // total units placed (including stacking)
  totalArea: number
  usedArea: number
  freeArea: number
  utilization: number // 0..1 (footprint)
  totalWeight: number
  maxStackHeight: number
  deckWidth: number
  deckLength: number
}

export type SortStrategy = 'area-desc' | 'area-asc' | 'width-desc' | 'length-desc' | 'quantity-desc' | 'none'

// ---- numeric guards ----

function toFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function toPositiveInt(value: number, fallback = 1): number {
  const v = Math.round(toFinite(value, fallback))
  return v > 0 ? v : fallback
}

/** Coerce a layer/stack count to a positive integer (NaN/Infinity/≤0 safe). */
export function toLayers(value: number, fallback = 1): number {
  return toPositiveInt(value, fallback)
}

type FreeRect = Rect

function intersects(a: Rect, b: Rect): boolean {
  return !(
    b.x >= a.x + a.width ||
    b.x + b.width <= a.x ||
    b.y >= a.y + a.height ||
    b.y + b.height <= a.y
  )
}

function isContainedIn(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  )
}

function pruneFreeList(list: FreeRect[]): void {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; ) {
      if (isContainedIn(list[i], list[j])) {
        list.splice(i, 1)
        i--
        break
      } else if (isContainedIn(list[j], list[i])) {
        list.splice(j, 1)
      } else {
        j++
      }
    }
  }
}

interface ScoredNode {
  node: Rect
  rotated: boolean
  shortSide: number
  longSide: number
}

// Best Short Side Fit
function findPosition(
  freeRects: FreeRect[],
  width: number,
  height: number,
  allowRotation: boolean
): ScoredNode | null {
  let best: ScoredNode | null = null
  let bestShort = Infinity
  let bestLong = Infinity

  for (const fr of freeRects) {
    // Normal orientation
    if (fr.width >= width && fr.height >= height) {
      const leftoverHoriz = fr.width - width
      const leftoverVert = fr.height - height
      const shortSide = Math.min(leftoverHoriz, leftoverVert)
      const longSide = Math.max(leftoverHoriz, leftoverVert)
      if (
        shortSide < bestShort ||
        (shortSide === bestShort && longSide < bestLong)
      ) {
        best = {
          node: { x: fr.x, y: fr.y, width, height },
          rotated: false,
          shortSide,
          longSide,
        }
        bestShort = shortSide
        bestLong = longSide
      }
    }
    // Rotated orientation (swap width/height)
    if (allowRotation && fr.width >= height && fr.height >= width) {
      const leftoverHoriz = fr.width - height
      const leftoverVert = fr.height - width
      const shortSide = Math.min(leftoverHoriz, leftoverVert)
      const longSide = Math.max(leftoverHoriz, leftoverVert)
      if (
        shortSide < bestShort ||
        (shortSide === bestShort && longSide < bestLong)
      ) {
        best = {
          node: { x: fr.x, y: fr.y, width: height, height: width },
          rotated: true,
          shortSide,
          longSide,
        }
        bestShort = shortSide
        bestLong = longSide
      }
    }
  }
  return best
}

function placeRect(used: Rect, freeRects: FreeRect[]): void {
  const next: FreeRect[] = []
  for (const fr of freeRects) {
    if (!intersects(fr, used)) {
      next.push(fr)
      continue
    }
    if (used.x < fr.x + fr.width && used.x + used.width > fr.x) {
      if (used.x > fr.x) {
        next.push({
          x: fr.x,
          y: fr.y,
          width: used.x - fr.x,
          height: fr.height,
        })
      }
      if (used.x + used.width < fr.x + fr.width) {
        next.push({
          x: used.x + used.width,
          y: fr.y,
          width: fr.x + fr.width - (used.x + used.width),
          height: fr.height,
        })
      }
    }
    if (used.y < fr.y + fr.height && used.y + used.height > fr.y) {
      if (used.y > fr.y) {
        next.push({
          x: fr.x,
          y: fr.y,
          width: fr.width,
          height: used.y - fr.y,
        })
      }
      if (used.y + used.height < fr.y + fr.height) {
        next.push({
          x: fr.x,
          y: used.y + used.height,
          width: fr.width,
          height: fr.y + fr.height - (used.y + used.height),
        })
      }
    }
  }
  pruneFreeList(next)
  freeRects.length = 0
  freeRects.push(...next)
}


// Decomposes "inside the [0,width]×[0,length] bounding box but OUTSIDE the
// deck outline polygon" into a set of axis-aligned rectangles, so the
// existing rectangle-only free-space machinery (placeRect, already used to
// reserve pinned-stack cells) can treat a non-rectangular deck exactly like
// a bunch of pre-occupied cells — the bin-packer itself never learns about
// polygons at all.
//
// Vertical scanline decomposition: slice the bounding box into vertical
// strips at each distinct outline-vertex X (deduped within EPS), then for
// each strip cast a ray at its horizontal midpoint against every polygon
// edge, collect the Y crossings, sort them, and pair them up even/odd
// (standard scanline-fill rule) to get the polygon's inside-Y span(s) in
// that strip. Everything above the first span and below the last (plus any
// gaps between multiple spans, for a shape that's concave top-to-bottom) is
// excluded. Correct for any simple polygon, convex or concave — O(n²)
// worst case (n = vertex count), trivial for hand-drawn outlines.
const SCANLINE_EPS = 1e-6
export function deckOutlineExclusionRects(
  outline: { x: number; y: number }[],
  width: number,
  length: number
): Rect[] {
  if (outline.length < 3) return []
  const xs = Array.from(new Set(outline.map((p) => p.x))).sort((a, b) => a - b)
  const dedupedXs: number[] = []
  for (const x of xs) {
    if (dedupedXs.length === 0 || x - dedupedXs[dedupedXs.length - 1] > SCANLINE_EPS) dedupedXs.push(x)
  }
  // Clip the strip range to the bounding box — a hand-drawn outline is
  // already meant to stay within it, but this keeps the result well-formed
  // even if a point sits exactly on/past the edge due to float drift.
  const clampedXs = [0, ...dedupedXs.filter((x) => x > 0 && x < width), width]

  // A strip between two adjacent vertex X's is sampled at ONE midpoint — for
  // a near-vertical edge that's a fine approximation, but a wide strip with
  // a shallow-sloped edge (e.g. a hand-drawn diagonal spanning many meters)
  // gets badly misrepresented as a single flat-topped rect, potentially
  // excluding real deck area at one end of the strip while leaving too much
  // at the other. Subdivide each strip into narrower sub-strips so the
  // staircase actually hugs the real edge; capped so a huge/degenerate
  // outline can't blow this up.
  const maxSubWidth = Math.max(width, length, SCANLINE_EPS) / 100
  const MAX_SUBSTRIPS_PER_STRIP = 64

  const out: Rect[] = []
  for (let i = 0; i < clampedXs.length - 1; i++) {
    const stripLo = clampedXs[i]
    const stripHi = clampedXs[i + 1]
    if (stripHi - stripLo <= SCANLINE_EPS) continue
    const subCount = Math.min(
      MAX_SUBSTRIPS_PER_STRIP,
      Math.max(1, Math.ceil((stripHi - stripLo) / maxSubWidth))
    )
    const subWidth = (stripHi - stripLo) / subCount
    for (let s = 0; s < subCount; s++) {
      const xLo = stripLo + s * subWidth
      const xHi = s === subCount - 1 ? stripHi : xLo + subWidth
      const xMid = (xLo + xHi) / 2

      const ys: number[] = []
      for (let j = 0; j < outline.length; j++) {
        const p1 = outline[j]
        const p2 = outline[(j + 1) % outline.length]
        if ((p1.x <= xMid && p2.x > xMid) || (p2.x <= xMid && p1.x > xMid)) {
          const t = (xMid - p1.x) / (p2.x - p1.x)
          ys.push(p1.y + t * (p2.y - p1.y))
        }
      }
      ys.sort((a, b) => a - b)

      let prevY = 0
      for (let k = 0; k < ys.length; k += 2) {
        const yLo = ys[k]
        const yHi = ys[k + 1] ?? length
        if (yLo - prevY > SCANLINE_EPS) {
          out.push({ x: xLo, y: prevY, width: xHi - xLo, height: yLo - prevY })
        }
        prevY = yHi
      }
      if (length - prevY > SCANLINE_EPS) {
        out.push({ x: xLo, y: prevY, width: xHi - xLo, height: length - prevY })
      }
    }
  }
  return out
}

// Symmetric to deckOutlineExclusionRects, but emits the INSIDE spans of the
// polygon directly (not their complement) — used to reserve a restriction
// zone's own footprint as excluded free-rect cells, via the same scanline
// decomposition (so any shape, including a hand-derived triangle/oval/
// diamond, decomposes correctly, not just axis-aligned rectangles). For a
// plain 'rect' zone this degenerates to exactly one rect: the bbox itself.
export function polygonInsideRects(
  polygon: { x: number; y: number }[],
  width: number,
  length: number
): Rect[] {
  if (polygon.length < 3) return []
  const xs = Array.from(new Set(polygon.map((p) => p.x))).sort((a, b) => a - b)
  const dedupedXs: number[] = []
  for (const x of xs) {
    if (dedupedXs.length === 0 || x - dedupedXs[dedupedXs.length - 1] > SCANLINE_EPS) dedupedXs.push(x)
  }
  if (dedupedXs.length < 2) return []
  const maxSubWidth = Math.max(width, length, SCANLINE_EPS) / 100
  const MAX_SUBSTRIPS_PER_STRIP = 64

  const out: Rect[] = []
  for (let i = 0; i < dedupedXs.length - 1; i++) {
    const stripLo = dedupedXs[i]
    const stripHi = dedupedXs[i + 1]
    if (stripHi - stripLo <= SCANLINE_EPS) continue
    const subCount = Math.min(
      MAX_SUBSTRIPS_PER_STRIP,
      Math.max(1, Math.ceil((stripHi - stripLo) / maxSubWidth))
    )
    const subWidth = (stripHi - stripLo) / subCount
    for (let s = 0; s < subCount; s++) {
      const xLo = stripLo + s * subWidth
      const xHi = s === subCount - 1 ? stripHi : xLo + subWidth
      const xMid = (xLo + xHi) / 2

      const ys: number[] = []
      for (let j = 0; j < polygon.length; j++) {
        const p1 = polygon[j]
        const p2 = polygon[(j + 1) % polygon.length]
        if ((p1.x <= xMid && p2.x > xMid) || (p2.x <= xMid && p1.x > xMid)) {
          const t = (xMid - p1.x) / (p2.x - p1.x)
          ys.push(p1.y + t * (p2.y - p1.y))
        }
      }
      ys.sort((a, b) => a - b)

      for (let k = 0; k < ys.length; k += 2) {
        const yLo = ys[k]
        const yHi = ys[k + 1]
        if (yHi === undefined) break
        if (yHi - yLo > SCANLINE_EPS) {
          out.push({ x: xLo, y: yLo, width: xHi - xLo, height: yHi - yLo })
        }
      }
    }
  }
  return out
}

export interface PackOptions {
  sortStrategy?: SortStrategy
  gap?: number // spacing between items
  boardOffset?: number // margin from the ship's board (deck edge)
  clearance?: number // max stack height above deck (0 = single tier)
  pinned?: PinnedPlacement[] // user-pinned stacks that must keep their positions
  separationRules?: SeparationRule[] // category-pair minimum-distance rules
  outline?: { x: number; y: number }[] // non-rectangular deck silhouette, see deckOutlineExclusionRects
  restrictionZones?: RestrictionZone[] // hard-blocked obstacle zones (crane, bulwark, etc.)
  // Load zones with a t/m² limit — SOFT preference, not a hard obstacle
  // (unlike restrictionZones above): the packer retries a few alternate
  // free rectangles looking for one that doesn't push a zone over its
  // limit, but if every candidate would overload something anyway, it
  // still places the item at the original best-fit position rather than
  // leaving it unplaced. See the retry loop around findPosition in
  // packDeck's main placement loop for the exact mechanics.
  loadZones?: LoadZone[]
  // Needed only to convert loadZones' real t/m² limit against the deck's
  // own display unit (m/cm/ft) — see src/lib/units.ts. Everything else in
  // this file is unit-agnostic (deck/item/zone geometry is always
  // internally consistent regardless of what unit it's expressed in), but
  // maxLoadPerArea is always a real physical t/m² figure, never scaled by
  // display unit, so it's the one place packDeck needs to know which unit
  // its own geometry inputs are actually in.
  unit?: Unit
  // The vessel's own approved total deck-cargo capacity, in kg (real
  // physical limit — HARD stop, unlike loadZones above). A stack that
  // would push the running total over this is left unplaced (same
  // "unplaced, try the next item" pattern as running out of space) rather
  // than aborting the whole placement loop, so lighter cargo further down
  // the queue still gets a chance to fit within what's left of the budget.
  maxTotalWeightKg?: number
}

// One physical run of stacked units of the SAME item within a composed
// (cross-item-merged) placement — see ManualPlacement.composition/
// PinnedPlacement.composition's own doc comment for the full contract.
// Ordered bottom-to-top; ADJACENT segments of the same itemId are always
// coalesced into one, but two segments of the same itemId separated by a
// different item's segment are deliberately kept apart — collapsing them
// would lose which physical layer sits where in the pile. See
// src/lib/placementComposition.ts for the pure functions that read/write
// this array — nothing else should hand-roll composition arithmetic.
export interface CompositionSegment {
  itemId: string
  layers: number
}

export interface PinnedPlacement {
  id: string // unique pin id
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  layers: number
  rotated: boolean
  color: string
  weight?: number // per-unit — see PlacedItem.weight's doc comment above; multiply by `layers` for the stack's real weight
  // Hard-blocking exclusion margin (deck units, e.g. meters) around this
  // placement — an alternative to individual lashing points, not a
  // combination of both (see clearLashingPointsFor in calculator.ts).
  // Other cargo cannot be placed, dragged, or auto-packed into this margin.
  clearanceMargin?: ClearanceMargin
  // User-set lock, toggled via the deck's right-click "Закрепить"/
  // "Открепить" menu — purely a drag gate (a locked placement stops
  // responding to pointer-drag until unlocked). Unset/false = draggable,
  // the default the moment a placement is first created (by dragging an
  // algorithmic item or clicking to place a new one) — locking is always a
  // separate, deliberate follow-up action, never a side effect of moving
  // or creating a placement.
  locked?: boolean
  // See CargoItem.stabilityOverride — overrides the per-item default only
  // for this specific placement. Never affects packing/collision.
  stabilityOverride?: StabilityOverride
  // РД 31.11.21.23-96 п. 2.2.3 lashing count — see requiredLashingCount.
  // Which wire rope the required-count readout is computed against.
  lashingWireType?: WireRopeType
  // Free-text justification, required in the UI when the user's actual
  // attached lashing-point count is below the computed requirement — real
  // stowage (timber cribs, hull contact) can legitimately need fewer than
  // the formula suggests, but that must be a stated reason, not a silent
  // shortfall. Surfaced as-is in the PDF export.
  lashingJustification?: string
  // Set when a merge (planComposedMerge, page.tsx) combines this placement
  // with a constituent whose CargoItem.allowRotation is false — rotation
  // permission is normally resolved fresh from `items.find(itemId)` by
  // itemId alone, which only ever sees ONE item's own allowRotation.
  // planComposedMerge aggregates this across EVERY constituent on BOTH
  // sides of the merge (not just the two nominal itemIds), so a
  // non-rotatable unit folded in anywhere in the resulting composition sets
  // this. Most-restrictive-wins: once set, this placement can never rotate
  // again regardless of what its own itemId's CargoItem allows. Never
  // cleared automatically — a merge is a one-way operation here.
  rotationLocked?: boolean
  // Present ONLY on a placement that physically contains units of more than
  // one CargoItem (a composed placement). When present, this is the SOLE
  // source of truth for the placement's physical makeup — `itemId`/
  // `layers`/`weight` above become nominal/derived mirrors (itemId =
  // whichever constituent currently "owns" the stack's identity;
  // layers/weight must equal placementTotalLayers/placementTotalWeightKg of
  // this array, never written independently for a composed placement).
  // Absent (still the common case) means an ordinary single-item
  // placement — itemId/layers/weight keep their existing meaning. Created
  // exclusively by planComposedMerge's bulk-absorption merge (page.tsx) and
  // consumed throughout: packDeck's pin loop, packingResultFromManual,
  // stability.ts's per-segment VCG/TCG/LCG, lashing (Sidebar.tsx,
  // exportPdf.ts), rendering (Deck3DView.tsx's per-segment tier height),
  // the `+`/`-` push/pop handlers, removeItem's per-constituent quantity
  // surgery, and quantity accounting (checkLayerChange). See
  // src/lib/placementComposition.ts for the shared arithmetic every one of
  // these consumers is meant to call into rather than re-derive locally.
  composition?: CompositionSegment[]
  // Set by normalizeProject (projects.ts) on load, ONLY for a placement
  // with no `composition` whose `weight` doesn't match its own itemId's
  // current catalog weight — a reliable signal (for anything saved since
  // Round 7's applyWeight) that this placement is a cross-item merge ghost
  // from before `composition` existed (Round 10 era): its real physical
  // makeup was already lost before this field could ever be introduced,
  // and nothing should silently guess at or "fix" it. See the migration
  // plan's Legacy migration section for the detection/UI-treatment
  // contract — a human has to explicitly clear this, nothing does so
  // automatically (in particular, updateItem's weight-sync must NOT
  // silently resync a placement carrying this flag).
  //
  // Distinct from `malformed.invalidComposition` below: this fires ONLY
  // when the raw saved placement never had a `composition` field at all —
  // a pre-Round-24 merge ghost, detected purely by a weight-vs-catalog
  // mismatch heuristic. It is NOT a proxy for "composition was present but
  // rejected" — that is a different, non-heuristic signal (see `malformed`).
  legacyUnknownComposition?: true
  // Round 29 (malformed-placement hydration contract — see the migration
  // plan's cross-path state-integrity audit, R28/R29). Set by
  // normalizeProject when a placement's physical identity can't be fully
  // trusted after loading untrusted/hand-edited/corrupted JSON:
  //   - `unresolvedItem`: the top-level `itemId` doesn't resolve to any
  //     CargoItem in the project's own catalog (unknown id, or missing/
  //     non-string input normalized to `''`). Set REGARDLESS of whether
  //     `composition` is present and valid — see the two-tier contract
  //     below for why that still matters.
  //   - `invalidComposition`: the raw saved `composition` value WAS
  //     present (not `undefined`) but failed validation (unknown
  //     constituent, bad segment shape, etc.) — normalizeComposition
  //     rejects the WHOLE array in this case, so `composition` above ends
  //     up `undefined` exactly as it would for a placement that never had
  //     one; this flag is the only way to tell those two apart.
  //   - `rawComposition`: the original (rejected) raw composition value,
  //     preserved VERBATIM (not re-validated, not typed) purely for future
  //     diagnosis/recovery tooling — never read by any calculation.
  //
  // Two-tier contract (see the R29 report for the full reasoning): a
  // placement with `composition` present and valid stays FULLY ACTIVE in
  // packing/stability/capacity/quantity even if `unresolvedItem` is also
  // set — every physical calculation already derives from `composition`
  // alone once it exists (segmentsOf never reads `itemId` when
  // `composition` is set), proven by R28.3's own consumer sweep. A
  // placement with NO valid composition to fall back on (either
  // `invalidComposition`, or `unresolvedItem` with no composition at all)
  // is excluded from `packDeck`/`packingResultFromManual`'s `result.placed`
  // entirely (reported in `result.unplaced` instead) — it must never be
  // silently treated as an ordinary single-item placement using its raw,
  // untrustworthy `layers`/`weight`. The underlying record is NEVER deleted
  // or auto-repaired either way — only which physical calculations it may
  // participate in changes.
  malformed?: {
    unresolvedItem?: true
    invalidComposition?: true
    rawComposition?: unknown
  }
}

// Compute how many tiers (layers) can be stacked for an item. When the deck
// actually has a configured height budget (clearance > 0), `item.maxLayers`
// (user-set per-item cap) is combined with that clearance-height ceiling by
// taking the minimum of the two — whichever is more restrictive wins, since
// both are then real physical constraints. But clearance = 0 isn't itself a
// physical "only 1 fits" fact — it's the deck-wide default for "no height
// budget was ever configured" (see the deck settings' own "0 = один ярус"
// hint). An explicit per-item maxLayers is a much more specific, deliberate
// signal than that blanket default, so it wins outright when clearance is
// unset — previously it was silently intersected down to 1 regardless of
// what the user typed, which read as "the Ярусов field does nothing."
// A per-item stack-height ceiling in METRES — e.g. "трубы этого типа
// нельзя штабелировать выше 3,0 м" (ДВТК п. 2.1.2), which is a fact about
// the cargo/method, not about the deck. Deliberately separate from the
// deck-wide `clearance`: that field is one number for the WHOLE deck, so it
// cannot express "this pipe type is capped at 3 m but that container isn't"
// — previously the only way to get a 3 m cap at all was to set clearance
// itself, which then silently capped every other cargo type too.
export function maxLayersFor(
  item: { height: number; maxLayers?: number; maxStackHeightM?: number },
  clearance: number
): number {
  const h = toFinite(item.height, 0)
  const c = toFinite(clearance, 0)
  const itemCapM = toFinite(item.maxStackHeightM ?? 0, 0)
  const userCap = item.maxLayers && item.maxLayers > 0 ? Math.floor(item.maxLayers) : undefined
  // Whichever height budget is actually configured (and tighter) wins; a
  // budget of 0 means "not configured", not "zero metres allowed".
  const budget = c > 0 && itemCapM > 0 ? Math.min(c, itemCapM) : c > 0 ? c : itemCapM > 0 ? itemCapM : 0
  if (budget <= 0) return userCap ?? 1
  let heightCap = 1
  if (h > 0) {
    const raw = budget / h
    // A tiny epsilon prevents values like 1.9999999999999998 from losing a layer.
    if (Number.isFinite(raw)) heightCap = Math.max(1, Math.floor(raw + 1e-9))
  }
  return Math.max(1, Math.min(heightCap, userCap ?? Infinity))
}

export function packDeck(
  deckWidth: number,
  deckLength: number,
  itemsArg: CargoItem[],
  options: PackOptions | SortStrategy = 'area-desc'
): PackingResult {
  const sortStrategy =
    typeof options === 'string' ? options : options.sortStrategy ?? 'area-desc'
  const gap = toFinite(typeof options === 'string' ? 0 : options.gap ?? 0, 0)
  const boardOffset = toFinite(
    typeof options === 'string' ? 0 : options.boardOffset ?? 0,
    0
  )
  const clearance = toFinite(
    typeof options === 'string' ? 0 : options.clearance ?? 0,
    0
  )
  const pinned = typeof options === 'string' ? [] : options.pinned ?? []
  const separationRules = typeof options === 'string' ? [] : options.separationRules ?? []
  const outline = typeof options === 'string' ? undefined : options.outline
  const restrictionZones = typeof options === 'string' ? [] : options.restrictionZones ?? []
  const loadZones = typeof options === 'string' ? [] : options.loadZones ?? []
  const unit: Unit = typeof options === 'string' ? 'm' : options.unit ?? 'm'
  const maxTotalWeightKg = typeof options === 'string' ? undefined : options.maxTotalWeightKg

  // Sanitize deck dimensions and spacing so NaN/Infinity can't poison the result.
  const safeDeckWidth = toFinite(deckWidth, 0)
  const safeDeckLength = toFinite(deckLength, 0)
  // The bounding-box rectangle stays authoritative for every other
  // computation below (clamping, free-rect splitting, collision) — only the
  // reported total area needs the polygon's true (smaller) size.
  const totalArea = outline && outline.length >= 3 ? polygonArea(outline) : safeDeckWidth * safeDeckLength

  // Sanitize cargo items: coerce numeric fields to finite values so corrupted
  // storage or programmatic input can't propagate NaN into aggregations.
  const items = (Array.isArray(itemsArg) ? itemsArg : []).map((it) => ({
    ...it,
    width: toFinite(it.width, 1),
    length: toFinite(it.length, 1),
    height: toFinite(it.height, 0),
    // NOT toPositiveInt: quantity 0 is a legitimate "none of this cargo left"
    // (e.g. after deleting the last placed unit), not a corrupted value —
    // toPositiveInt treats 0 the same as NaN and would silently re-pack 1
    // unit anyway. Only genuinely invalid input (NaN/undefined/negative)
    // falls back to 1.
    quantity: Math.max(0, Math.round(toFinite(it.quantity, 1))),
    // Defense-in-depth: the store's own normalizeProject already rejects a
    // negative weight before it's ever persisted, but packDeck is a
    // separate engineering-layer entry point in its own right (tests, or
    // any future caller) that shouldn't have to rely on every caller
    // upstream having already filtered it.
    weight: it.weight === undefined || it.weight < 0 ? undefined : toFinite(it.weight, 0),
  }))
  const heightByItemId = new Map(items.map((it) => [it.id, it.height]))
  const outlineByItemId = new Map(items.map((it) => [it.id, it.outline]))
  const contentsByItemId = new Map(items.map((it) => [it.id, it.contents]))
  const stabilityOverrideByItemId = new Map(items.map((it) => [it.id, it.stabilityOverride]))
  // A 'pipe-nest' item's width/length/height/weight already describe the
  // WHOLE штабель (see PipeNestSpec's own doc comment) — nothing here needs
  // to know that. The only things packing/rendering can't derive on their
  // own are the real nested-geometry VCG (vs the flat half-height default)
  // and the row/tier layout for drawing — so the whole spec is looked up by
  // id and copied onto the placement, same pattern as every other per-item
  // extra above.
  const nestByItemId = new Map(items.map((it) => [it.id, it.nest]))
  const requestedCount = items.reduce((s, it) => s + it.quantity, 0)
  const result: PackingResult = {
    placed: [],
    unplaced: [],
    quarantined: [],
    breakdown: [],
    requestedCount,
    placedCount: 0,
    totalArea,
    usedArea: 0,
    freeArea: totalArea,
    utilization: 0,
    totalWeight: 0,
    maxStackHeight: 0,
    deckWidth: safeDeckWidth,
    deckLength: safeDeckLength,
  }

  if (safeDeckWidth <= 0 || safeDeckLength <= 0) return result

  const hasOutline = !!outline && outline.length >= 3
  // Usable region after board offset (margin from the ship's board).
  // The packer draws each item at `cell origin + gap/2` (symmetric gap model),
  // so the free-rect origin is pulled in by gap/2 to compensate — otherwise the
  // first item at the boundary would sit at `boardOffset + gap/2` instead of
  // exactly `boardOffset`, which would disagree with manual/pinned placements
  // (validated and clamped to exactly `boardOffset`, see below and clampToDeck).
  const halfGap = gap / 2
  const ux = Math.max(0, boardOffset - halfGap)
  const uy = Math.max(0, boardOffset - halfGap)
  const uw = Math.max(0, safeDeckWidth - boardOffset * 2 + gap)
  const ul = Math.max(0, safeDeckLength - boardOffset * 2 + gap)

  // Non-rectangular deck: board offset is an inset along the real contour
  // (erodePolygon), not the bounding box — otherwise a cut/diagonal edge
  // would get zero clearance while the deck's straight sides got the normal
  // margin.
  //
  // Two earlier versions of this fix both proved insufficient on real user
  // data: (1) seeding the outline exclusion from a permissive
  // `boardOffset - gap/2` erosion (so the flat "+gap/2" per-cell shift
  // below compensates back to exactly `boardOffset`, mirroring the
  // rectangular-deck seed rect) left a gap that scaled with an item's own
  // width along a slanted edge — fine for a 1.5m box, not for a 6.06m
  // container on the very same edge; (2) switching to a strict, full
  // `boardOffset` erosion for the exclusion rects shrank that gap but
  // didn't eliminate it, because `deckOutlineExclusionRects`'s own
  // rectangular-slab approximation of a continuously sloped edge and
  // `rectInsidePolygon`'s exact polygon-corner-containment test are two
  // DIFFERENT geometric methods that will never perfectly agree, no matter
  // how strict either one's erosion amount is.
  //
  // The actual fix: stop comparing against a second, independently-computed
  // method at all. A pin is valid here iff it does not overlap any of the
  // SAME exclusion rects the free-cell search itself is built from — the
  // literal computation that already determines what the packer considers
  // placeable. Since a pin the packer's own free-rect search would offer
  // can, by construction, never overlap those rects, this can no longer
  // disagree with the packer's own placement decisions, for cargo of any
  // size or any outline shape.
  const usableOutline = hasOutline ? erodePolygon(outline!, boardOffset) : undefined
  const outlineExclusionRects = hasOutline
    ? deckOutlineExclusionRects(usableOutline!, safeDeckWidth, safeDeckLength)
    : undefined
  const freeRects: FreeRect[] = hasOutline
    ? [{ x: 0, y: 0, width: safeDeckWidth, height: safeDeckLength }]
    : [{ x: ux, y: uy, width: uw, height: ul }]

  // Reserve the area outside a non-rectangular deck outline as pre-occupied
  // cells, BEFORE pinned stacks — exclusions are structural (part of the
  // deck's real shape), pins are dynamic reservations on top of that. The
  // bin-packer itself never learns about the polygon; it only ever sees one
  // more rectangle to route around, via the exact same placeRect mechanism
  // already used for pins below.
  if (hasOutline) {
    for (const rect of outlineExclusionRects!) {
      placeRect(rect, freeRects)
    }
  }

  // Restriction zones (crane, bulwark, etc.) are structural obstacles, same
  // tier as the deck outline itself — reserved before pinned stacks, via the
  // exact same placeRect mechanism, so the free-cell search never offers
  // that space to algorithmically-placed cargo either.
  const zoneExclusionRects: Rect[] = restrictionZones.flatMap((z) =>
    polygonInsideRects(restrictionZonePolygon(z), safeDeckWidth, safeDeckLength)
  )
  for (const rect of zoneExclusionRects) {
    placeRect(rect, freeRects)
  }

  // Account for units already placed in pinned stacks: reduce the quantity to pack.
  // IMPORTANT: only subtract for ACCEPTED pins (validated below), otherwise rejected
  // pins silently consume units that then vanish from both placed and unplaced.
  const remainingByItem = new Map<string, number>()
  for (const it of items) remainingByItem.set(it.id, it.quantity)

  // Reserve space for pinned stacks first: subtract their cells from free space.
  // Validate each pin: reject if it lies outside the usable area or overlaps
  // an already-accepted pin (these become unplaced instead of silently counted).
  let index = 0
  const acceptedPins: PinnedPlacement[] = []
  for (const pin of pinned) {
    // R29 (malformed-placement contract, corrected after the R29 audit
    // found the original version routed through `result.unplaced` —
    // `packMultiTrip`'s carry-forward reads that array by catalog itemId
    // and would silently duplicate a real item's carried-forward quantity
    // whenever the malformed pin's raw itemId happened to also be valid).
    // A pin with no valid `composition` to fall back on (either
    // `malformed.invalidComposition`, or `malformed.unresolvedItem` with no
    // composition at all) must never be treated as an ordinary single-item
    // placement using its raw, untrustworthy `layers`/`weight` — that would
    // silently reinterpret it as a different physical cargo (see the R28
    // audit's `[A2,B3,garbage]` -> "A6" finding). Excluded from
    // `result.placed` entirely, reported in the separate, disjoint
    // `result.quarantined` channel instead (see QuarantinedPlacement's own
    // doc comment) — never `unplaced`, which packMultiTrip/packDeckVariants
    // and capacity/quantity math all treat as "more of this catalog item
    // to place." The pin itself is never mutated or dropped from the
    // project. A pin with a VALID `composition` stays fully active even if
    // `unresolvedItem` is also set — every physical calculation below
    // already derives from `composition` alone, never from `itemId`, once
    // it exists.
    if (pin.malformed && !pin.composition) {
      result.quarantined.push({
        id: pin.id,
        itemId: pin.itemId,
        name: pin.name,
        reason: 'Груз повреждён — физический состав не удалось определить при загрузке проекта',
      })
      continue
    }
    // A pin's own `layers` is user/import-supplied and was never checked
    // against how many units of that item are actually left to place — a
    // pin with layers=10 when only 2 remain used to be placed in full,
    // silently pushing placedCount above requestedCount. Clamp here, before
    // the pin is accepted, rather than only clamping the separate remaining-
    // quantity counter afterward (which left the pin itself untouched).
    //
    // Composed pins are a DIFFERENT case, deliberately NOT put through this
    // same clamp: `composition` is this placement's sole source of physical
    // truth (see PlacedItem.composition's doc comment), so its own total
    // layer count is authoritative, full stop — clamping it against
    // `remainingByItem.get(pin.itemId)` would silently disagree with
    // `composition` itself (that map only ever tracks ONE nominal itemId's
    // quantity, never the several distinct items a composition can span),
    // which would break the invariant sum(composition.layers) ===
    // PlacedItem.layers the moment quantity ran short for the nominal item
    // alone. Reconciling composition against each CONSTITUENT's own
    // remaining quantity (redistributing a shortfall across A/B/...) is
    // real quantity-accounting work, explicitly out of scope for
    // construction — that belongs to the quantity round (composition isn't
    // reachable from the real merge/+/-/removeItem UI yet regardless, so
    // this has no production effect today).
    const requestedLayers = toLayers(pin.layers, 1)
    const remainingForItem = remainingByItem.get(pin.itemId) ?? 0
    const layers = pin.composition ? placementTotalLayers(pin) : Math.min(requestedLayers, remainingForItem)
    if (layers <= 0) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция превышает доступное количество этого груза',
      })
      continue
    }
    const insideOutline = hasOutline
      ? !outlineExclusionRects!.some((ex) => intersects({ x: pin.x, y: pin.y, width: pin.width, height: pin.length }, ex))
      : pin.x >= boardOffset - 1e-6 &&
        pin.y >= boardOffset - 1e-6 &&
        pin.x + pin.width <= safeDeckWidth - boardOffset + 1e-6 &&
        pin.y + pin.length <= safeDeckLength - boardOffset + 1e-6
    if (!insideOutline) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция вне палубы',
      })
      continue
    }
    const hitsZone = zoneExclusionRects.some((ex) =>
      intersects({ x: pin.x, y: pin.y, width: pin.width, height: pin.length }, ex)
    )
    if (hitsZone) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция попадает в зону ограничения',
      })
      continue
    }
    // Precise (not just bbox) so a pin dropped into another pin's custom-
    // shape notch — already accepted by the same collidesPrecisely check at
    // click-time in DeckVisualization — doesn't turn around and get flagged
    // "intersects" here, which would otherwise silently move it to
    // `unplaced` right after the UI told the user it was placed.
    const pinWithOutline = { x: pin.x, y: pin.y, width: pin.width, length: pin.length, rotated: pin.rotated, outline: outlineByItemId.get(pin.itemId) }
    const overlapsAccepted = acceptedPins.some((ap) => {
      const apWithOutline = { x: ap.x, y: ap.y, width: ap.width, length: ap.length, rotated: ap.rotated, outline: outlineByItemId.get(ap.itemId) }
      return (
        collidesPrecisely(pinWithOutline, [withClearanceFootprint(apWithOutline)], gap) ||
        collidesPrecisely(withClearanceFootprint(pinWithOutline), [apWithOutline], gap)
      )
    })
    if (overlapsAccepted) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция пересекается с другим грузом',
      })
      continue
    }
    // Composition-aware (R29 corrective pass 3): a Tier-1 pin's real
    // hazard categories live in its `composition`, not necessarily its
    // (possibly broken/unresolved) nominal itemId — see
    // violatesSeparationForCategories' own doc comment for why a single
    // reduced category string is wrong here.
    const violatesSep = violatesSeparationForCategories(
      { x: pin.x, y: pin.y, width: pin.width, length: pin.length },
      placementCategorySet(pin, items),
      acceptedPins.map((ap) => ({
        x: ap.x,
        y: ap.y,
        width: ap.width,
        length: ap.length,
        categories: placementCategorySet(ap, items),
      })),
      separationRules
    )
    if (violatesSep) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция нарушает сепарацию груза',
      })
      continue
    }
    acceptedPins.push(pin)
    // Subtract accepted pin layers from remaining quantity (only for
    // accepted pins). Round 15 (quantity scanning) closes the deferred issue
    // flagged in the P1 patch above: a composed pin must decrement EACH of
    // its own constituents' remaining quantity by that constituent's own
    // segment layers — not the nominal itemId's remaining count by the
    // pin's full total. Before this fix, [A2,B3] (nominal itemId=A) only
    // ever reduced A's remaining count (by the FULL 5, not just its own 2),
    // leaving B's remaining quantity completely untouched — a subsequent
    // AUTO-pack pass could then place up to B's full original quantity on
    // top of the 3 units already physically inside this pin. An uncomposed
    // pin's `layers` is already clamped to at most `remainingForItem` above,
    // so its single Math.max(0, ...) subtraction can never go negative;
    // clamped to 0 here for the same reason on each composed segment too.
    if (pin.composition) {
      for (const seg of pin.composition) {
        const segRemaining = remainingByItem.get(seg.itemId) ?? 0
        remainingByItem.set(seg.itemId, Math.max(0, segRemaining - seg.layers))
      }
    } else {
      remainingByItem.set(pin.itemId, Math.max(0, remainingForItem - layers))
    }
    // Symmetric gap: reserve cell (pin.x - gap/2, pin.y - gap/2, w+gap, l+gap).
    // A clearanceMargin (hard-blocking exclusion zone) reserves the further-
    // inflated cell instead, so the free-rect splitter never offers that
    // space to algorithmically-placed (non-pinned) cargo either. Same
    // pyramid-spread widening as the fresh-stack loop above — a manually
    // placed/locked pipe stack must exclude its true pyramid footprint too,
    // or other cargo could still be auto-packed into space its pyramid
    // actually occupies once other stacks are laid out around it.
    const cm = pin.clearanceMargin
    // Composition-aware geometry fallback (R29 corrective pass 4 — see
    // resolvePyramidShape's own doc comment for why segments[0] alone,
    // Pass 3's fix, isn't safe for a hydrated/imported composition that
    // never went through planComposedMerge's uniformity gate).
    const pinGeom = resolvePyramidShape(pin, pin.width, pin.length, items)
    const pinSpread = pipePyramidSpreadMargin(
      { shape: pinGeom.shape, width: pin.width, length: pin.length, height: pinGeom.height },
      layers
    )
    placeRect(
      {
        x: pin.x - gap / 2 - (cm?.left ?? 0) - pinSpread.onWidth,
        y: pin.y - gap / 2 - (cm?.top ?? 0) - pinSpread.onLength,
        width: pin.width + gap + (cm?.left ?? 0) + (cm?.right ?? 0) + pinSpread.onWidth * 2,
        height: pin.length + gap + (cm?.top ?? 0) + (cm?.bottom ?? 0) + pinSpread.onLength * 2,
      },
      freeRects
    )
    // Copied through verbatim, NEVER synthesized — see PlacedItem.composition's
    // own doc comment. `weight`/`height` become a backward-compatible AVERAGE
    // per unit when composed, so `weight * layers` (every existing consumer's
    // convention) still reconstructs the correct TOTAL — composition-aware
    // consumers (stability.ts) read `pin.composition` directly instead.
    const pinWeight = pin.composition
      ? placementTotalWeightKg({ itemId: pin.itemId, layers: pin.layers, composition: pin.composition }, items) / Math.max(1, layers)
      : pin.weight
    const pinHeight = pin.composition
      ? placementTotalHeightM({ itemId: pin.itemId, layers: pin.layers, composition: pin.composition }, items) / Math.max(1, layers)
      : (heightByItemId.get(pin.itemId) ?? 0)
    result.placed.push({
      itemId: pin.itemId,
      name: pin.name,
      x: pin.x,
      y: pin.y,
      width: pin.width,
      length: pin.length,
      height: pinHeight,
      layers,
      stackedCount: layers,
      rotated: pin.rotated,
      color: pin.color,
      weight: pinWeight,
      index: index++,
      // shape/outline (R29 pass 4A, G1 red-team gate): resolveUniformShape,
      // NOT pinGeom above — `shape` feeds Deck3DView.tsx directly to decide
      // how to draw the WHOLE placement, so it must stay undefined unless
      // every constituent genuinely agrees, exactly like outline below.
      // pinGeom's "any constituent is pipe" rule is deliberately used ONLY
      // for the physical margin reservation above and pyramidMargin below —
      // conflating the two would either mis-render a mixed [box,pipe] stack
      // as a pure cylinder, or (the other direction) silently drop the
      // margin reservation the moment shape has to stay undefined for a
      // mixed composition. contents/stabilityOverride/nest are deliberately
      // left on pin.itemId: contents is cosmetic tooltip text; stability.ts
      // never reads PlacedItem.stabilityOverride for a composed placement
      // (it derives VCG/TCG/LCG per-segment from `composition` directly);
      // nest is structurally impossible on a composed placement (isPipeShape's
      // own merge gate excludes nested pipe items from ever merging) — so all
      // three are either inert or harmless for a Tier-1 placement regardless
      // of which itemId resolves.
      shape: resolveUniformShape(pin, items),
      outline: resolveUniformOutline(pin, items),
      // See PlacedItem.pyramidMargin's own doc comment — the physical
      // reservation computed above, carried forward so downstream
      // interactive-collision consumers (withHardBlockFootprint) don't have
      // to (and can't correctly) re-derive it from `shape` alone.
      pyramidMargin: pinSpread.onWidth === 0 && pinSpread.onLength === 0 ? undefined : pinSpread,
      contents: contentsByItemId.get(pin.itemId),
      clearanceMargin: pin.clearanceMargin,
      locked: pin.locked,
      // Same precedence fix as packingResultFromManual's own copy of this —
      // the pin's OWN override (if ever set) must win over the item's.
      stabilityOverride: pin.stabilityOverride ?? stabilityOverrideByItemId.get(pin.itemId),
      nest: nestByItemId.get(pin.itemId),
      composition: pin.composition,
    })
    result.usedArea += pin.width * pin.length
    result.placedCount += layers
    if (pinWeight) result.totalWeight += pinWeight * layers
  }

  // Expand each item into the number of STACKS (floor footprints) needed.
  // A stack holds up to `layers` units vertically. Only the REMAINING quantity
  // (after pinned stacks) is expanded.
  interface Stack {
    item: CargoItem
    layers: number
    unitsInStack: number // units this particular stack will hold
  }
  const stacks: Stack[] = []
  const perItemRemaining = new Map<string, number>()
  for (const it of items) perItemRemaining.set(it.id, remainingByItem.get(it.id) ?? it.quantity)

  for (const item of items) {
    if (item.width <= 0 || item.length <= 0) continue
    const remaining = remainingByItem.get(item.id) ?? 0
    if (remaining <= 0) continue
    const layers = maxLayersFor(item, clearance)
    let r = remaining
    while (r > 0) {
      const units = Math.min(layers, r)
      stacks.push({ item, layers, unitsInStack: units })
      r -= units
    }
  }

  // Sort stacks by footprint area desc for better packing
  const stackCmp = (a: Stack, b: Stack): number => {
    switch (sortStrategy) {
      case 'area-desc':
        return b.item.width * b.item.length - a.item.width * a.item.length
      case 'area-asc':
        return a.item.width * a.item.length - b.item.width * b.item.length
      case 'width-desc':
        return b.item.width - a.item.width
      case 'length-desc':
        return b.item.length - a.item.length
      case 'quantity-desc': {
        const ra = remainingByItem.get(a.item.id) ?? a.item.quantity
        const rb = remainingByItem.get(b.item.id) ?? b.item.quantity
        return rb - ra
      }
      default:
        return 0
    }
  }
  stacks.sort(stackCmp)

  let stackIdx = 0

  // Track per-item unplaced reasons so we can report multiple causes (e.g. some units
  // are oversized while others run out of space) instead of hiding them behind dedup.
  const unplacedStats = new Map<
    string,
    {
      id: string
      name: string
      width: number
      length: number
      oversized: number
      noSpace: number
      leftover: number
      separation: number
      overCapacity: number
    }
  >()

  // Load-zone weight tracking — SOFT preference (see PackOptions.loadZones's
  // doc comment): converted once to real metres up front (same pattern as
  // computeZoneLoads, since maxLoadPerArea is always a real t/m² figure
  // regardless of the deck's own display unit), then updated as stacks
  // actually get committed below so later items in the loop see the
  // zones' real current load, not just what was there at the start.
  const zonesM =
    unit === 'm'
      ? loadZones
      : loadZones.map((z) => ({ ...z, x: toMeters(z.x, unit), y: toMeters(z.y, unit), width: toMeters(z.width, unit), length: toMeters(z.length, unit) }))
  const outlineM = unit === 'm' || !outline ? outline : outline.map((pt) => ({ x: toMeters(pt.x, unit), y: toMeters(pt.y, unit) }))
  const zoneAreaM2 = new Map(zonesM.map((z) => [z.id, zoneAreaWithinOutline(z, outlineM)]))
  const zoneWeightKg = new Map(loadZones.map((z) => [z.id, 0]))
  const ZONE_EPS = 1e-9
  const MAX_ZONE_RETRY_ATTEMPTS = 5
  // Whether placing a footprint (deck-unit coords, same as everything else
  // in this function) with this much weight would push any zone it
  // overlaps over its real t/m² limit. Converts the footprint to metres
  // inline (zonesM/outlineM are already in metres) so the overlap test and
  // the density division both operate in the same real units.
  const wouldOverloadZone = (x: number, y: number, w: number, l: number, weightKg: number): boolean => {
    if (zonesM.length === 0 || weightKg <= 0) return false
    const fx = unit === 'm' ? x : toMeters(x, unit)
    const fy = unit === 'm' ? y : toMeters(y, unit)
    const fw = unit === 'm' ? w : toMeters(w, unit)
    const fl = unit === 'm' ? l : toMeters(l, unit)
    for (const z of zonesM) {
      if (!overlapsZone({ x: fx, y: fy, width: fw, length: fl }, z)) continue
      const areaM2 = zoneAreaM2.get(z.id) ?? 0
      if (areaM2 <= 0) continue
      const currentKg = zoneWeightKg.get(z.id) ?? 0
      const densityTPerM2 = (currentKg + weightKg) / 1000 / areaM2
      if (densityTPerM2 > z.maxLoadPerArea + ZONE_EPS) return true
    }
    return false
  }
  // Called only after a stack is actually committed (placeRect'd) — adds
  // its weight to every zone whose (metres) rect it overlaps, in the SAME
  // deck-unit->metres terms wouldOverloadZone already used to evaluate it.
  const addWeightToOverlappingZones = (x: number, y: number, w: number, l: number, weightKg: number): void => {
    if (zonesM.length === 0 || weightKg <= 0) return
    const fx = unit === 'm' ? x : toMeters(x, unit)
    const fy = unit === 'm' ? y : toMeters(y, unit)
    const fw = unit === 'm' ? w : toMeters(w, unit)
    const fl = unit === 'm' ? l : toMeters(l, unit)
    for (const z of zonesM) {
      if (!overlapsZone({ x: fx, y: fy, width: fw, length: fl }, z)) continue
      zoneWeightKg.set(z.id, (zoneWeightKg.get(z.id) ?? 0) + weightKg)
    }
  }
  let runningTotalWeightKg = result.totalWeight

  for (const { item, unitsInStack } of stacks) {
    if (perItemRemaining.get(item.id)! <= 0) continue

    // Symmetric gap model: each item is surrounded by gap/2 on every side, so the
    // distance between any two neighbouring items is exactly `gap` regardless of
    // which side they touch. The reserved cell is (w+gap) x (l+gap); the item is
    // drawn at cell origin + gap/2 — widened further by pyramidSpread when this
    // stack is more than one pipe piled into a single placement, so the free-rect
    // model reserves the pyramid's actual base-row width, not just one pipe's
    // cross-section (see pipePyramidSpreadMargin's doc comment).
    const pyramidSpread = pipePyramidSpreadMargin(item, unitsInStack)
    const cellW = item.width + gap + pyramidSpread.onWidth * 2
    const cellL = item.length + gap + pyramidSpread.onLength * 2
    const cellWRot = item.length + gap + pyramidSpread.onLength * 2
    const cellLRot = item.width + gap + pyramidSpread.onWidth * 2

    const fitsNormal = cellW <= uw && cellL <= ul
    const fitsRotated =
      item.allowRotation && cellWRot <= uw && cellLRot <= ul
    if (!fitsNormal && !fitsRotated) {
      const r = perItemRemaining.get(item.id)!
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
        overCapacity: 0,
      }
      stat.oversized += r
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, 0)
      continue
    }

    // The vessel's own total deck-cargo capacity — a HARD stop for THIS
    // stack (unlike loadZones below, which only reject a specific
    // candidate rect, not the whole stack). Checked before spending a
    // findPosition search on something that can't be placed anyway. Marks
    // only this stack unplaced and continues the loop — a later, lighter
    // stack further down the queue may still fit within what's left of
    // the budget, so this must not abort the whole placement run.
    const stackWeightKg = (item.weight ?? 0) * unitsInStack
    if (maxTotalWeightKg !== undefined && runningTotalWeightKg + stackWeightKg > maxTotalWeightKg) {
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
        overCapacity: 0,
      }
      stat.overCapacity += unitsInStack
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, perItemRemaining.get(item.id)! - unitsInStack)
      continue
    }

    // Best-fit position, with up to MAX_ZONE_RETRY_ATTEMPTS retries against
    // a shrinking copy of freeRects if the winning candidate would overload
    // a load zone (see PackOptions.loadZones's doc comment — soft
    // preference, not a hard rejection: if every retry still overloads
    // something, the ORIGINAL best-fit candidate is used anyway rather than
    // leaving the stack unplaced over a soft limit).
    const bestFitPos = findPosition(freeRects, cellW, cellL, item.allowRotation)
    let pos = bestFitPos
    if (bestFitPos && wouldOverloadZone(bestFitPos.node.x, bestFitPos.node.y, bestFitPos.node.width, bestFitPos.node.height, stackWeightKg)) {
      const excludedOrigins: { x: number; y: number }[] = [{ x: bestFitPos.node.x, y: bestFitPos.node.y }]
      let found: ScoredNode | null = null
      for (let attempt = 0; attempt < MAX_ZONE_RETRY_ATTEMPTS; attempt++) {
        const trimmedFreeRects = freeRects.filter(
          (fr) => !excludedOrigins.some((e) => e.x === fr.x && e.y === fr.y)
        )
        const retryPos = findPosition(trimmedFreeRects, cellW, cellL, item.allowRotation)
        if (!retryPos) break // no more alternate rects to try
        if (!wouldOverloadZone(retryPos.node.x, retryPos.node.y, retryPos.node.width, retryPos.node.height, stackWeightKg)) {
          found = retryPos
          break
        }
        excludedOrigins.push({ x: retryPos.node.x, y: retryPos.node.y })
      }
      // Found a non-overloading alternative -> use it. Otherwise every
      // candidate tried would overload something anyway, so fall back to
      // the original best-fit position and place it there regardless (the
      // existing zone-load warning UI surfaces the overload as normal).
      pos = found ?? bestFitPos
    }
    if (!pos) {
      const r = perItemRemaining.get(item.id)!
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
        overCapacity: 0,
      }
      stat.noSpace += r
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, 0)
      continue
    }

    const visW = pos.rotated ? item.length : item.width
    const visL = pos.rotated ? item.width : item.length
    // Item position = cell origin, centered within whatever the cell's own
    // world-space size ended up being (gap/2 on each side normally; wider
    // still on the pyramid-spread axis, split evenly on both sides so the
    // true (narrow) pipe is centered under its own pyramid rather than
    // flush to one edge of the extra reserved room).
    const nodeWorldW = pos.rotated ? cellWRot : cellW
    const nodeWorldL = pos.rotated ? cellLRot : cellL
    const itemX = pos.node.x + (nodeWorldW - visW) / 2
    const itemY = pos.node.y + (nodeWorldL - visL) / 2

    // Separation is a hard constraint (unlike load density, which is only a
    // soft warning computed at render time): reject this stack's placement
    // rather than let it violate a configured category separation rule. This
    // does not retry an alternate free rectangle for this stack — a v1
    // simplification matching how "no space" also doesn't retry.
    // Composition-aware (R29 corrective pass 3): `item` here always comes
    // straight from the catalog (AUTO never creates a composition itself),
    // but `result.placed` can already contain an accepted Tier-1 pin whose
    // composition holds real hazard categories its own (possibly broken)
    // nominal itemId can't resolve — see violatesSeparationForCategories'
    // own doc comment.
    if (
      violatesSeparationForCategories(
        { x: itemX, y: itemY, width: visW, length: visL },
        item.category ? [item.category] : [],
        result.placed.map((p) => ({
          x: p.x,
          y: p.y,
          width: p.width,
          length: p.length,
          categories: placementCategorySet(p, items),
        })),
        separationRules
      )
    ) {
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
        overCapacity: 0,
      }
      stat.separation += unitsInStack
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, perItemRemaining.get(item.id)! - unitsInStack)
      continue
    }

    placeRect(pos.node, freeRects)
    const stackHeight = item.height > 0 ? item.height * unitsInStack : 0
    result.placed.push({
      itemId: item.id,
      name: item.name,
      x: itemX,
      y: itemY,
      width: visW,
      length: visL,
      height: item.height,
      layers: unitsInStack,
      stackedCount: unitsInStack,
      rotated: pos.rotated,
      color: item.color,
      weight: item.weight,
      index: stackIdx++,
      shape: item.shape,
      outline: item.outline,
      contents: item.contents,
      stabilityOverride: item.stabilityOverride,
      nest: item.nest,
    })
    result.usedArea += visW * visL
    result.placedCount += unitsInStack
    if (item.weight) result.totalWeight += item.weight * unitsInStack
    if (stackHeight > result.maxStackHeight) result.maxStackHeight = stackHeight
    perItemRemaining.set(item.id, perItemRemaining.get(item.id)! - unitsInStack)
    runningTotalWeightKg += stackWeightKg
    addWeightToOverlappingZones(itemX, itemY, visW, visL, stackWeightKg)
  }

  // Any remaining unplaced units (e.g. loop ended before stacks were exhausted)
  for (const item of items) {
    const remaining = perItemRemaining.get(item.id) ?? 0
    if (remaining > 0) {
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
        overCapacity: 0,
      }
      stat.leftover += remaining
      unplacedStats.set(item.id, stat)
    }
  }

  // Build unified unplaced list with all reasons per item
  for (const stat of unplacedStats.values()) {
    const reasons: string[] = []
    if (stat.oversized > 0) reasons.push(`Превышает размеры палубы (${stat.oversized} ед.)`)
    if (stat.noSpace > 0) reasons.push(`Недостаточно свободного места (${stat.noSpace} ед.)`)
    if (stat.separation > 0) reasons.push(`Нарушает сепарацию груза (${stat.separation} ед.)`)
    if (stat.overCapacity > 0) reasons.push(`Превышен лимит веса судна (${stat.overCapacity} ед.)`)
    if (stat.leftover > 0) reasons.push(`Не вместилось (${stat.leftover} ед.)`)
    result.unplaced.push({
      itemId: stat.id,
      name: stat.name,
      width: stat.width,
      length: stat.length,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Не вместилось',
    })
  }

  // Build per-item breakdown — Round 23: composition-aware attribution.
  // Before this fix, a composed placement's ENTIRE stackedCount/weight was
  // filtered-and-summed under its own nominal `p.itemId` alone
  // (`result.placed.filter(p => p.itemId === item.id)`), which for
  // `[A2,B3]` (nominal itemId = A) attributed all 5 units / 800kg to A's
  // row and left B's row at 0 — even though 3 real physical units of B are
  // inside that same placement. Each constituent segment is now attributed
  // to its OWN itemId's accumulator instead, via `placementConstituents`
  // (placementComposition.ts) — degenerates to the exact prior per-
  // placement attribution for an uncomposed placement (segmentsOf's
  // implicit one-segment fallback), so every existing (uncomposed) item's
  // breakdown row is unchanged. `footprints`/`area` are attributed in FULL
  // to every distinct constituent itemId a placement contains — a shared
  // physical footprint, not something to divide between constituents (this
  // matches how an ordinary single-item placement already counts its own
  // whole footprint once) — not a new geometry model, just extending the
  // existing whole-footprint-per-item convention to every constituent
  // present, not just the nominal one.
  const constituentAcc = new Map<string, { units: number; footprints: number; area: number; weight: number; maxSegLayers: number }>()
  const emptyAcc = () => ({ units: 0, footprints: 0, area: 0, weight: 0, maxSegLayers: 0 })
  for (const p of result.placed) {
    if (p.composition) {
      for (const c of placementConstituents(p, items)) {
        const acc = constituentAcc.get(c.itemId) ?? emptyAcc()
        acc.units += c.layers
        acc.weight += c.weightKg
        acc.maxSegLayers = Math.max(acc.maxSegLayers, c.layers)
        constituentAcc.set(c.itemId, acc)
      }
      // Footprint/area counted once per DISTINCT constituent itemId, even
      // if that itemId appears in more than one non-adjacent segment of
      // this same placement (e.g. [A2,B3,A1] — A's footprint count from
      // this one placement is still 1, not 2).
      const uniqueIds = new Set(p.composition.map((seg) => seg.itemId))
      for (const itemId of uniqueIds) {
        const acc = constituentAcc.get(itemId) ?? emptyAcc()
        acc.footprints += 1
        acc.area += p.width * p.length
        constituentAcc.set(itemId, acc)
      }
    } else {
      const acc = constituentAcc.get(p.itemId) ?? emptyAcc()
      // Sum the placement's actual weight (not always item.weight): a
      // pinned stack's weight can be overridden independently of its
      // source item — unchanged from the pre-Round-23 formula, only moved
      // from a per-item filter-reduce into this per-placement accumulation.
      const unitWeight = items.find((it) => it.id === p.itemId)?.weight ?? 0
      acc.units += p.stackedCount
      acc.footprints += 1
      acc.area += p.width * p.length
      acc.weight += (p.weight ?? unitWeight) * p.stackedCount
      acc.maxSegLayers = Math.max(acc.maxSegLayers, p.stackedCount)
      constituentAcc.set(p.itemId, acc)
    }
  }
  for (const item of items) {
    const acc = constituentAcc.get(item.id)
    // Prefer the user's own "Ярусов" cap from the item card — that's the
    // number they explicitly set and expect to see reflected here. Only
    // fall back to the real tallest stack actually placed when no cap is
    // set (item.maxLayers is 0/undefined): showing an unrelated
    // clearance-derived theoretical number there was the original bug this
    // fallback fixed (see git history), but an explicit user-entered cap is
    // not that — it's the number they typed, not a derived guess.
    const layers = item.maxLayers && item.maxLayers > 0 ? item.maxLayers : (acc?.maxSegLayers ?? 0)
    result.breakdown.push({
      itemId: item.id,
      name: item.name,
      color: item.color,
      requested: item.quantity,
      placed: acc?.units ?? 0,
      footprints: acc?.footprints ?? 0,
      layers,
      area: acc?.area ?? 0,
      weight: acc?.weight ?? 0,
      unitWeight: item.weight ?? 0,
    })
  }

  result.freeArea = Math.max(0, totalArea - result.usedArea)
  result.utilization = totalArea > 0 ? Math.min(1, result.usedArea / totalArea) : 0
  return result
}

// ---- Variant generation for "Автораспределение" ----

// Mulberry32 — small deterministic PRNG so variants are reproducible from a seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Seeded shuffle (Fisher–Yates) — used to break ties within equal-priority groups.
function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Signature for deduplication of variants.
function variantSignature(result: PackingResult): string {
  return result.placed
    .map((p) => `${p.itemId}:${p.x.toFixed(4)}:${p.y.toFixed(4)}:${p.width.toFixed(4)}:${p.length.toFixed(4)}:${p.rotated ? 1 : 0}`)
    .sort()
    .join('|')
}

export interface PackVariant {
  result: PackingResult
  label: string
  utilizationPct: number
  placedCount: number
  unplacedCount: number
  /** Internal fine-grained sort key. Do not rely on this in UI. */
  _utilization?: number
}

// Generate up to `count` distinct packing variants. Uses several strategies:
//  1. Different sort strategies (area-desc, width-desc, length-desc)
//  2. Seeded shuffle of equal-priority items to break ties differently
export function packDeckVariants(
  deckWidth: number,
  deckLength: number,
  items: CargoItem[],
  options: PackOptions,
  count = 3,
  seed?: number
): PackVariant[] {
  const baseSeed = seed ?? Date.now()
  const strategies: SortStrategy[] = ['area-desc', 'width-desc', 'length-desc', 'area-asc']
  const variants: PackVariant[] = []
  const seen = new Set<string>()

  // For each strategy, run a few seeded tie-breaks.
  let variantIdx = 0
  for (let s = 0; s < strategies.length && variants.length < count; s++) {
    const strategy = strategies[s]
    for (let t = 0; t < 2 && variants.length < count; t++) {
      const rng = mulberry32(baseSeed + variantIdx * 1013)
      // Shuffle items with a tiny perturbation so equal-priority ones change order
      const shuffled = seededShuffle(items, rng)
      const res = packDeck(deckWidth, deckLength, shuffled, {
        ...options,
        sortStrategy: strategy,
      })
      const sig = variantSignature(res)
      if (seen.has(sig)) {
        variantIdx++
        continue
      }
      seen.add(sig)
      const label =
        s === 0
          ? `Вариант ${variants.length + 1} — по площади`
          : s === 1
            ? `Вариант ${variants.length + 1} — по ширине`
            : s === 2
              ? `Вариант ${variants.length + 1} — по длине`
              : `Вариант ${variants.length + 1} — мелкие сначала`
      variants.push({
        result: res,
        label,
        utilizationPct: Math.round(res.utilization * 100),
        placedCount: res.placedCount,
        unplacedCount: res.unplaced.length,
        _utilization: res.utilization, // fine-grained sort key (not exposed)
      })
      variantIdx++
    }
  }

  // Sort by raw utilization desc (best first). `utilizationPct` is rounded for display
  // only; using the raw value avoids arbitrary ordering within the same integer bucket.
  variants.sort((a, b) => (b._utilization ?? b.utilizationPct) - (a._utilization ?? a.utilizationPct))
  return variants.slice(0, count)
}

// Repeatedly packs a deck, feeding each trip's leftover (`result.unplaced`)
// back in as the next trip's cargo, so an order that doesn't fit in one
// voyage automatically splits across several voyages of the same deck.
// Stops when nothing is left unplaced, `maxTrips` is reached, or a trip
// makes no progress at all (e.g. an item is oversized for this deck and
// would otherwise loop forever re-appearing as "unplaced" every trip).
export function packMultiTrip(
  deckWidth: number,
  deckLength: number,
  items: CargoItem[],
  options: PackOptions | SortStrategy = 'area-desc',
  maxTrips = 10,
  // Per-trip pinned placements (trip index -> pins for that trip). Each trip
  // is a separate deck instance, so a pin only makes sense on the trip it was
  // created on. `options.pinned` (applied to every trip) is only used when
  // `pinnedByTrip` itself is omitted entirely, matching the previous
  // behaviour for callers that don't need per-trip pins — once `pinnedByTrip`
  // IS provided, a trip missing from it means "no pins for this trip" ([]),
  // never a silent fallback to `options.pinned` (which would leak pins meant
  // for one trip onto every other trip).
  pinnedByTrip?: Record<number, PinnedPlacement[]>
): PackingResult[] {
  const trips: PackingResult[] = []
  let remaining = items
  const baseOptions = typeof options === 'string' ? { sortStrategy: options } : options
  for (let trip = 0; trip < maxTrips; trip++) {
    if (remaining.length === 0) break
    const pinned = pinnedByTrip ? (pinnedByTrip[trip] ?? []) : (baseOptions.pinned ?? [])
    const result = packDeck(deckWidth, deckLength, remaining, { ...baseOptions, pinned })
    trips.push(result)
    if (result.unplaced.length === 0) break
    if (result.placedCount === 0) break // no progress — avoid an infinite loop
    // Carry the unplaced remainder into the next trip as fresh CargoItems,
    // preserving each source item's dimensions/category/etc via a lookup,
    // and using the unplaced count as the next trip's quantity.
    const byId = new Map(remaining.map((it) => [it.id, it]))
    remaining = result.unplaced
      .map((u) => {
        const src = byId.get(u.itemId)
        if (!src) return null
        const placedForItem = result.placed
          .filter((p) => p.itemId === u.itemId)
          .reduce((s, p) => s + p.stackedCount, 0)
        const stillNeeded = src.quantity - placedForItem
        if (stillNeeded <= 0) return null
        return { ...src, quantity: stillNeeded }
      })
      .filter((it): it is CargoItem => it !== null)
  }
  // No cargo at all (e.g. every item removed/zeroed) — still return one
  // empty trip so callers can always safely index trips[0].
  if (trips.length === 0) {
    trips.push(packDeck(deckWidth, deckLength, [], baseOptions))
  }
  return trips
}

// Compute remaining free rectangles for visualization. Uses cells that include
// the inter-item gap so the hatched region matches what the packer sees.
export function computeFreeRects(
  deckWidth: number,
  deckLength: number,
  placed: PlacedItem[],
  gap = 0,
  boardOffset = 0,
  outline?: { x: number; y: number }[]
): Rect[] {
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const off = toFinite(boardOffset, 0)
  const g = toFinite(gap, 0)
  const hasOutline = !!outline && outline.length >= 3
  // Same gap/2 compensation as packDeck, so the free-space overlay matches the
  // actual edge clearance (exactly `boardOffset`) rather than `boardOffset + gap/2`.
  const halfGap = g / 2
  const ux = Math.max(0, off - halfGap)
  const uy = Math.max(0, off - halfGap)
  const uw = Math.max(0, dw - off * 2 + g)
  const ul = Math.max(0, dl - off * 2 + g)
  // Non-rectangular deck: same contour-following board-offset inset as
  // packDeck (erodePolygon), not a bounding-box inset — and, like packDeck,
  // the FULL strict boardOffset erosion (not the gap/2-permissive one used
  // for the rectangular seed rect above) — see packDeck for why: a flat
  // "+gap/2" compensation only correctly cancels a permissive erosion along
  // an axis-aligned edge, not a slanted outline edge, so this overlay
  // stayed strict to match what's actually placeable.
  const free: FreeRect[] = hasOutline
    ? [{ x: 0, y: 0, width: dw, height: dl }]
    : [{ x: ux, y: uy, width: uw, height: ul }]
  if (hasOutline) {
    const usableOutline = erodePolygon(outline!, off)
    for (const rect of deckOutlineExclusionRects(usableOutline, dw, dl)) {
      placeRect(rect, free)
    }
  }
  for (const p of placed) {
    // Symmetric gap model: cell = (x - gap/2, y - gap/2, w+gap, l+gap) —
    // further inflated by clearanceMargin if set, matching packDeck's own
    // pin-reservation formula, so this overlay agrees with what the packer
    // actually treats as occupied instead of showing a zoned-off area as free.
    const pw = toFinite(p.width, 0)
    const pl = toFinite(p.length, 0)
    if (pw <= 0 || pl <= 0) continue
    const cm = p.clearanceMargin
    // Same pyramid-spread widening as packDeck's own reservation, so this
    // overlay never shows a stacked pipe pyramid's true footprint as free.
    // Prefers the pre-computed `p.pyramidMargin` when present — see
    // PlacedItem.pyramidMargin's own doc comment (R29 pass 4A, G1): `p.shape`
    // alone can be undefined for a composed placement that still needs
    // margin reserved (a pipe constituent among non-uniform siblings).
    const spread = p.pyramidMargin ?? pipePyramidSpreadMargin({ shape: p.shape, width: pw, length: pl, height: p.height }, p.stackedCount)
    placeRect(
      {
        x: p.x - g / 2 - (cm?.left ?? 0) - spread.onWidth,
        y: p.y - g / 2 - (cm?.top ?? 0) - spread.onLength,
        width: pw + g + (cm?.left ?? 0) + (cm?.right ?? 0) + spread.onWidth * 2,
        height: pl + g + (cm?.top ?? 0) + (cm?.bottom ?? 0) + spread.onLength * 2,
      },
      free
    )
  }
  return free.filter((f) => f.width > 1e-6 && f.height > 1e-6)
}

// ---- Manual placement helpers ----

export interface ManualPlacement {
  id: string
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  layers: number // how many tiers stacked on this footprint
  rotated: boolean
  color: string
  weight?: number // per-unit — see PlacedItem.weight's doc comment above; multiply by `layers` for the stack's real weight
  // See PinnedPlacement.clearanceMargin above — same meaning here.
  clearanceMargin?: ClearanceMargin
  // See PinnedPlacement.stabilityOverride above — same meaning here.
  stabilityOverride?: StabilityOverride
  // See PinnedPlacement.lashingWireType/lashingJustification above — same meaning here.
  lashingWireType?: WireRopeType
  lashingJustification?: string
  // See PinnedPlacement.rotationLocked above — same meaning here.
  rotationLocked?: boolean
  // See PinnedPlacement.composition above — same meaning here.
  composition?: CompositionSegment[]
  // See PinnedPlacement.legacyUnknownComposition above — same meaning here.
  legacyUnknownComposition?: true
  // See PinnedPlacement.malformed above — same meaning and two-tier contract here.
  malformed?: {
    unresolvedItem?: true
    invalidComposition?: true
    rawComposition?: unknown
  }
}

// Snap-to-grid step for dragging/nudging placements, scaled to the deck's
// own size so a tiny deck doesn't get a coarse 10m step and a huge deck
// doesn't get an imperceptible 0.5m one. Shared by 2D drag-snapping and the
// 3D keyboard nudge, so both move cargo by the same increment.
export function computeGridStep(deckWidth: number, deckLength: number): number {
  const dim = Math.max(deckWidth, deckLength)
  if (dim <= 6) return 0.5
  if (dim <= 20) return 1
  if (dim <= 60) return 5
  return 10
}

// One row of a pyramid pile of round stock (pipes/rebar). `rowIndex` is
// height order (0 = base row, sitting on the deck). `offsets` are this
// row's units' horizontal positions, in units of ONE RADIUS — the caller
// multiplies by the item's actual radius (and applies it to whichever
// world axis the pile spreads across) to get real offsets. Deliberately
// centered on the row's own natural (full-pyramid) width even when it
// holds fewer units than that — see decomposePipePyramid's doc comment for
// why that's what keeps a leftover top row resting in real valleys instead
// of floating over solid pipe.
export interface PipeRow {
  rowIndex: number
  offsets: number[]
}

// Decomposes `layers` round units into pyramid rows — base row widest,
// each row above exactly one unit narrower, the way round stock actually
// piles up. Every unit's horizontal offset is centered on its row's
// naturalCount (how many units a FULL row at that height would hold in a
// perfect decreasing-by-1 pyramid: base, base-1, base-2, ...) — NOT on
// however many units the row actually ends up holding, which can be
// smaller once the remaining total runs out before the pyramid completes
// (e.g. 8 units only fill a 4-3-1 pile, not a full 4-3-2-1 one).
//
// This distinction is the whole fix: two rows whose naturalCount differs by
// exactly 1 (which this decomposition always produces, by construction)
// share the same center and are offset by exactly one radius — the
// geometric condition for round stock resting in the gaps of the row
// beneath it. Centering a truncated row on its own (smaller) unit count
// instead — the bug this replaces — breaks that alignment the moment a row
// runs short: e.g. a lone leftover unit would render dead-center over the
// row below, which is only a valid resting spot when that row below has an
// ODD naturalCount (a real center gap); otherwise the unit floats over
// solid pipe instead of resting in a valley — physically impossible. This
// was reported live: an 8-pipe stack rendered its top pipe dead-center,
// balanced impossibly on the row below instead of nested in a valley.
export function decomposePipePyramid(layers: number): PipeRow[] {
  const base = Math.max(1, Math.round(Math.sqrt(2 * layers)))
  const rows: PipeRow[] = []
  let remaining = layers
  let rowIndex = 0
  while (remaining > 0) {
    const naturalCount = Math.max(1, base - rowIndex)
    const count = Math.min(remaining, naturalCount)
    const offsets = Array.from({ length: count }, (_, i) => (i - (naturalCount - 1) / 2) * 2)
    rows.push({ rowIndex, offsets })
    remaining -= count
    rowIndex++
  }
  return rows
}

// Same heuristic Deck3DView.tsx uses to decide whether a cylinder cargo
// lies on its side like a pipe (stacks into a pyramid) versus stands
// upright like a barrel (stacks straight up, rim-on-rim) — kept here too
// so the packing engine's own space reservation (see
// pipePyramidSpreadMargin below) can agree with what the 3D view will
// actually render, instead of drifting out of sync as two separate copies
// of the same formula.
export function isPipeShape(item: { shape?: CargoShape; width: number; length: number; height: number }): boolean {
  if (item.shape !== 'cylinder') return false
  const longSpan = Math.max(item.width, item.length)
  const shortSpan = Math.min(item.width, item.length)
  return longSpan > shortSpan * 1.5 && longSpan > item.height * 1.5
}

// A pyramid pile of pipes is physically WIDER than a single pipe's own
// cross-section the moment more than one unit is stacked into one
// placement — a base row of `decomposePipePyramid`'s widest row spans that
// many pipe-diameters, not one. Nothing in the packing engine used to
// account for this: a placement's reserved 2D footprint was always just
// the single pipe's own width/length regardless of `layers`, so two
// separate pipe stacks (e.g. an original and a duplicate) could be packed
// edge-to-edge on paper while their 3D pyramids — which need real room —
// physically overlapped. This was reported live as "duplicating a stack
// of pipes distributes them as a jumbled mess instead of separate piles."
//
// Returns the extra HALF-margin (already halved, ready to add to both
// sides symmetrically) needed on whichever of width/length is the pipe's
// own short span (its diameter direction — the axis the pyramid actually
// spreads across; the long axis is the pipe's own length and needs no
// extra room). Zero for non-pipe shapes or a single-layer stack, so every
// caller can apply this unconditionally with no special-casing.
export function pipePyramidSpreadMargin(
  item: { shape?: CargoShape; width: number; length: number; height: number },
  layers: number
): { onWidth: number; onLength: number } {
  if (layers <= 1 || !isPipeShape(item)) return { onWidth: 0, onLength: 0 }
  const shortSpan = Math.min(item.width, item.length)
  const baseCount = decomposePipePyramid(layers)[0]?.offsets.length ?? 1
  const half = (shortSpan * (baseCount - 1)) / 2
  return item.width <= item.length ? { onWidth: half, onLength: 0 } : { onWidth: 0, onLength: half }
}

// R29 corrective pass 4 (geometry hardening). The R29 corrective pass 3 fix
// resolved a Tier-1 placement's pyramid shape/height via its FIRST
// composition segment, justified by a proof that only actually holds for a
// composition created through planComposedMerge (page.tsx): that gate
// requires isPipeShape(it) to be true for EVERY constituent INDIVIDUALLY —
// using that constituent's own catalog width/length/height — before a merge
// is even allowed, so any constituent's height was guaranteed to keep the
// isPipeShape gate open. `normalizeComposition` (hydration/import) enforces
// NO such invariant: a structurally valid composition (every itemId
// resolves, every `layers` a positive integer) can mix a genuine pipe
// constituent with one that would fail its own isPipeShape check, or even a
// non-cylinder shape entirely. Trusting segments[0] alone could therefore
// silently MISS a real pipe constituent sitting at a later segment index,
// under-reserving the pyramid margin — a physical collision-safety gap, not
// a cosmetic one.
//
// The general (not merge-specific) rule: reserve pyramid margin whenever
// ANY constituent, using the PLACEMENT's own real width/length (always
// trustworthy — a placement-level field, never itemId-derived) together
// with THAT constituent's own catalog height, independently qualifies as
// pipe-shaped. This can only ever resolve to AS MUCH OR MORE margin than a
// segments[0]-only resolution — never less — so it's strictly safer, not
// merely differently-shaped risk. It degenerates to exactly today's
// behavior for an uncomposed placement (segmentsOf's one-element fallback)
// and for a real merge-created composition (every constituent already
// qualifies by the merge gate above, so "any" is trivially satisfied by
// segments[0] itself — no behavior change for the case Pass 3 was actually
// tested against). An empty segment list (composition: [] — currently
// unreachable through any real write path, see placementComposition.ts's
// own writers, but not something the type system forbids) falls through
// the loop to the safe `{ shape: undefined, height: 0 }` default rather
// than throwing or silently indexing `[0]` on an empty array.
export function resolvePyramidShape(
  p: ComposablePlacement,
  width: number,
  length: number,
  items: { id: string; shape?: CargoShape; height: number }[]
): { shape: CargoShape | undefined; height: number } {
  for (const seg of segmentsOf(p)) {
    const it = items.find((i) => i.id === seg.itemId)
    if (it && isPipeShape({ shape: it.shape, width, length, height: it.height ?? 0 })) {
      return { shape: it.shape, height: it.height ?? 0 }
    }
  }
  return { shape: undefined, height: 0 }
}

// Independent hard-block margin per side of a placement's footprint —
// lets the exclusion zone be wider on, say, the side a rigger needs to work
// from, rather than a single symmetric radius.
export interface ClearanceMargin {
  top: number
  right: number
  bottom: number
  left: number
}

// Inflates a placement's own footprint by its clearanceMargin (if any) —
// used when OTHER items test collision against this one, so its hard-block
// exclusion zone actually excludes them. Never applied to the placement's
// own clamp-to-deck-edge or self-collision checks — only when it appears in
// someone else's `others` array.
export function withClearanceFootprint<
  T extends { x: number; y: number; width: number; length: number; clearanceMargin?: ClearanceMargin }
>(p: T): { x: number; y: number; width: number; length: number } {
  const m = p.clearanceMargin
  if (!m) return p
  return {
    x: p.x - m.left,
    y: p.y - m.top,
    width: p.width + m.left + m.right,
    length: p.length + m.top + m.bottom,
  }
}

// Sums two optional ClearanceMargins side-by-side — used to combine a
// placement's own explicit clearanceMargin with an implicit margin (e.g. a
// pipe pyramid's own spread) into one value that every existing
// margin-aware call site (resolveSnappedDragPosition's selfMargin, etc.)
// already knows how to consume, instead of teaching each of them a second
// margin concept.
export function addClearanceMargins(a?: ClearanceMargin, b?: ClearanceMargin): ClearanceMargin | undefined {
  if (!a && !b) return undefined
  return {
    top: (a?.top ?? 0) + (b?.top ?? 0),
    right: (a?.right ?? 0) + (b?.right ?? 0),
    bottom: (a?.bottom ?? 0) + (b?.bottom ?? 0),
    left: (a?.left ?? 0) + (b?.left ?? 0),
  }
}

// Expresses a pipe pyramid's own spread (see pipePyramidSpreadMargin) as a
// ClearanceMargin, so it can be merged (addClearanceMargins) with a real
// clearanceMargin and fed through the same selfMargin plumbing that already
// makes a dragged zoned item's OWN footprint search-and-collide correctly.
export function pyramidSpreadAsClearance(
  p: { shape?: CargoShape; width: number; length: number; height: number },
  layers: number
): ClearanceMargin | undefined {
  const m = pipePyramidSpreadMargin(p, layers)
  if (m.onWidth === 0 && m.onLength === 0) return undefined
  return { top: m.onLength, bottom: m.onLength, left: m.onWidth, right: m.onWidth }
}

// Same idea as withClearanceFootprint, but also folds in a stacked pipe
// pyramid's own spread (pipePyramidSpreadMargin) — the packing engine's
// algorithmic placement already reserves this wider cell so pyramids don't
// overlap their neighbours, but the interactive click/drag/rotate/nudge
// collision paths only ever knew about clearanceMargin. Without this, a
// user could drag a pipe stack right up against a neighbour at just the
// flat gap, closer than the pyramid can actually occupy without its base
// row overlapping — which the 2D view now draws as a real, visible
// overlap (see the pyramid-footprint render fix in DeckVisualization.tsx).
export function withHardBlockFootprint<
  T extends {
    x: number
    y: number
    width: number
    length: number
    clearanceMargin?: ClearanceMargin
    shape?: CargoShape
    height?: number
    stackedCount?: number
    // R29 corrective pass 4A (G1) — see PlacedItem.pyramidMargin's own doc
    // comment. Preferred over re-deriving from shape/height below, since a
    // composed placement's `shape` can be undefined (no single uniform
    // shape) even when it genuinely needs pyramid margin reserved (a pipe
    // constituent hiding among non-uniform siblings) — re-deriving from
    // `shape` alone would silently lose that margin here.
    pyramidMargin?: { onWidth: number; onLength: number }
  }
>(p: T): { x: number; y: number; width: number; length: number } {
  const cm = p.clearanceMargin
  const pyr = p.pyramidMargin ?? pipePyramidSpreadMargin({ shape: p.shape, width: p.width, length: p.length, height: p.height ?? 0 }, p.stackedCount ?? 1)
  const left = (cm?.left ?? 0) + pyr.onWidth
  const right = (cm?.right ?? 0) + pyr.onWidth
  const top = (cm?.top ?? 0) + pyr.onLength
  const bottom = (cm?.bottom ?? 0) + pyr.onLength
  if (left === 0 && right === 0 && top === 0 && bottom === 0) return p
  return {
    x: p.x - left,
    y: p.y - top,
    width: p.width + left + right,
    length: p.length + top + bottom,
  }
}

// A lashing point's anchor needs clear room for rigging access (tensioning,
// inspecting, releasing the device) — cargo shouldn't be placeable directly
// on top of it. The exclusion square is sized to track the deck's own gap
// setting (never smaller than a sensible minimum), so widening the general
// cargo-to-cargo spacing also pushes cargo further from lashing points, not
// just from other cargo — the same "gap" the user configures everywhere
// else, applied here too instead of a second, disconnected setting.
const LASHING_POINT_MIN_EXCLUSION = 0.15
export function lashingPointExclusionRects(
  points: { x: number; y: number }[],
  gap: number
): { x: number; y: number; width: number; length: number }[] {
  const r = Math.max(LASHING_POINT_MIN_EXCLUSION, gap)
  return points.map((p) => ({ x: p.x - r, y: p.y - r, width: r * 2, length: r * 2 }))
}

// Restriction zones as collidesPrecisely-ready "others" — bbox + a LOCAL
// (0,0)-origin outline (same convention as CargoItem.outline), so a
// non-rectangular zone (triangle/oval/diamond) blocks by its true silhouette,
// not just its bounding box.
export function restrictionZoneExclusions(
  zones: RestrictionZone[]
): { id: string; name: string; x: number; y: number; width: number; length: number; outline: { x: number; y: number }[] }[] {
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    x: z.x,
    y: z.y,
    width: z.width,
    length: z.length,
    outline: restrictionZonePolygon(z).map((p) => ({ x: p.x - z.x, y: p.y - z.y })),
  }))
}

// Check whether a manual placement collides with any existing one.
export function collidesWith(
  placement: { x: number; y: number; width: number; length: number },
  others: { x: number; y: number; width: number; length: number }[],
  gap = 0
): boolean {
  const a = {
    x: placement.x - gap / 2,
    y: placement.y - gap / 2,
    w: placement.width + gap,
    h: placement.length + gap,
  }
  // A tiny epsilon on the boundary comparisons prevents an exact flush-contact
  // position (distance == gap precisely) from being spuriously flagged as a
  // collision due to floating-point noise in the `gap / 2` arithmetic (e.g.
  // gap=0.1 is not exactly representable in binary).
  const eps = 1e-9
  return others.some((o) => {
    const b = {
      x: o.x - gap / 2,
      y: o.y - gap / 2,
      w: o.width + gap,
      h: o.length + gap,
    }
    return !(
      a.x + a.w <= b.x + eps ||
      b.x + b.w <= a.x + eps ||
      a.y + a.h <= b.y + eps ||
      b.y + b.h <= a.y + eps
    )
  })
}

// Rotates a local outline 90° CW to match rotatePlacement's width/length
// swap: the unrotated box is [0,width]×[0,length]; the rotated box is
// [0,length]×[0,width]. `width`/`length` here are the box the INPUT points
// are defined against (i.e. the un-rotated source box), not the rotated
// result.
export function rotateOutline90(
  points: { x: number; y: number }[],
  width: number,
  length: number
): { x: number; y: number }[] {
  return points.map((p) => ({ x: length - p.y, y: p.x }))
}

// Converts a placement's local outline into a world-space polygon — rotated
// (if needed) then translated by the placement's own x/y. Placements without
// a custom outline fall back to their plain bounding-box rectangle, so this
// is safe to call unconditionally. Shared by 2D/3D render and
// collidesPrecisely so there's exactly one rotation implementation (the
// duplication that caused an earlier bug — shape being hand-copied and
// silently dropped in one of several places — is exactly what this avoids).
export function worldPolygon(p: {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: { x: number; y: number }[]
}): { x: number; y: number }[] {
  if (!p.outline || p.outline.length < 3) {
    return [
      { x: p.x, y: p.y },
      { x: p.x + p.width, y: p.y },
      { x: p.x + p.width, y: p.y + p.length },
      { x: p.x, y: p.y + p.length },
    ]
  }
  // p.width/p.length already reflect the ROTATED bbox (rotatePlacement
  // swaps them) — the stored outline is always in the UNROTATED frame, so
  // recover the pre-rotation box size to rotate the points correctly.
  const unrotatedWidth = p.rotated ? p.length : p.width
  const unrotatedLength = p.rotated ? p.width : p.length
  const local = p.rotated ? rotateOutline90(p.outline, unrotatedWidth, unrotatedLength) : p.outline
  return local.map((pt) => ({ x: p.x + pt.x, y: p.y + pt.y }))
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): boolean {
  const d = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  // eps guard, same reasoning as collidesWith's own: without it, two edges
  // that are meant to exactly touch (d == 0) can land on either side of 0
  // from floating-point noise alone and get spuriously flagged as crossing.
  // Touching itself is already excluded either way (strict > / < on either
  // side of eps never fires exactly at 0) — this only makes that exclusion
  // robust against noise, consistent with the touching-is-allowed policy
  // used everywhere else in this file.
  const eps = 1e-9
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
}

function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// True if two simple polygons (convex or concave) overlap — edge-crossing
// test plus a containment check (needed for the case where one polygon is
// entirely inside the other with no edge crossings at all). No library
// needed; three.js's own earcut handles concave triangulation separately
// for 3D extrusion.
export function polygonsOverlap(
  polyA: { x: number; y: number }[],
  polyB: { x: number; y: number }[]
): boolean {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i]
    const a2 = polyA[(i + 1) % polyA.length]
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j]
      const b2 = polyB[(j + 1) % polyB.length]
      if (segmentsIntersect(a1, a2, b1, b2)) return true
    }
  }
  return pointInPolygon(polyA[0], polyB) || pointInPolygon(polyB[0], polyA)
}

// Nearest point on a closed polygon's own edges (not its interior) to a
// given point, plus the unit normal of that edge pointing AWAY from the
// polygon's interior. Used to snap a power-socket marker onto the deck's
// true perimeter (rectangle or custom outline, both are just polygons here)
// and to know which way is "outside" for placing its label clear of the
// deck. Works for any simple polygon, convex or concave.
export function nearestPointOnPolygon(
  pt: { x: number; y: number },
  poly: { x: number; y: number }[]
): { x: number; y: number; normalX: number; normalY: number } {
  let bestDist = Infinity
  let best = { x: poly[0].x, y: poly[0].y, normalX: 0, normalY: -1 }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    let t = lenSq > 0 ? ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq : 0
    t = Math.max(0, Math.min(1, t))
    const px = a.x + t * dx
    const py = a.y + t * dy
    const dist = Math.hypot(pt.x - px, pt.y - py)
    if (dist < bestDist) {
      const len = Math.hypot(dx, dy) || 1
      let nx = -dy / len
      let ny = dx / len
      // Two perpendiculars exist; nudge a hair along each candidate and
      // keep whichever lands outside the polygon (points away from it).
      if (pointInPolygon({ x: px + nx * 0.01, y: py + ny * 0.01 }, poly)) {
        nx = -nx
        ny = -ny
      }
      bestDist = dist
      best = { x: px, y: py, normalX: nx, normalY: ny }
    }
  }
  return best
}

// Standard shoelace formula — used for the deck's true area when it has a
// non-rectangular outline (replaces width*length).
export function polygonArea(poly: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

// Standard shoelace-based polygon centroid — the TRUE geometric center of
// an arbitrary (including concave — L/Z-shaped) simple polygon, which for
// a non-convex outline measurably diverges from its bounding-box center.
// Used by the stability module to compute a custom-shaped cargo item's real
// TCG/LCG moment arm instead of its bbox center. Falls back to the first
// vertex for a degenerate (near-zero-area) polygon rather than dividing by
// ~0.
export function polygonCentroid(poly: { x: number; y: number }[]): { x: number; y: number } {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i]
    const p1 = poly[(i + 1) % poly.length]
    const cross = p0.x * p1.y - p1.x * p0.y
    a += cross
    cx += (p0.x + p1.x) * cross
    cy += (p0.y + p1.y) * cross
  }
  a *= 0.5
  if (Math.abs(a) < 1e-9) return { x: poly[0]?.x ?? 0, y: poly[0]?.y ?? 0 }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

// True iff `rect` is fully contained in `poly` — all 4 corners inside AND no
// rect edge crosses a polygon edge (the same "corners-in AND no-crossing"
// shape as polygonsOverlap, just testing containment instead of overlap).
// Used to gate interactive cargo placement against a non-rectangular deck
// outline — reuses pointInPolygon/segmentsIntersect directly, no new
// geometry primitives.
export function rectInsidePolygon(
  rect: { x: number; y: number; width: number; length: number },
  poly: { x: number; y: number }[]
): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.length },
    { x: rect.x, y: rect.y + rect.length },
  ]
  for (const c of corners) {
    if (!pointInPolygon(c, poly)) return false
  }
  for (let i = 0; i < corners.length; i++) {
    const a1 = corners[i]
    const a2 = corners[(i + 1) % corners.length]
    for (let j = 0; j < poly.length; j++) {
      const b1 = poly[j]
      const b2 = poly[(j + 1) % poly.length]
      if (segmentsIntersect(a1, a2, b1, b2)) return false
    }
  }
  return true
}

// Removes consecutive near-duplicate vertices — cheap insurance against a
// hand-drawn or dragged point landing right on top of (or a couple
// centimeters from) a neighbor, which would otherwise leave a near-zero-
// length edge in the outline. Most polygon math here (area, point-in-
// polygon, exclusion rects) tolerates a tiny edge fine, but erodePolygon's
// per-edge normal offset is numerically unstable around one — a stray
// duplicate vertex can send that corner's erosion wildly off and corrupt
// the whole shape (confirmed: a real drag interaction occasionally drops an
// extra point within a few cm of the one being moved). The threshold is
// relative to the polygon's own bounding-box diagonal, not a fixed
// distance, so it behaves the same regardless of the deck's display unit
// (m/cm/ft) or size.
export function dedupePolygonVertices(
  poly: { x: number; y: number }[]
): { x: number; y: number }[] {
  if (poly.length < 3) return poly
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  // 0.25% of the polygon's own diagonal (was 1% — on a 20x8m deck that was
  // ~21cm, easily larger than a real, deliberately-drawn small notch or cut
  // corner, e.g. 10-15cm, silently deleting it instead of only catching
  // accidental drag noise). 0.25% is ~5cm on that same deck: still safely
  // catches the real case this exists for (a stray vertex a drag drops a
  // couple cm from its neighbor — see the regression test pinning a 3.6cm
  // case), with real margin below anything a user drew on purpose.
  const eps = Math.max(1e-9, diag * 0.0025)
  const out: { x: number; y: number }[] = []
  for (const p of poly) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p)
  }
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(last.x - first.x, last.y - first.y) <= eps) out.pop()
  }
  return out.length >= 3 ? out : poly
}

// Shrinks a simple polygon inward by `margin` along its real contour — used
// so "board offset" (margin from the ship's board) applies to a
// non-rectangular deck the same way it already applies to a rectangular one,
// instead of only insetting the bounding box and leaving zero clearance
// along a cut/diagonal edge. Each edge is shifted inward along its own
// normal (found via pointInPolygon, so it's correct regardless of winding
// direction), then each new vertex is the intersection of its two adjacent
// shifted edges (as infinite lines, not segments). Falls back to the
// original polygon if erosion would produce a degenerate result (parallel
// edges with no intersection, or a shrunken shape that didn't actually
// shrink) — better to give too little inset than a broken shape.
export function erodePolygon(
  rawPoly: { x: number; y: number }[],
  margin: number
): { x: number; y: number }[] {
  if (margin <= 0 || rawPoly.length < 3) return rawPoly
  const poly = dedupePolygonVertices(rawPoly)
  const n = poly.length
  const offsetLines: { p: { x: number; y: number }; d: { x: number; y: number } }[] = []
  for (let i = 0; i < n; i++) {
    const p1 = poly[i]
    const p2 = poly[(i + 1) % n]
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return poly // degenerate (repeated point) — bail out
    const ux = dx / len
    const uy = dy / len
    let nx = -uy
    let ny = ux
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const probe = { x: mid.x + nx * 1e-3, y: mid.y + ny * 1e-3 }
    if (!pointInPolygon(probe, poly)) {
      nx = -nx
      ny = -ny
    }
    offsetLines.push({ p: { x: p1.x + nx * margin, y: p1.y + ny * margin }, d: { x: ux, y: uy } })
  }
  const result: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = offsetLines[(i - 1 + n) % n]
    const b = offsetLines[i]
    const denom = a.d.x * b.d.y - a.d.y * b.d.x
    if (Math.abs(denom) < 1e-9) return poly // parallel adjacent edges — bail out
    const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / denom
    result.push({ x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t })
  }
  const erodedArea = polygonArea(result)
  if (erodedArea < 1e-6 || erodedArea >= polygonArea(poly)) return poly
  return result
}

// Bbox pre-check first (cheap, already what every caller does) — only
// escalates to precise polygon math when the bbox says "maybe" AND at least
// one side has real outline data. Boxes/circles/pipes/etc. (no outline)
// behave EXACTLY as collidesWith does today — zero behavior change for
// every shape except the new hand-drawn 'custom' one. `gap` is only applied
// during the bbox pre-check (a Minkowski-expanded gap around an arbitrary
// polygon isn't worth the complexity here) — a custom shape's own true
// boundary follows the SAME touching-is-allowed policy as collidesWith and
// overlapsZone: cargo can be placed flush against another cargo's edge or
// a zone/deck boundary without that counting as a collision.
// segmentsIntersect below carries the same eps guard collidesWith does, so
// an exact touching edge resolves the same way regardless of which
// primitive happens to run it.
export function collidesPrecisely(
  a: { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[] },
  others: { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[] }[],
  gap = 0
): boolean {
  for (const b of others) {
    if (!collidesWith(a, [b], gap)) continue
    if (!a.outline && !b.outline) return true
    if (polygonsOverlap(worldPolygon(a), worldPolygon(b))) return true
  }
  return false
}

// Every interactive site (click-place, drag, rotate, nudge) that enforces
// a clearance zone does so by inflating the OTHER placements in `others` via
// withClearanceFootprint before testing `target` against them — which makes
// a zoned placement repel its neighbours, but never stops the zoned
// placement ITSELF from being moved right up against a neighbour that has
// no zone of its own (nothing ever inflated `target` by its own margin).
// Checks both directions — same bidirectional pattern packDeck's own
// pin-vs-pin validation already uses — so a hard-block zone excludes other
// cargo no matter which of the two placements is the one actually moving.
type ClearanceCollisionCandidate = {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: { x: number; y: number }[]
  clearanceMargin?: ClearanceMargin
  shape?: CargoShape
  height?: number
  stackedCount?: number
}
export function collidesWithClearance(
  target: ClearanceCollisionCandidate,
  others: ClearanceCollisionCandidate[],
  gap = 0
): boolean {
  if (collidesPrecisely(target, others.map(withHardBlockFootprint), gap)) return true
  if (collidesPrecisely(withHardBlockFootprint(target), others, gap)) return true
  return false
}

// Clamp a placement so it stays fully inside the deck.
export function clampToDeck(
  placement: { x: number; y: number; width: number; length: number },
  deckWidth: number,
  deckLength: number,
  edgePadding = 0
): { x: number; y: number; width: number; length: number } {
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const pad = toFinite(edgePadding, 0)
  const minX = pad
  const minY = pad
  const maxX = dw - pad - placement.width
  const maxY = dl - pad - placement.length
  return {
    x: Math.max(minX, Math.min(maxX, placement.x)),
    y: Math.max(minY, Math.min(maxY, placement.y)),
    width: placement.width,
    length: placement.length,
  }
}

// Rotate a placement 90deg around its own center, clamp inside the deck, and
// reject it (return null) if it would collide with any other placement. This
// is the single shared rotate+clamp+collision path — used by manual mode,
// pinned single-select rotate, and pinned multi-select rotate — so a margin or
// gap fix only has to be made once.
export function rotatePlacement(
  current: { x: number; y: number; width: number; length: number },
  deckWidth: number,
  deckLength: number,
  edgePadding: number,
  gap: number,
  others: { x: number; y: number; width: number; length: number }[]
): { x: number; y: number; width: number; length: number } | null {
  const newWidth = current.length
  const newLength = current.width
  // clampToDeck only pulls a placement's position back inside the deck — it
  // never shrinks width/length, so a rotated footprint that's simply too
  // big for the deck in one axis (e.g. a long pipe rotated on a deck
  // shorter than it) would silently clamp to the edge and still poke out
  // the opposite side instead of being rejected. Guard for that explicitly
  // before clamping.
  if (newWidth > deckWidth - 2 * edgePadding + 1e-9 || newLength > deckLength - 2 * edgePadding + 1e-9) {
    return null
  }
  const cx = current.x + current.width / 2
  const cy = current.y + current.length / 2
  const clamped = clampToDeck(
    { x: cx - newWidth / 2, y: cy - newLength / 2, width: newWidth, length: newLength },
    deckWidth,
    deckLength,
    edgePadding
  )
  if (collidesWith({ ...clamped, width: newWidth, length: newLength }, others, gap)) {
    return null
  }
  return clamped
}

// rotatePlacement only ever tries ONE spot — rotated in place, centered on
// the item's current center. That's right for the common case (rotating
// clears its own neighbours fine), but means a cramped item flatly refuses
// to rotate even when the deck has plenty of open space a short distance
// away — the rotate button reads as "broken" in a tight layout even though
// nothing is actually full. This tries the in-place rotation first
// (unchanged), and only if that fails, searches a grid of candidate
// positions across the WHOLE usable deck for the rotated footprint,
// nearest-to-current-center first, so a rotate that can't happen exactly
// where the item already sits can still happen a short move away instead
// of failing outright.
export function rotatePlacementAnywhere(
  current: { x: number; y: number; width: number; length: number },
  deckWidth: number,
  deckLength: number,
  edgePadding: number,
  gap: number,
  others: { x: number; y: number; width: number; length: number }[],
  outline?: { x: number; y: number }[]
): { x: number; y: number; width: number; length: number } | null {
  const inPlace = rotatePlacement(current, deckWidth, deckLength, edgePadding, gap, others)
  if (inPlace) return inPlace

  const newWidth = current.length
  const newLength = current.width
  if (newWidth > deckWidth - 2 * edgePadding + 1e-9 || newLength > deckLength - 2 * edgePadding + 1e-9) {
    return null
  }
  const hasOutline = !!outline && outline.length >= 3
  const cx = current.x + current.width / 2
  const cy = current.y + current.length / 2
  const minX = edgePadding
  const minY = edgePadding
  const maxX = deckWidth - edgePadding - newWidth
  const maxY = deckLength - edgePadding - newLength
  if (maxX < minX - 1e-9 || maxY < minY - 1e-9) return null

  // Coarse-to-fine isn't needed at this scale — decks in this app are a
  // handful of tens of meters, and a sub-meter step keeps the candidate
  // count in the low thousands at worst, trivial for a single button click.
  const step = Math.max(0.1, Math.min(newWidth, newLength) / 4)
  const candidates: { x: number; y: number; dist: number }[] = []
  for (let y = minY; y <= maxY + 1e-9; y += step) {
    for (let x = minX; x <= maxX + 1e-9; x += step) {
      const rectCx = x + newWidth / 2
      const rectCy = y + newLength / 2
      candidates.push({ x, y, dist: Math.hypot(rectCx - cx, rectCy - cy) })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist)
  for (const c of candidates) {
    const rect = { x: c.x, y: c.y, width: newWidth, length: newLength }
    if (hasOutline && !rectInsidePolygon(rect, outline!)) continue
    if (collidesWith(rect, others, gap)) continue
    return rect
  }
  return null
}

// Tetris-style drag resolution: snaps the dragged rect to the grid, then tries
// to lock it flush (respecting `gap`) against nearby neighbours or the deck
// margin when the raw drag target is close enough ("magnetic" threshold).
// Falls back to a vector-slide + binary search (same as before) when nothing
// is close enough to lock onto, so free positioning in open space still works.
export function resolveSnappedDragPosition(
  targetX: number,
  targetY: number,
  width: number,
  length: number,
  currentX: number,
  currentY: number,
  others: { x: number; y: number; width: number; length: number }[],
  deckWidth: number,
  deckLength: number,
  edgePadding: number,
  gap: number,
  gridStep: number,
  // How far (in deck units) a lock candidate may be from the raw target and
  // still "win" the magnetic phase. Interactive dragging wants this tight, so
  // the item doesn't teleport to a distant valid spot; non-interactive
  // reflows (e.g. re-validating placements after a margin change) should pass
  // Infinity, since there is no drag vector to stay close to — the nearest
  // collision-free spot is always the right answer.
  maxMagnetDistance = Math.max(gridStep, gap + 0.05, 0.3),
  // The dragged item's own clearance zone, if it has one. `others` above is
  // already inflated by each NEIGHBOUR's own margin (by the caller), but
  // without this, the search below has no idea the item being dragged also
  // needs its own margin kept clear — it could settle on a spot that looks
  // fine here but then fails collidesWithClearance's self-inflated check at
  // the caller's final gate, which is a silent no-op there (nothing commits
  // that frame) and reads as the drag randomly freezing. Inflating the
  // candidate here too is provably safe: raw ⊆ inflated on both sides, so a
  // doubly-inflated non-collision guarantees both of that gate's branches
  // already pass — this can only ever return a position the gate accepts.
  selfMargin?: ClearanceMargin
): { x: number; y: number } {
  // A self-margined item (a clearance zone, or a pipe pyramid's own
  // base-row spread expressed as a margin — see pyramidSpreadAsClearance)
  // must keep its WIDENED extent inside the deck edge/board-offset, not
  // just its raw single-unit rect — otherwise the raw rect can sit flush
  // against the edge while the wider footprint actually drawn on screen
  // sticks out past it. Clamp the widened rect against the deck bounds,
  // then translate back to the raw x/y that's actually stored.
  const ml = selfMargin?.left ?? 0
  const mr = selfMargin?.right ?? 0
  const mt = selfMargin?.top ?? 0
  const mb = selfMargin?.bottom ?? 0
  const tryPos = (x: number, y: number): { x: number; y: number } | null => {
    const wideClamped = clampToDeck(
      { x: x - ml, y: y - mt, width: width + ml + mr, length: length + mt + mb },
      deckWidth,
      deckLength,
      edgePadding
    )
    const clamped = { x: wideClamped.x + ml, y: wideClamped.y + mt }
    const testRect = selfMargin
      ? withClearanceFootprint({ x: clamped.x, y: clamped.y, width, length, clearanceMargin: selfMargin })
      : { ...clamped, width, length }
    if (!collidesWith(testRect, others, gap)) {
      return { x: clamped.x, y: clamped.y }
    }
    return null
  }
  const minX = edgePadding
  const minY = edgePadding
  const maxX = deckWidth - edgePadding - width
  const maxY = deckLength - edgePadding - length

  // A margin's magnet zone reaches maxMagnetDistance from EACH edge — fine
  // for a normal item with plenty of free-slide room, but when the item's
  // own size leaves only a small usable range on an axis (e.g. a 6m
  // container's length on an 8m deck, leaving ~1.5m of room), both edges'
  // zones can cover that entire range at once. Every drag target then falls
  // within range of at least one edge, so the item can only ever be
  // released flush against a margin — never anywhere in between, no matter
  // where the cursor is. Capping each margin candidate's own radius to at
  // most a third of that axis's free-slide room guarantees a real free
  // (cursor-tracking) zone always survives in the middle; neighbour-flush
  // candidates below are unaffected, since two placed items being nearly as
  // large as the whole deck isn't the scenario this is guarding against.
  const xRoom = Math.max(0, maxX - minX)
  const yRoom = Math.max(0, maxY - minY)
  const marginMagnetX = Math.min(maxMagnetDistance, xRoom / 3)
  const marginMagnetY = Math.min(maxMagnetDistance, yRoom / 3)

  // Lock candidates: flush against the deck margin or a neighbour. These
  // compete only against each other for "closest to the cursor, within
  // maxDist" — the raw cursor position itself is deliberately NOT one of
  // these candidates (see below), since it would trivially win every time
  // (distance 0) and the neighbour/edge magnet would never fire.
  const lockCandidates: { x: number; y: number; maxDist: number }[] = [
    { x: minX, y: targetY, maxDist: marginMagnetX },
    { x: maxX, y: targetY, maxDist: marginMagnetX },
    { x: targetX, y: minY, maxDist: marginMagnetY },
    { x: targetX, y: maxY, maxDist: marginMagnetY },
  ]

  for (const o of others) {
    // Only snap horizontally to a neighbour if the rects would actually be
    // vertically adjacent (span overlap) — otherwise you'd get a nonsensical
    // snap to a neighbour clear across the deck. Uses the raw target so a
    // small item dragged near a large neighbour is correctly detected as
    // adjacent even when a grid-rounded position would have fallen outside
    // the neighbour's span.
    const vOverlap = targetY < o.y + o.length && targetY + length > o.y
    if (vOverlap) {
      lockCandidates.push({ x: o.x - gap - width, y: targetY, maxDist: maxMagnetDistance })
      lockCandidates.push({ x: o.x + o.width + gap, y: targetY, maxDist: maxMagnetDistance })
    }
    const hOverlap = targetX < o.x + o.width && targetX + width > o.x
    if (hOverlap) {
      lockCandidates.push({ x: targetX, y: o.y - gap - length, maxDist: maxMagnetDistance })
      lockCandidates.push({ x: targetX, y: o.y + o.length + gap, maxDist: maxMagnetDistance })
    }
  }

  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (const c of lockCandidates) {
    const res = tryPos(c.x, c.y)
    if (!res) continue
    const dist = Math.hypot(res.x - targetX, res.y - targetY)
    if (dist <= c.maxDist && dist < bestDist) {
      best = res
      bestDist = dist
    }
  }
  if (best) return best

  // Nothing to lock onto nearby — track the cursor exactly. Dragging over
  // open deck space should feel 100% free, not teleport between grid cells.
  const free = tryPos(targetX, targetY)
  if (free) return free

  // Fallback: X-only / Y-only, then binary search along the movement vector
  // toward the raw cursor target (not a grid-rounded point), same behaviour
  // as before snapping existed — a blocked drag eases up to exactly where
  // the cursor is once the path clears rather than resting on a grid line
  // short of it. (The exact target itself was already tried above as `free`.)
  const fallbackCandidates: { x: number; y: number }[] = [
    { x: targetX, y: currentY },
    { x: currentX, y: targetY },
  ]
  for (const c of fallbackCandidates) {
    const res = tryPos(c.x, c.y)
    if (res) return res
  }

  let lo = 0
  let hi = 1
  let bestSlide: { x: number; y: number } | null = null
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2
    const x = currentX + (targetX - currentX) * mid
    const y = currentY + (targetY - currentY) * mid
    const res = tryPos(x, y)
    if (res) {
      bestSlide = res
      lo = mid
    } else {
      hi = mid
    }
  }
  if (bestSlide) return bestSlide

  // The straight line from where the drag started to the cursor is fully
  // blocked end-to-end (typically: an immediately-adjacent neighbour sits
  // right on that line, so even the smallest step along it collides) —
  // every candidate above (lock, free, single-axis, vector binary search)
  // only ever tries points ON that one line, so it can never route AROUND
  // the obstacle. Without this, the item reads as permanently "stuck": no
  // matter how far the cursor keeps moving, every subsequent frame's
  // vector still passes near the same blocking neighbour close to its
  // start, so the binary search above converges back to ~0 every time.
  // Break out of the 1-D search here with a bounded local scan CENTRED ON
  // THE CURSOR (not the blocked vector), so a position just to the side of
  // the obstacle — which the cursor may already be well past — is found
  // and the drag can "escape" instead of free-falling to a full freeze.
  // Measure against the CLAMPED target, not the raw cursor position — the
  // cursor routinely ends up past the deck edge (dragging toward open
  // space beyond a small deck is normal), and "closest to an arbitrarily
  // far-off-deck point" is a meaningless ranking; every in-bounds
  // candidate would tie on "which direction is off-deck" instead of on
  // genuine proximity to where the item could actually end up.
  const clampedTarget = clampToDeck({ x: targetX, y: targetY, width, length }, deckWidth, deckLength, edgePadding)
  const escapeRadius = Math.max(width, length) * 2
  const escapeStep = Math.max(gridStep, 0.1)
  let bestEscape: { x: number; y: number; dist: number } | null = null
  for (let oy = -escapeRadius; oy <= escapeRadius; oy += escapeStep) {
    for (let ox = -escapeRadius; ox <= escapeRadius; ox += escapeStep) {
      if (Math.hypot(ox, oy) > escapeRadius) continue
      const res = tryPos(clampedTarget.x + ox, clampedTarget.y + oy)
      if (!res) continue
      const resDist = Math.hypot(res.x - clampedTarget.x, res.y - clampedTarget.y)
      if (!bestEscape || resDist < bestEscape.dist) bestEscape = { x: res.x, y: res.y, dist: resDist }
    }
  }
  if (bestEscape) return { x: bestEscape.x, y: bestEscape.y }

  // Last resort: never return a position outside the usable margin, even if
  // it still collides — clampToDeck guarantees at least that much validity.
  const clampedCurrent = clampToDeck({ x: currentX, y: currentY, width, length }, deckWidth, deckLength, edgePadding)
  return { x: clampedCurrent.x, y: clampedCurrent.y }
}

export function packingResultFromManual(
  deckWidth: number,
  deckLength: number,
  placements: ManualPlacement[],
  totalRequested: number,
  items?: CargoItem[],
  clearance?: number,
  outline?: { x: number; y: number }[]
): PackingResult {
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const totalArea = outline && outline.length >= 3 ? polygonArea(outline) : dw * dl
  const totalRequestedSafe = toPositiveInt(totalRequested, 0)
  // R29 (malformed-placement contract, corrected — see QuarantinedPlacement's
  // own doc comment): same exclusion as packDeck's pin loop — a placement
  // with no valid `composition` to fall back on must never be treated as an
  // ordinary single-item placement using its raw, untrustworthy
  // `layers`/`weight`. Excluded from every calculation below (weight/
  // layers/breakdown/quantity); reported in the separate `result.quarantined`
  // channel, never `unplaced`. The placement itself is never mutated or
  // dropped from the project.
  const quarantinedPlacements = placements.filter((p) => p.malformed && !p.composition)
  const activePlacements = placements.filter((p) => !(p.malformed && !p.composition))
  // `composition` is this placement's sole source of physical truth once
  // present (see PlacedItem.composition's doc comment) — its own segment
  // total is authoritative, not `p.layers` (a stale/corrupted `p.layers`
  // that disagreed with `composition` used to silently break the
  // sum(composition.layers) === PlacedItem.layers invariant; deriving
  // layers FROM composition instead makes that invariant hold by
  // construction, the same fix applied to packDeck's pin loop above).
  const layersFor = (p: ManualPlacement) => (p.composition ? placementTotalLayers(p) : toLayers(p.layers, 1))
  // Composition-aware total: for a composed placement, `weight` is only a
  // backward-compatible AVERAGE per unit (see PlacedItem.composition's doc
  // comment) — the true total comes from summing each segment's own
  // catalog weight, not `average * layers` (though those are mathematically
  // equal by construction, going straight to the segments avoids relying on
  // that invariant staying correct upstream).
  const weightFor = (p: ManualPlacement) =>
    p.composition ? placementTotalWeightKg(p, items ?? []) : toFinite(p.weight ?? 0, 0) * layersFor(p)
  const usedArea = activePlacements.reduce((s, p) => s + toFinite(p.width, 0) * toFinite(p.length, 0), 0)
  const totalWeight = activePlacements.reduce((s, p) => s + weightFor(p), 0)
  const placedCount = activePlacements.reduce((s, p) => s + layersFor(p), 0)

  // Build per-item map for requested quantity and max layers — also feeds
  // each placement's own height below (manual placements don't carry their
  // own height, only the source item does; without this every manual
  // placement reports height 0, which is invisible/flat in any 3D view even
  // though the 2D top-down view never needed it).
  const itemMap = new Map<string, { quantity: number; height: number; shape?: CargoShape; outline?: { x: number; y: number }[]; contents?: string; maxLayers?: number; stabilityOverride?: StabilityOverride; nest?: PipeNestSpec }>()
  if (items) {
    for (const it of items) {
      itemMap.set(it.id, { quantity: it.quantity, height: it.height ?? 0, shape: it.shape, outline: it.outline, contents: it.contents, maxLayers: it.maxLayers, stabilityOverride: it.stabilityOverride, nest: it.nest })
    }
  }

  const placed = activePlacements.map((p, i) => {
    const layers = layersFor(p)
    // Copied through verbatim, NEVER synthesized — see PlacedItem.composition's
    // own doc comment. `weight`/`height` become the backward-compatible
    // AVERAGE per unit when composed, so `weight * layers` (every existing
    // consumer's convention, e.g. the breakdown map below) still reconstructs
    // the correct TOTAL.
    const pWeight = p.composition
      ? placementTotalWeightKg(p, items ?? []) / Math.max(1, layers)
      : p.weight
    const pHeight = p.composition
      ? placementTotalHeightM(p, items ?? []) / Math.max(1, layers)
      : (itemMap.get(p.itemId)?.height ?? 0)
    return {
      itemId: p.itemId,
      name: p.name,
      x: p.x,
      y: p.y,
      width: p.width,
      length: p.length,
      height: pHeight,
      layers,
      stackedCount: layers,
      rotated: p.rotated,
      color: p.color,
      weight: pWeight,
      index: i,
      // Composition-aware geometry (R29 pass 4A, G1 red-team gate), mirrors
      // packDeck's identical construction — shape/outline use
      // resolveUniformShape/resolveUniformOutline (uniform-only: every
      // constituent must genuinely agree), NOT resolvePyramidShape's more
      // permissive "any constituent is pipe" rule, which is reserved
      // exclusively for the physical pyramidMargin field below — see
      // PlacedItem.pyramidMargin's own doc comment for why conflating the
      // two is wrong in both directions. contents/stabilityOverride/nest are
      // deliberately left resolving via the nominal p.itemId only: contents
      // is cosmetic tooltip text; stability.ts never reads
      // PlacedItem.stabilityOverride for a composed placement (it derives
      // VCG/TCG/LCG per-segment from `composition` directly — see
      // stability.ts's buildCargoWeightMoments); nest is structurally
      // impossible on a composed placement (isPipeShape's own merge gate
      // excludes nested pipe items from ever merging) — all three are either
      // inert or harmless for a Tier-1 placement regardless of which itemId
      // resolves.
      shape: resolveUniformShape(p, items ?? []),
      outline: resolveUniformOutline(p, items ?? []),
      pyramidMargin: (() => {
        const geom = resolvePyramidShape(p, p.width, p.length, items ?? [])
        const m = pipePyramidSpreadMargin({ shape: geom.shape, width: p.width, length: p.length, height: geom.height }, layers)
        return m.onWidth === 0 && m.onLength === 0 ? undefined : m
      })(),
      contents: itemMap.get(p.itemId)?.contents,
      clearanceMargin: p.clearanceMargin,
      // The placement's OWN override (if ever set — nothing writes one today,
      // see ManualPlacement.stabilityOverride's own comment) must win over
      // the item's, not be silently discarded in favor of it.
      stabilityOverride: p.stabilityOverride ?? itemMap.get(p.itemId)?.stabilityOverride,
      nest: itemMap.get(p.itemId)?.nest,
      composition: p.composition,
    }
  })

  // Breakdown by itemId — Round 23: composition-aware attribution, same
  // fix and same reasoning as packDeck's breakdown builder above (see its
  // comment for the full [A2,B3] example). Before this fix, a composed
  // placement's `p.itemId` (nominal only) was the SOLE key into `map`, so
  // a non-nominal constituent (B in [A2,B3]) never got its own row at all
  // — which also cascaded into `unplaced` below, since that reads
  // `map.get(it.id)?.placed` directly.
  const map = new Map<string, ItemBreakdown>()
  let maxStackHeight = 0
  // `preferredName`/`preferredColor` (undefined for a composed non-nominal
  // constituent — it has no placement-level frozen identity of its own to
  // prefer) win over the catalog lookup when given, so an UNCOMPOSED
  // placement's row keeps using the placement's own frozen `p.name`/
  // `p.color` exactly as before this fix — never the live catalog name/
  // color, which is a deliberate, pre-existing distinction (frozen
  // snapshot vs live catalog) this round does not touch.
  const getOrInitRow = (
    itemId: string,
    preferredName: string | undefined,
    preferredColor: string | undefined,
    preferredUnitWeight: number | undefined,
    maxSegLayers: number
  ): ItemBreakdown => {
    const itemInfo = itemMap.get(itemId)
    const catalogItem = (items ?? []).find((it) => it.id === itemId)
    return (
      map.get(itemId) ?? {
        itemId,
        name: preferredName ?? catalogItem?.name ?? itemId,
        color: preferredColor ?? catalogItem?.color ?? '#999999',
        requested: itemInfo?.quantity ?? 0,
        placed: 0,
        footprints: 0,
        // Prefer the user's own "Ярусов" cap (see the matching comment in
        // packDeck's breakdown builder above) — only fall back to the real
        // tallest stack actually placed when no cap is set.
        layers: itemInfo?.maxLayers && itemInfo.maxLayers > 0 ? itemInfo.maxLayers : maxSegLayers,
        area: 0,
        weight: 0,
        // Same "placement's own weight can be overridden independently of
        // its source item" precedence as the pre-Round-23 uncomposed
        // formula — a composed constituent has no such placement-level
        // override field of its own, so it falls straight to the live
        // catalog weight (preferredUnitWeight undefined in that case).
        unitWeight: preferredUnitWeight ?? catalogItem?.weight ?? 0,
      }
    )
  }
  for (const p of placed) {
    // p.height is already the correct per-unit value (composition-aware
    // average when composed, plain catalog height otherwise) — using it
    // instead of a fresh itemInfo lookup keeps this composition-aware for
    // free, since average * stackedCount reconstructs the true total.
    const stackHeight = p.height * p.stackedCount
    if (stackHeight > maxStackHeight) maxStackHeight = stackHeight

    if (p.composition) {
      for (const c of placementConstituents(p, items ?? [])) {
        const itemInfo = itemMap.get(c.itemId)
        const b = getOrInitRow(c.itemId, undefined, undefined, undefined, c.layers)
        if (!(itemInfo?.maxLayers && itemInfo.maxLayers > 0)) {
          b.layers = Math.max(b.layers, c.layers)
        }
        b.placed += c.layers
        b.weight += c.weightKg
        map.set(c.itemId, b)
      }
      // Footprint/area counted once per DISTINCT constituent itemId this
      // placement contains — same whole-footprint-per-constituent
      // convention as packDeck's breakdown builder (see its comment).
      const uniqueIds = new Set(p.composition.map((seg) => seg.itemId))
      for (const itemId of uniqueIds) {
        const b = getOrInitRow(itemId, undefined, undefined, undefined, 0)
        b.footprints += 1
        b.area += p.width * p.length
        map.set(itemId, b)
      }
    } else {
      const itemInfo = itemMap.get(p.itemId)
      const b = getOrInitRow(p.itemId, p.name, p.color, p.weight ?? 0, p.stackedCount)
      if (!(itemInfo?.maxLayers && itemInfo.maxLayers > 0)) {
        b.layers = Math.max(b.layers, p.stackedCount)
      }
      b.placed += p.stackedCount
      b.footprints += 1
      b.area += p.width * p.length
      b.weight += (p.weight ?? 0) * p.stackedCount
      map.set(p.itemId, b)
    }
  }

  // Manual mode never had this populated — nothing is "rejected" by an
  // algorithm here, the user just hasn't clicked yet. But from the user's
  // point of view "some of my declared cargo isn't on the deck" is the same
  // fact either way, and the top unplaced-cargo banner (and the "Не влезло"
  // stat) stayed permanently blind to it in manual mode as a result. Report
  // each item's own shortfall (declared quantity minus what's actually
  // placed), worded as "not yet placed" rather than auto mode's "didn't
  // fit" — this is a to-do, not a packing failure.
  const unplaced: UnplacedItem[] = []
  if (items) {
    for (const it of items) {
      const placedForItem = map.get(it.id)?.placed ?? 0
      const remaining = Math.max(0, toPositiveInt(it.quantity, 0) - placedForItem)
      if (remaining > 0) {
        unplaced.push({
          itemId: it.id,
          name: it.name,
          width: toFinite(it.width, 0),
          length: toFinite(it.length, 0),
          reason: `Не размещено вручную (${remaining} ед.)`,
        })
      }
    }
  }
  const quarantined: QuarantinedPlacement[] = quarantinedPlacements.map((p) => ({
    id: p.id,
    itemId: p.itemId,
    name: p.name,
    reason: 'Груз повреждён — физический состав не удалось определить при загрузке проекта',
  }))

  return {
    placed,
    unplaced,
    quarantined,
    breakdown: [...map.values()],
    requestedCount: totalRequestedSafe,
    placedCount,
    totalArea,
    usedArea,
    freeArea: Math.max(0, totalArea - usedArea),
    utilization: totalArea > 0 ? Math.min(1, usedArea / totalArea) : 0,
    totalWeight,
    maxStackHeight,
    deckWidth: dw,
    deckLength: dl,
  }
}

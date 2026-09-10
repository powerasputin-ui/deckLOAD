// Pure functions for reading and mutating `composition` (see
// CompositionSegment/ManualPlacement.composition/PinnedPlacement.composition
// in packing.ts for the full contract). This is the ONLY place that should
// ever do composition arithmetic — every consumer (packDeck's pin loop,
// packingResultFromManual, stability.ts, lashing, the merge/+/- UI
// handlers, removeItem, rendering) is meant to call into these functions
// rather than re-derive the same logic locally, which is exactly how the
// weight-blend bug (Round 10) and its downstream siblings (height,
// category, stability, maxLayers, allowRotation — Rounds 11/12) happened:
// the same "sum across constituents" arithmetic got re-implemented ad hoc
// in several places, and some of them were simply never updated.
//
// Every one of the consumers listed above is composition-aware today —
// planComposedMerge (page.tsx, Round 24) is the sole writer that ever
// creates a `composition`, and each reader (packDeck/packingResultFromManual,
// stability.ts's per-segment VCG/TCG/LCG, Sidebar.tsx/exportPdf.ts's
// lashing, Deck3DView.tsx's per-segment tiers, the `+`/`-` push/pop
// handlers, checkLayerChange's quantity accounting, removeItem's
// constituent surgery) was migrated onto this module's functions across
// Rounds 14–24, rather than left resolving a placement's physical
// properties by its single nominal itemId.

import type { CompositionSegment, StabilityOverride } from './packing'
// From stabilityMath.ts, NOT stability.ts — see stabilityMath.ts's own doc
// comment. stability.ts's buildCargoWeightMoments will need to import FROM
// this module in Round 14 to become composition-aware; if this module
// imported computeItemVCG from stability.ts instead, that would be a
// circular dependency the moment that wiring lands.
import { computeItemVCG } from './stabilityMath'

// The minimal shape any placement (ManualPlacement or PinnedPlacement)
// needs to expose for these functions — deliberately narrow so this module
// has no dependency on either concrete interface.
export interface ComposablePlacement {
  itemId: string
  layers: number
  composition?: CompositionSegment[]
}

// The minimal shape of a catalog CargoItem these functions need to resolve
// a segment's physical properties.
export interface CompositionCatalogItem {
  id: string
  weight?: number
  height: number
  stabilityOverride?: StabilityOverride
}

// A composed placement's `composition` IS its segment list; an ordinary
// (uncomposed) placement's single itemId/layers is treated as an implicit
// one-segment composition for every function below — this is what makes
// every function here behave identically to today's pre-composition
// arithmetic when `composition` is absent, with zero special-casing at
// call sites.
export function segmentsOf(p: ComposablePlacement): CompositionSegment[] {
  return p.composition ?? [{ itemId: p.itemId, layers: p.layers }]
}

function findItem(items: CompositionCatalogItem[], itemId: string): CompositionCatalogItem | undefined {
  return items.find((it) => it.id === itemId)
}

export function placementTotalLayers(p: ComposablePlacement): number {
  return segmentsOf(p).reduce((sum, seg) => sum + seg.layers, 0)
}

// How many layers of a SPECIFIC itemId this placement physically contains —
// the primitive every quantity-accounting consumer (checkLayerChange,
// updateItem's decrease-warning, packDeck's remainingByItem) needs instead
// of filtering `placement.itemId === itemId` and summing `placement.layers`
// wholesale. That filter-and-sum-whole pattern is wrong on BOTH sides for a
// composed placement: it MISSES a constituent that isn't the nominal itemId
// (e.g. a [A2,B3] placement whose nominal itemId is A contributes 0 to B's
// count, though 3 real units of B are physically inside it), and it
// OVER-counts when the nominal itemId itself is checked (the same placement
// would report a full 5 for A, though only 2 of those 5 layers are A). For
// an uncomposed placement this degenerates to the exact old filter-and-sum
// (segmentsOf's synthesized single segment either matches itemId in full or
// not at all), so every existing (uncomposed) call site's result is
// unchanged.
export function placementLayersOfItem(p: ComposablePlacement, itemId: string): number {
  return segmentsOf(p).reduce((sum, seg) => (seg.itemId === itemId ? sum + seg.layers : sum), 0)
}

export function placementTotalWeightKg(p: ComposablePlacement, items: CompositionCatalogItem[]): number {
  return segmentsOf(p).reduce((sum, seg) => sum + seg.layers * (findItem(items, seg.itemId)?.weight ?? 0), 0)
}

// Round 23 (composition-aware quantity/weight attribution). The one place
// every accounting consumer that needs to attribute a composed placement's
// units AND weight to each of its OWN constituent itemIds — not the
// placement's nominal itemId — is meant to call into, instead of
// re-deriving `segmentsOf(p).map(...)` locally (which is exactly how the
// breakdown misattribution bug happened independently in packDeck AND
// packingResultFromManual: the same "resolve each segment's own catalog
// weight" arithmetic re-implemented ad hoc rather than shared). Narrow on
// purpose — mirrors segmentLashingInputs' shape (itemId/layers/weightKg
// only, no name/color/category), since callers that need those resolve
// them from their OWN already-available catalog data, not from here.
//
// For plain unit/layer counting (no weight involved), use the existing
// `placementLayersOfItem` instead of this — it already IS the canonical
// per-itemId layer-count primitive and doesn't need a composed placement's
// full constituent breakdown to answer "how many of X does this placement
// contain".
//
// Degenerates to the placement's own single implicit segment for an
// uncomposed placement (segmentsOf's fallback), so every existing
// (uncomposed) call site is unaffected if it switches to this.
export function placementConstituents(
  p: ComposablePlacement,
  items: CompositionCatalogItem[]
): { itemId: string; layers: number; weightKg: number }[] {
  return segmentsOf(p).map((seg) => ({
    itemId: seg.itemId,
    layers: seg.layers,
    weightKg: seg.layers * (findItem(items, seg.itemId)?.weight ?? 0),
  }))
}

export function placementTotalHeightM(p: ComposablePlacement, items: CompositionCatalogItem[]): number {
  return segmentsOf(p).reduce((sum, seg) => sum + seg.layers * (findItem(items, seg.itemId)?.height ?? 0), 0)
}

// Weight-weighted average VCG, in the SAME deck-relative convention as
// computeItemVCG's own return value (shipFrame.heightAboveBaselineM is
// added once, at the ship level, by whoever consumes this — same as today).
//
// This is NOT a naive average of each segment's OWN computeItemVCG result:
// a segment sitting ABOVE others in the pile needs its contribution offset
// by the cumulative height of everything stacked below it first ("baseline"
// below) — otherwise every segment would be treated as if it alone sat
// directly on the deck. computeItemVCG's own DEFAULT formula (height*
// layers/2) and its nest branch (vcg+half-height) both genuinely give "how
// high above THIS segment's OWN base its centroid sits" — baseline is
// exactly the missing piece that turns that into "how high above the DECK".
//
// An explicit stabilityOverride.vcgAboveDeckM is a DIFFERENT case, on
// purpose: per its own doc comment (packing.ts's StabilityOverride — "an
// absolute value like vcgAboveDeckM", contrasted there with tcgOffsetM/
// lcgOffsetM's explicitly non-absolute, additive semantics), it already
// names an absolute height above the deck surface, not a height above
// wherever this segment happens to sit in the stack — the same contract
// computeItemVCG honors for an ordinary (uncomposed) placement, where its
// return value is used as-is, with no per-layer/per-stack adjustment at
// all. Adding `baselineM` to it here would double-count the stack height
// beneath this segment into a number that was never meant to be relative
// in the first place — an EARLIER version of this function did exactly
// that (P1 corrective patch, post-Round-14 review): for [A2,B3] with an
// override on B (the TOP segment, baselineM=2.0 from A), it silently
// turned an override the caller entered as "3.0 m above the deck" into an
// absolute VCG of 5.0 m. Only a segment WITHOUT its own override gets
// baseline added; an overridden segment's absolute value is used verbatim.
//
// A weight-weighted average (not per-segment WeightMoment expansion) is
// mathematically sufficient here, not a simplification that loses
// accuracy: ship-level moment summation is linear
// (Σ weight_i·vcg_i = totalWeight · weightedAverage(vcg_i)), so a single
// {weightKg: total, vcgM: this average} contribution per placement is
// exactly equivalent to expanding it into N separate contributions and
// summing them at the ship level — this placement's total contribution to
// the ship's overall moment is identical either way. Callers (Round 17)
// don't need buildCargoWeightMoments to change its "one WeightMoment per
// placement" shape at all — just the WEIGHT and VCG values fed into it.
export function placementTotalVCG(p: ComposablePlacement, items: CompositionCatalogItem[]): number {
  let baselineM = 0
  let weightedSum = 0
  let totalWeightKg = 0
  for (const seg of segmentsOf(p)) {
    const item = findItem(items, seg.itemId)
    const segWeightKg = seg.layers * (item?.weight ?? 0)
    const segHeightM = item?.height ?? 0
    const hasAbsoluteOverride = item?.stabilityOverride?.vcgAboveDeckM !== undefined
    const vcgAbsolute = hasAbsoluteOverride
      ? computeItemVCG({ height: segHeightM, layers: seg.layers, stabilityOverride: item?.stabilityOverride })
      : baselineM +
        computeItemVCG({
          height: segHeightM,
          layers: seg.layers,
          stabilityOverride: item?.stabilityOverride,
        })
    weightedSum += segWeightKg * vcgAbsolute
    totalWeightKg += segWeightKg
    baselineM += segHeightM * seg.layers
  }
  return totalWeightKg > 0 ? weightedSum / totalWeightKg : 0
}

// Weight-weighted average of each segment's tcgOffsetM/lcgOffsetM — the
// ADDITIVE correction component only (mirrors stabilityOverride.tcgOffsetM/
// lcgOffsetM's own existing "added to the auto-computed, position-derived
// arm" semantics — see stability.ts's own comment on that field). The
// auto-computed arm itself depends on deck position/dimensions, which is
// not a placement-only concern, so it stays computed at the ship level
// exactly as today; a future caller adds this offset to that arm the same
// way it already adds `stabilityOverride?.tcgOffsetM ?? 0` for an
// uncomposed placement.
function weightedOffset(p: ComposablePlacement, items: CompositionCatalogItem[], pick: (o: StabilityOverride | undefined) => number | undefined): number {
  let weightedSum = 0
  let totalWeightKg = 0
  for (const seg of segmentsOf(p)) {
    const item = findItem(items, seg.itemId)
    const segWeightKg = seg.layers * (item?.weight ?? 0)
    weightedSum += segWeightKg * (pick(item?.stabilityOverride) ?? 0)
    totalWeightKg += segWeightKg
  }
  return totalWeightKg > 0 ? weightedSum / totalWeightKg : 0
}

export function placementTotalTCGOffset(p: ComposablePlacement, items: CompositionCatalogItem[]): number {
  return weightedOffset(p, items, (o) => o?.tcgOffsetM)
}

export function placementTotalLCGOffset(p: ComposablePlacement, items: CompositionCatalogItem[]): number {
  return weightedOffset(p, items, (o) => o?.lcgOffsetM)
}

// Appends `layers` units of `itemId` to the TOP of `existing` (bottom-to-top
// order — see CompositionSegment's own doc comment). Coalesces into the
// current top segment only if it already holds the same itemId (physically
// contiguous); never coalesces across a different item's segment.
// `existing: undefined` means "start composing from nothing" — used both to
// synthesize a plain placement's implicit one-segment composition when it
// first takes part in a merge, and to build up a merge result one pushed
// segment at a time (see placementConcatComposition below for merging two
// WHOLE composition arrays at once).
//
// This module is the one place composition arithmetic is meant to happen —
// that only holds if it actually refuses to produce a composition that
// violates its own invariant (every segment's layers a positive integer).
// An invalid `layers` (0, negative, fractional, NaN, Infinity) is a caller
// bug, not a value to silently coerce or half-apply — returns `existing`
// (cloned, untouched) rather than a corrupted array.
export function placementPush(existing: CompositionSegment[] | undefined, itemId: string, layers: number): CompositionSegment[] {
  const segs = (existing ?? []).map((s) => ({ ...s }))
  if (!Number.isInteger(layers) || layers <= 0) return segs
  const top = segs[segs.length - 1]
  if (top && top.itemId === itemId) top.layers += layers
  else segs.push({ itemId, layers })
  return segs
}

// Concatenates a whole `dragged` composition onto the top of `target` —
// the shape a merge actually needs (E's merge algorithm step 7), built from
// placementPush so the SAME single coalescing rule applies at the boundary
// (only the dragged array's first segment can ever coalesce with target's
// last; everything else in `dragged` is already a valid, non-adjacent-
// coalesced composition in its own right and stays exactly as it was).
export function placementConcatComposition(target: CompositionSegment[], dragged: CompositionSegment[]): CompositionSegment[] {
  let result = target.map((s) => ({ ...s }))
  for (const seg of dragged) {
    result = placementPush(result, seg.itemId, seg.layers)
  }
  return result
}

export interface PopResult {
  // The composition AFTER popping one unit off the top, when 2+ segments
  // remain (still genuinely composed).
  composition: CompositionSegment[] | null
  // Set instead of `composition` when popping leaves exactly one segment —
  // the caller should "un-compose" the placement back to an ordinary
  // single-item one (composition: undefined, itemId/layers/weight become
  // independently-writable flat fields again, taken from this segment).
  remainingSingleton: CompositionSegment | null
  // Which item the freed unit belongs to — the caller uses this (not the
  // placement's own nominal itemId) to stand the freed unit up as its own
  // new single-layer placement, per C2's explicit contract: `-` always
  // pops the physically topmost unit, which may not match the placement's
  // own nominal itemId.
  freedItemId: string
}

// Pops exactly one physical unit off the top of `composition` (must be a
// genuine composed array, length >= 2, per the data model's own invariant
// — an uncomposed placement's "-" doesn't go through this at all, it keeps
// using the existing plain layers-1 decrement).
export function placementPop(composition: CompositionSegment[]): PopResult {
  const segs = composition.map((s) => ({ ...s }))
  const top = segs[segs.length - 1]
  const freedItemId = top.itemId
  if (top.layers > 1) top.layers -= 1
  else segs.pop()
  if (segs.length >= 2) return { composition: segs, remainingSingleton: null, freedItemId }
  if (segs.length === 1) return { composition: null, remainingSingleton: segs[0], freedItemId }
  return { composition: null, remainingSingleton: null, freedItemId }
}

export interface RemoveItemResult {
  // Same shape as PopResult's two cases, plus the fully-emptied case
  // (composition: null, remainingSingleton: null) when removing this item
  // clears the placement out entirely.
  composition: CompositionSegment[] | null
  remainingSingleton: CompositionSegment | null
  // Total layers removed across every segment that matched `itemId` — the
  // exact contract from the migration plan's removeItem section: summed
  // across ALL matching segments (there can be more than one, if the same
  // item appears in two non-adjacent segments), never just the first one
  // found, and never inferred from the placement's own nominal itemId or
  // its layers field.
  removedLayers: number
}

// Removes EVERY segment matching `itemId` from `composition` (there can be
// more than one non-adjacent occurrence — see the migration plan's
// removeItem contract), then coalesces any segments that became adjacent
// as a result. This is the one function `removeItem`'s real UI wiring
// (Round 15) is meant to call for every placement it touches — it never
// determines what to return to the catalog's quantity pool by reading
// `placement.itemId`/`placement.layers`, only by summing what THIS
// function reports as removed.
export function placementRemoveItem(itemId: string, composition: CompositionSegment[]): RemoveItemResult {
  const removedLayers = composition.filter((s) => s.itemId === itemId).reduce((sum, s) => sum + s.layers, 0)
  const remaining = composition.filter((s) => s.itemId !== itemId)
  const coalesced: CompositionSegment[] = []
  for (const seg of remaining) {
    const last = coalesced[coalesced.length - 1]
    if (last && last.itemId === seg.itemId) last.layers += seg.layers
    else coalesced.push({ ...seg })
  }
  if (coalesced.length >= 2) return { composition: coalesced, remainingSingleton: null, removedLayers }
  if (coalesced.length === 1) return { composition: null, remainingSingleton: coalesced[0], removedLayers }
  return { composition: null, remainingSingleton: null, removedLayers }
}

export interface ClampItemLayersResult {
  // Same two-case shape as PopResult/RemoveItemResult. `remainingSingleton`
  // is unreachable in practice for this operation specifically (clamping
  // never removes a segment belonging to a DIFFERENT itemId, and `maxLayers`
  // is always >= 1 — see maxLayersFor's own contract — so `itemId`'s own
  // presence in the composition is reduced, never fully eliminated), but
  // the shape is kept symmetric with the other composition-mutation
  // primitives above rather than silently assuming a 2+-segment result.
  composition: CompositionSegment[] | null
  remainingSingleton: CompositionSegment | null
  // How many layers were actually discarded — 0 if `itemId`'s own total was
  // already within `maxLayers` (including when `itemId` isn't present in
  // `composition` at all).
  removedLayers: number
}

// Reduces `itemId`'s own total layers within `composition` down to at most
// `maxLayers`, discarding the excess. This is the composition-aware form of
// the exact same destructive clamp an ordinary (uncomposed) placement has
// always been subject to when its item's maxLayers/height is tightened
// after it's already placed (see calculator.ts's updateItem,
// layerCapChanged): the excess is simply gone — not stood up as a new
// placement elsewhere (unlike `-`/placementPop), not returned to catalog
// quantity (unlike placementRemoveItem/removeItem). Extending that same
// established, already-destructive precedent to composed placements at the
// CONSTITUENT level (only `itemId`'s own segment(s) are touched, at most
// down to `itemId`'s own limit) is the minimal, non-novel behavior — it
// does not invent a new "return quantity" or "re-place elsewhere" contract
// that doesn't already exist for the uncomposed case.
//
// Removes from the topmost (highest-index, i.e. bottom-to-top order's own
// top) matching segment(s) first, mirroring placementPop's "physically
// topmost first" convention, until `itemId`'s own total is at most
// `maxLayers`. Segments belonging to any OTHER itemId are never touched; if
// removing one of `itemId`'s segments entirely leaves two segments of the
// SAME other itemId newly adjacent, they're coalesced — the same rule
// placementRemoveItem already applies, for the same reason.
export function placementClampItemLayers(
  composition: CompositionSegment[],
  itemId: string,
  maxLayers: number
): ClampItemLayersResult {
  const currentTotal = composition.reduce((sum, s) => (s.itemId === itemId ? sum + s.layers : sum), 0)
  const excessToRemove = currentTotal - maxLayers
  if (excessToRemove <= 0) return { composition, remainingSingleton: null, removedLayers: 0 }
  const working = composition.map((s) => ({ ...s }))
  let remainingToRemove = excessToRemove
  for (let i = working.length - 1; i >= 0 && remainingToRemove > 0; i--) {
    const seg = working[i]
    if (seg.itemId !== itemId) continue
    const take = Math.min(seg.layers, remainingToRemove)
    seg.layers -= take
    remainingToRemove -= take
  }
  const remaining = working.filter((s) => s.layers > 0)
  const coalesced: CompositionSegment[] = []
  for (const seg of remaining) {
    const last = coalesced[coalesced.length - 1]
    if (last && last.itemId === seg.itemId) last.layers += seg.layers
    else coalesced.push({ ...seg })
  }
  if (coalesced.length >= 2) return { composition: coalesced, remainingSingleton: null, removedLayers: excessToRemove }
  if (coalesced.length === 1) return { composition: null, remainingSingleton: coalesced[0], removedLayers: excessToRemove }
  return { composition: null, remainingSingleton: null, removedLayers: excessToRemove }
}

// The minimal catalog shape lashing needs — `category` (and `name`, for
// segment labels in the UI/PDF) in addition to `weight`
// (CompositionCatalogItem above has neither, since VCG/weight/height
// arithmetic needs neither).
export interface LashingCatalogItem {
  id: string
  name?: string
  category?: string
  weight?: number
}

// Round 19 (lashing per-segment). The single point every lashing consumer
// (Sidebar.tsx, handleExportPdf) is meant to call into instead of resolving
// `category`/`weight` from the placement's own nominal itemId — a composed
// placement can span multiple distinct categories (e.g. ordinary cargo +
// dangerous goods), and assessing it as ONE lashing requirement using only
// the nominal itemId's category silently drops every OTHER constituent's
// own methodology (or, worse, misroutes an ordinary constituent through a
// dangerous-goods "not applicable" verdict it doesn't belong to, or vice
// versa, depending on which constituent happens to be nominal).
//
// Degenerates to the exact today's single-input behavior for an uncomposed
// placement (segmentsOf's implicit one-segment fallback), so every existing
// (uncomposed) call site's assessment is unchanged.
export function segmentLashingInputs(
  p: ComposablePlacement,
  items: LashingCatalogItem[]
): { itemId: string; layers: number; category?: string; weightKg: number }[] {
  return segmentsOf(p).map((seg) => {
    const item = items.find((it) => it.id === seg.itemId)
    return { itemId: seg.itemId, layers: seg.layers, category: item?.category, weightKg: seg.layers * (item?.weight ?? 0) }
  })
}

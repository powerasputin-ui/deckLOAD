// Pure functions for reading and mutating `composition` (see
// CompositionSegment/ManualPlacement.composition/PinnedPlacement.composition
// in packing.ts for the full contract). This is the ONLY place that should
// ever do composition arithmetic — every consumer (packDeck's pin loop,
// packingResultFromManual, stability.ts, lashing, the merge/+/- UI
// handlers) is meant to call into these functions rather than re-derive
// the same logic locally, which is exactly how the weight-blend bug
// (Round 10) and its downstream siblings (height, category, stability,
// maxLayers, allowRotation — Rounds 11/12) happened: the same "sum across
// constituents" arithmetic got re-implemented ad hoc in several places,
// and some of them were simply never updated.
//
// Round 13 scope: this module and its tests only. Nothing in the real
// merge/+/-/removeItem UI paths (src/app/page.tsx) calls into this module
// yet — they still use the pre-Round-13 flat-field logic verbatim, and
// keep doing so until Round 14 (merge) and Round 15 (removeItem/quantity)
// explicitly switch them over. Existing consumers that still use the OLD
// (pre-composition) arithmetic after this round, deliberately unchanged:
//   - src/app/page.tsx: reconcileCrossItemMerge, handleMergePinned,
//     handleMergeManual, handleLayerChangePinned/Manual's "+"/"-" branches,
//     handleRemovePinned, checkLayerChange, onPlace's itemPlaced count
//   - src/store/calculator.ts: removeItem, updateItem's applyWeight/
//     decrease-warning
//   - src/lib/packing.ts: packDeck's pin-processing loop,
//     packingResultFromManual (still resolve height/category/weight by a
//     single itemId lookup, never read `.composition`)
//   - src/lib/stability.ts: computeItemVCG, buildCargoWeightMoments (still
//     called once per placement with the placement's own flat weight/height)
//   - src/components/calculator/Sidebar.tsx, src/lib/exportPdf.ts,
//     src/app/page.tsx's handleExportPdf (lashing — still one category/
//     weight per placement)
//   - src/components/calculator/Deck3DView.tsx (still one tierPitch per
//     placement)
// All of the above are intentionally out of scope until later rounds —
// composition can exist on a placement (in principle) without any of them
// noticing, since nothing outside this module and its tests produces one.

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

export function placementTotalWeightKg(p: ComposablePlacement, items: CompositionCatalogItem[]): number {
  return segmentsOf(p).reduce((sum, seg) => sum + seg.layers * (findItem(items, seg.itemId)?.weight ?? 0), 0)
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

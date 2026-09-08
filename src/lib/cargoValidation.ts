// Shared CargoItem field validation rules, used by BOTH the persistence
// layer (src/store/projects.ts's normalizeProject) and the live store
// (src/store/calculator.ts's updateItem). Before this file existed, the
// same rules were duplicated in both places by hand — easy for the two to
// silently drift apart. This file is the single source of truth for what
// counts as a valid width/length/height/quantity/weight/maxLayers/
// maxStackHeightM; neither caller should re-derive these rules itself.
//
// Deliberately self-contained (imports nothing from projects.ts or
// calculator.ts) so it can be imported by both without creating a cycle —
// projects.ts already imports from calculator.ts, so a shared module can
// only safely sit below both, not inside either. placementComposition.ts
// sits below packing.ts/stabilityMath.ts only, so importing its pure
// arithmetic here doesn't risk a cycle either.
import { placementTotalWeightKg, type CompositionCatalogItem } from './placementComposition'
import type { CompositionSegment } from './packing'

export function sanitizeCargoWidth(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function sanitizeCargoLength(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function sanitizeCargoHeight(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

// NOT rejecting 0 the way a plain "positive int" helper would — 0 is a
// legitimate "none of this cargo left" (e.g. after deleting the last
// placed unit), not corrupted input. Only genuinely invalid input
// (NaN/undefined/negative) falls back.
export function sanitizeCargoQuantity(value: unknown, fallback: number): number {
  const v = typeof value === 'number' ? value : fallback
  if (!Number.isFinite(v) || v < 0) return fallback
  return Math.round(v)
}

// weight/maxLayers/maxStackHeightM are all optional CargoItem fields where
// undefined has its own meaning ("not set" / "no override") distinct from
// any numeric fallback — so an invalid input becomes undefined, never a
// substituted number.
export function sanitizeCargoWeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function sanitizeCargoMaxLayers(value: unknown): number | undefined {
  // Flooring BEFORE the range check (not after) matters: a fractional input
  // between 0 and 1 (e.g. 0.1) used to pass `value > 0` and then floor down
  // to 0, silently storing an out-of-contract 0 instead of falling back to
  // undefined like every other invalid input does.
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const floored = Math.floor(value)
  return floored >= 1 ? floored : undefined
}

export function sanitizeCargoMaxStackHeightM(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

// maxDeckCargoT is a hard limit in both AUTO and MANUAL (contract A, chosen
// explicitly by the user). This is the one shared arithmetic both modes'
// new-placement guards must call — pulled out to a pure, unit-testable
// function specifically because the same check kept getting re-implemented
// inline in page.tsx call sites and some of them were simply forgotten
// (onPlace's AUTO branch, the preset branch in either mode, pinned "+"
// layer) — a bug class that a page.tsx-only implementation can't be
// unit-tested against, since page.tsx itself has no test file.
export function wouldExceedDeckCapacity(
  currentPlacements: { itemId?: string; weight?: number; layers?: number; composition?: CompositionSegment[] }[],
  addedWeightKg: number,
  maxDeckCargoT: number | undefined,
  // Round 17 (capacity verification): catalog, needed ONLY to resolve a
  // composed placement's true weight via its own segments — an uncomposed
  // placement (the overwhelming common case today) never touches this.
  // Defaults to `[]` so every existing caller/test that predates
  // composition keeps compiling and behaving identically (no placement it
  // passes has `.composition` set).
  items: CompositionCatalogItem[] = []
): boolean {
  if (maxDeckCargoT === undefined) return false
  // This is now the one shared arithmetic every hard-limit call site relies
  // on — a caller passing NaN/Infinity/negative used to silently pass the
  // check (`currentKg + NaN > maxKg` is `false` in JS), defeating the whole
  // point of a "hard" limit. No currently-wired call site can actually
  // produce that (item.weight is sanitized well before it reaches here),
  // but a function documented as THE hard-limit check shouldn't depend on
  // that staying true forever — treat garbage input as "exceeds" rather
  // than silently waving it through.
  if (!Number.isFinite(addedWeightKg) || addedWeightKg < 0) return true
  if (!Number.isFinite(maxDeckCargoT) || maxDeckCargoT < 0) return true
  const maxKg = maxDeckCargoT * 1000
  // A composed placement's own top-level `weight`/`layers` are only a
  // backward-compatible AVERAGE fallback (see PlacedItem.composition's own
  // doc comment in packing.ts) — nothing guarantees they're kept in sync
  // with `composition` for a placement that was hand-built or edited
  // outside the one path (Round 16's removeItem surgery) that currently
  // bothers to. Before this fix, a composed placement with no `.weight` of
  // its own contributed exactly 0 kg to this hard limit regardless of its
  // REAL physical weight — silently defeating "hard limit in both AUTO and
  // MANUAL" (contract A) the moment composition existed on the deck.
  // Composition is the source of truth whenever present; `weight`/`layers`
  // stay the fallback for everything still uncomposed.
  const currentKg = currentPlacements.reduce((sum, p) => {
    if (p.composition) {
      return sum + placementTotalWeightKg({ itemId: p.itemId ?? '', layers: 0, composition: p.composition }, items)
    }
    return sum + (p.weight ?? 0) * Math.max(1, p.layers ?? 1)
  }, 0)
  return currentKg + addedWeightKg > maxKg
}

// Used by handleMergePinned/handleMergeManual (page.tsx) when the user
// drags one placement onto another to stack them. reconcileCrossItemMerge
// only requires the two source CargoItems to share width/length/height
// (pipe cargo split across two tracked stacks is a real workflow) — it
// does NOT require them to share weight, so a cross-item merge can combine
// layers from two items with different per-unit weights. Simply keeping
// the target's old weight while bumping its layers (the previous
// behavior) silently mis-recorded the merged stack's true weight in
// either direction. A layer-weighted average keeps `weight * layers`
// physically correct for the combined stack; for a same-item merge this
// is a no-op, since both sides already share one weight by updateItem's
// own weight-propagation invariant.
export function mergedPlacementWeight(
  targetWeight: number | undefined,
  targetLayers: number,
  draggedWeight: number | undefined,
  draggedLayers: number
): number | undefined {
  const totalLayers = targetLayers + draggedLayers
  if (totalLayers <= 0) return targetWeight
  return ((targetWeight ?? 0) * targetLayers + (draggedWeight ?? 0) * draggedLayers) / totalLayers
}

// Low-level, self-contained cargo-VCG arithmetic — deliberately split out
// of stability.ts (which re-exports it unchanged, so nothing importing
// `computeItemVCG` from './stability' needs to change) so it can sit BELOW
// both stability.ts and src/lib/placementComposition.ts in the dependency
// graph, instead of placementComposition.ts having to import stability.ts
// directly:
//
//   packing.ts (types only)
//        ^
//        |
//   stabilityMath.ts
//        ^        ^
//        |        |
//   stability.ts  placementComposition.ts
//
// Round 13 gave placementComposition.ts a dependency on stability.ts (just
// for this one function) — harmless on its own, but Round 14 needs
// stability.ts's buildCargoWeightMoments to become composition-aware,
// which would require it to import FROM placementComposition.ts. Those two
// facts together would form a cycle (placementComposition -> stability ->
// placementComposition) the moment Round 14 wires anything up. This module
// exists purely to break that before it happens — no behavior change,
// nothing here differs from computeItemVCG's pre-existing implementation.

import type { StabilityOverride } from './packing'

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

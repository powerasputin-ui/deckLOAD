import { useCalculator } from './calculator'

// Placement bookkeeping the page's handlers and hooks share (moved out of
// page.tsx as it was, spec 12.3).

// A placement quarantined when its project was loaded (malformed, with no
// composition to fall back on — see PinnedPlacement.malformed) is never part
// of any result.placed. Every handler below that rebuilds a placement list
// from result.placed must carry these over untouched: the load-time toast
// promises they stay in the project and out of every calculation, and
// rebuilding used to delete them (or, manual -> auto, quietly un-quarantine
// them by dropping the flag).
export const isQuarantined = (p: { malformed?: unknown; composition?: unknown }) => !!p.malformed && !p.composition

// Auto-redistribute hands every placement a brand-new id (it's a full
// repack, not a move), so a lashing point's old placementId never matches
// anything afterward. Match each old placement that actually has lashing
// points against the nearest same-itemId placement in the new layout
// (greedy, one new placement claimed per old one) so those points survive
// onto "the same cargo, repacked" instead of being pruned as orphans.
export const matchLashingCarryover = (
  oldPlacements: { id: string; itemId: string; x: number; y: number }[],
  newPlacements: { id: string; itemId: string; x: number; y: number }[]
) => {
  const attachedOldIds = new Set(
    (useCalculator.getState().deck.lashingPoints ?? []).map((lp) => lp.placementId).filter(Boolean)
  )
  const oldWithLashing = oldPlacements.filter((p) => attachedOldIds.has(p.id))
  if (oldWithLashing.length === 0) return []
  const usedNewIds = new Set<string>()
  const matches: { oldId: string; newId: string; dx: number; dy: number }[] = []
  for (const old of oldWithLashing) {
    let best: { id: string; itemId: string; x: number; y: number } | undefined
    let bestDist = Infinity
    for (const cand of newPlacements) {
      if (usedNewIds.has(cand.id) || cand.itemId !== old.itemId) continue
      const d = Math.hypot(cand.x - old.x, cand.y - old.y)
      if (d < bestDist) {
        bestDist = d
        best = cand
      }
    }
    if (best) {
      usedNewIds.add(best.id)
      matches.push({ oldId: old.id, newId: best.id, dx: best.x - old.x, dy: best.y - old.y })
    }
  }
  return matches
}

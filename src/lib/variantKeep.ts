// The stacks «Подобрать варианты» leaves where they stand (spec 8.2): a
// locked stack — locking is the user's explicit request to keep a position —
// and one with a clearance zone or lashing points, whose rigging only makes
// sense where it was drawn. Everything else is re-arranged. The section's
// line «Закреплённые штабели (N) остаются на местах» and the packer's pins
// count the same stacks.

export interface KeepablePlacement {
  id: string
  locked?: boolean
  clearanceMargin?: unknown
  malformed?: unknown
  composition?: unknown
}

export function keptByVariants<P extends KeepablePlacement>(
  placements: readonly P[],
  lashingPoints: readonly { placementId?: string }[] | undefined
): P[] {
  const attached = new Set((lashingPoints ?? []).map((lp) => lp.placementId).filter(Boolean))
  return placements.filter(
    (p) =>
      // A quarantined record isn't on the deck at all (see isQuarantined).
      !(p.malformed && !p.composition) && (!!p.locked || !!p.clearanceMargin || attached.has(p.id))
  )
}

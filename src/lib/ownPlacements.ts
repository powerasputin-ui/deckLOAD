// The units of a cargo the user stood on the deck themselves (spec 7.1,
// revision 2026-11-05): what «Убрать» or «Открепить» on its row takes off.
// In manual mode that is every placement of it. In auto it is the stacks
// the user pinned (locked: a click with «Поставить», a drag, a lock); the
// packer's own stacks, pinned or not, are not the user's. A record
// quarantined as malformed isn't on the deck at all.
import { placementLayersOfItem, type ComposablePlacement } from './placementComposition'

type Placement = ComposablePlacement & { locked?: boolean; malformed?: unknown }

// The units of `itemId` in these placements, as the click placement counts
// them: a mixed stack's own segments, a plain stack at least one unit.
export function unitsOfItemIn(placements: readonly Placement[], itemId: string): number {
  return placements.reduce((n, p) => {
    if (p.malformed && !p.composition) return n
    if (p.composition) return n + placementLayersOfItem(p, itemId)
    return p.itemId === itemId ? n + Math.max(1, p.layers) : n
  }, 0)
}

export function ownUnitsOfItem(
  itemId: string,
  mode: 'auto' | 'manual',
  manualPlacements: readonly Placement[],
  pinnedPlacementsByTrip: Readonly<Record<number, readonly Placement[]>>
): number {
  if (mode === 'manual') return unitsOfItemIn(manualPlacements, itemId)
  return Object.values(pinnedPlacementsByTrip).reduce(
    (n, pins) => n + unitsOfItemIn(pins.filter((p) => p.locked), itemId),
    0
  )
}

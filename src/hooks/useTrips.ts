'use client'

import { useMemo, useState } from 'react'
import { packMultiTrip, packingResultFromManual, type PackingResult } from '@/lib/packing'
import type { useCalculator } from '@/store/calculator'

type Calculation = ReturnType<typeof useCalculator.getState>

// The trips the cargo goes in and the one open on screen (spec 6.9). Moved
// out of page.tsx as it was (spec 12.3).
export function useTrips({
  mode,
  deck,
  items,
  manualPlacements,
  pinnedPlacementsByTrip,
  sortStrategy,
  globalRotation,
  separationRulesInUnit,
}: {
  mode: Calculation['mode']
  deck: Calculation['deck']
  items: Calculation['items']
  manualPlacements: Calculation['manualPlacements']
  pinnedPlacementsByTrip: Calculation['pinnedPlacementsByTrip']
  sortStrategy: Calculation['sortStrategy']
  globalRotation: Calculation['globalRotation']
  // Separation rules with their distances in the deck's unit.
  separationRulesInUnit: Calculation['separationRules']
}) {
  const [activeTripIndex, setActiveTripIndex] = useState(0)
  // In auto mode, cargo that doesn't fit in one voyage automatically spills
  // into additional trips (same deck, repeated) via packMultiTrip. Manual mode
  // stays single-trip — the user places cargo by hand on one deck at a time.
  const trips: PackingResult[] = useMemo(() => {
    if (mode === 'manual') {
      const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
      // Standing cargo is rechecked against the deck as it is now (L14): a
      // new outline, a moved obstacle or a widened clearance zone used to
      // leave a stack where it may not stand, with nothing said.
      return [
        packingResultFromManual(deck.width, deck.length, manualPlacements, totalRequested, items, deck.clearance, deck.outline, {
          boardOffset: deck.boardOffset,
          gap: deck.gap,
          restrictionZones: deck.restrictionZones,
        }),
      ]
    }
    const effectiveItems = globalRotation
      ? items
      : items.map((it) => ({ ...it, allowRotation: false }))
    // Each trip is a separate deck instance — packMultiTrip applies the
    // matching trip's own pins (pinnedByTrip[tripIndex]) at every iteration,
    // so pinning/dragging cargo works identically on any trip, not just the first.
    return packMultiTrip(
      deck.width,
      deck.length,
      effectiveItems,
      {
        sortStrategy,
        gap: deck.gap,
        boardOffset: deck.boardOffset,
        clearance: deck.clearance,
        separationRules: separationRulesInUnit,
        outline: deck.outline,
        restrictionZones: deck.restrictionZones,
        // Real, vessel-specific stowage limits — see PackOptions' own doc
        // comments in packing.ts for exactly how each is enforced (loadZones
        // soft-prefers a non-overloading position when one exists;
        // maxTotalWeightKg hard-stops once the vessel's own approved deck
        // capacity would be exceeded). Both are undefined/empty until a
        // vessel template with real limits has actually been applied.
        loadZones: deck.loadZones,
        unit: deck.unit,
        maxTotalWeightKg: deck.maxDeckCargoT !== undefined ? deck.maxDeckCargoT * 1000 : undefined,
      },
      10,
      pinnedPlacementsByTrip
    )
  }, [deck.width, deck.length, deck.gap, deck.boardOffset, deck.clearance, deck.outline, deck.restrictionZones, deck.loadZones, deck.unit, deck.maxDeckCargoT, items, sortStrategy, globalRotation, mode, manualPlacements, pinnedPlacementsByTrip, separationRulesInUnit])

  // Clamp (rather than store) the selected trip in range as the trip count
  // changes (e.g. cargo edited so fewer/more voyages are needed) — avoids a
  // setState-in-effect render cascade for something purely derived.
  // packMultiTrip also keeps the trip on which it stopped making progress:
  // with cargo that can't fit even an empty deck, that's a last tab with
  // nothing on it. It carries no cargo, so it isn't shown as a trip — its
  // shortfall still reports what fits nowhere (below).
  const lastTrip = trips[trips.length - 1]
  const hasEmptyTrailingTrip =
    mode === 'auto' &&
    trips.length > 1 &&
    lastTrip.placedCount === 0 &&
    (pinnedPlacementsByTrip[trips.length - 1] ?? []).length === 0
  const shownTrips = hasEmptyTrailingTrip ? trips.slice(0, -1) : trips
  const clampedTripIndex = Math.max(0, Math.min(activeTripIndex, shownTrips.length - 1))
  const result = shownTrips[clampedTripIndex] ?? shownTrips[0]
  return { activeTripIndex, setActiveTripIndex, trips, lastTrip, hasEmptyTrailingTrip, shownTrips, clampedTripIndex, result }
}
